"""Deploy/re-test the collector using real Linux UID/namespace boundaries.
Evidence is frozen controlled-trace replay, not new natural OpenCode execution.
"""
import argparse, hashlib, json, os, pwd, shutil, signal, subprocess, sys, time, uuid
from pathlib import Path
from sandbox import COLLECTOR_UID,HOST_UID,AGENT_UID,prepare_root,agent_probe,host_call

def main():
    p=argparse.ArgumentParser();p.add_argument("--dataset",required=True);p.add_argument("--tamper-dir",required=True);p.add_argument("--out-dir",required=True);p.add_argument("--leave-running",action="store_true");a=p.parse_args()
    if os.getuid()!=0:raise RuntimeError("Provisioning requires the trusted WSL/Linux administrator")
    for uid in (COLLECTOR_UID,HOST_UID,AGENT_UID):
        try:pwd.getpwuid(uid)
        except KeyError:continue
        raise RuntimeError(f"Reserved test UID {uid} is already assigned; do not reuse an account")
    out=Path(a.out_dir);out.mkdir(parents=True,exist_ok=False)
    release=Path("/var/lib/traceforge-secure")/("capture-"+uuid.uuid4().hex)
    release.mkdir(parents=True,mode=0o755)
    store=release/"store";store.mkdir(mode=0o700);os.chown(store,COLLECTOR_UID,COLLECTOR_UID)
    run=release/"run";run.mkdir(mode=0o750);os.chown(run,COLLECTOR_UID,HOST_UID)
    source=release/"code";shutil.copytree(Path(__file__).parent,source,ignore=shutil.ignore_patterns("__pycache__"))
    for f in source.iterdir():os.chmod(f,0o444)
    endpoint=run/"collector.sock"
    def demote():os.setgroups([]);os.setgid(HOST_UID);os.setuid(COLLECTOR_UID)
    process=subprocess.Popen([sys.executable,str(source/"collector.py"),"--store",str(store),"--socket",str(endpoint),"--host-uid",str(HOST_UID)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,preexec_fn=demote,start_new_session=True)
    ready=json.loads(process.stdout.readline())
    if not ready.get("ready"):raise RuntimeError("Collector did not start")
    (out/"collector-public-key.pem").write_text(ready["publicKeyPem"])
    root=prepare_root(release/"agent-root")
    probes=[]
    try:
        for probe in ["inject","delete","rewrite","key_read","network","host_escape"]:probes.append(agent_probe(root,store,endpoint,probe))
        # Make socket reachable in this single defense-in-depth test: kernel UID
        # validation must still reject the agent even if a socket ACL is widened.
        os.chmod(endpoint,0o666)
        # The alternate probe reads the server's explicit rejection, not an errno.
        from sandbox import sandbox_preexec
        code='import socket,json;s=socket.socket(socket.AF_UNIX);s.connect("/run/collector.sock");s.sendall(b\'{"op":"register","sessionId":"forged","promptId":"p","responseHash":"'+"0"*64+'"}\\n\');print(s.recv(4096).decode())'
        r=subprocess.run(["/usr/bin/python3","-I","-c",code],capture_output=True,text=True,timeout=10,env={"PATH":"/usr/bin"},preexec_fn=lambda:sandbox_preexec(root,store,endpoint))
        reply=json.loads(r.stdout)
        if r.returncode or reply!={"ok":False,"error":"UNAUTHENTICATED_ORIGIN"}:raise RuntimeError("Origin rejection failed")
        probes.append({"probe":"widened_socket_acl","uid":AGENT_UID,"blocked":True,"reply":reply});os.chmod(endpoint,0o660)
        data=[json.loads(l) for l in Path(a.dataset).read_text().splitlines() if l.strip()]
        mutated={attack:{s["id"]:s for s in (json.loads(l) for l in (Path(a.tamper_dir)/f"tamper-{attack}.jsonl").read_text().splitlines() if l.strip())} for attack in ("forge","suppress-all","suppress-negative")}
        snapshots=[];acks=[]
        for attack in ["honest","forge","suppress-all","suppress-negative","hook-disable","tail-suppress","sequence-gap","cross-session-replay"]:
            for index,s in enumerate(data):
                sid=f"{attack}:{s['id']}";pid=s["evidence"][0]["promptId"]
                messages=[{"op":"register","sessionId":sid,"promptId":pid,"responseHash":hashlib.sha256(s["finalResponse"].encode()).hexdigest()},
                          {"op":"begin","sessionId":sid,"invocationId":"observed","requiredEvents":len(s["evidence"])}]
                # Register/expectations originate outside the hook; disabling it
                # cannot erase the expected receipt count.
                events=[] if attack=="hook-disable" else s["evidence"][:-1] if attack=="tail-suppress" else s["evidence"]
                for i,event in enumerate(events):
                    messages.append({"op":"event","sessionId":sid,"invocationId":"observed","sequence":i+1+(1 if attack=="sequence-gap" else 0),"eventId":event["eventId"],"payload":event})
                if attack=="cross-session-replay":
                    event=s["evidence"][0]
                    messages.append({"op":"event","sessionId":sid,"invocationId":"observed","sequence":1,"eventId":event["eventId"],"payload":{**event,"promptId":"another-session"}})
                replies=host_call(endpoint,messages)
                if attack in ("forge","suppress-all","suppress-negative"):
                    probe={"forge":"inject","suppress-all":"delete","suppress-negative":"rewrite"}[attack]
                    altered=mutated[attack][s["id"]]
                    forged=next((e for e in reversed(altered["evidence"]) if e["eventType"]!="FINAL_RESPONSE_CAPTURED"),s["evidence"][-1])
                    attempt={"op":"event","sessionId":sid,"invocationId":"observed","sequence":len(s["evidence"])+1,"eventId":forged["eventId"],"payload":forged}
                    probes.append({"sessionId":sid,"tamperDatasetSha256":hashlib.sha256(json.dumps(altered,sort_keys=True).encode()).hexdigest(),**agent_probe(root,store,endpoint,probe,attempt)})
                ending=[{"op":"end","sessionId":sid,"invocationId":"observed"},{"op":"seal","sessionId":sid}]
                replies.extend(host_call(endpoint,ending));messages.extend(ending)
                # Invalid captures are still signed as INVALID, never replaced
                # with an invented clean trace. Unauthorized agent edits were
                # blocked at the OS/ingress boundary, so their stored trace stays
                # honest; the three legacy builders remain separate controls.
                snapshot=replies[-1].get("snapshot")
                if not snapshot:raise RuntimeError("No completion result")
                if attack in ("honest","forge","suppress-all","suppress-negative") and not all(r["ok"] for r in replies):raise RuntimeError("Honest/blocked-attack replay failed")
                snapshots.append({"id":s["id"],"attack":attack,"snapshot":snapshot})
                acks.extend({"id":s["id"],"attack":attack,"operation":m["op"],"accepted":r["ok"],"ackMs":r["ackMs"],"error":r.get("error")} for m,r in zip(messages,replies))
            print(f"completed {attack}: {len(data)} sessions",flush=True)
        # Restart: durable receipts and key must survive without re-accepting events.
        process.terminate();process.wait(timeout=10);endpoint.unlink()
        process=subprocess.Popen([sys.executable,str(source/"collector.py"),"--store",str(store),"--socket",str(endpoint),"--host-uid",str(HOST_UID)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,preexec_fn=demote,start_new_session=True)
        restarted=json.loads(process.stdout.readline())
        if restarted["publicKeyPem"]!=ready["publicKeyPem"]:raise RuntimeError("Key changed on restart")
        first=snapshots[0];again=host_call(endpoint,[{"op":"seal","sessionId":f"honest:{first['id']}"}])[0]
        if again.get("snapshot")!=first["snapshot"]:raise RuntimeError("Durability failure")
        probes.append({"probe":"restart_durability","blocked":False,"passed":True})
        for name,rows in [("snapshots",snapshots),("acknowledgements",acks),("os-probes",probes)]:
            (out/f"{name}.jsonl").write_text("".join(json.dumps(r)+"\n" for r in rows))
        info={"profile":"3.2.0-capture.1","releaseDirectory":str(release),"collectorPid":process.pid,"collectorUid":COLLECTOR_UID,"hostUid":HOST_UID,"agentUid":AGENT_UID,"socket":str(endpoint),"networkNamespace":True,"chroot":True,"noNewPrivileges":True,"data":"Frozen controlled traces replayed through authenticated Linux collector; not live OpenCode tasks","sessionsPerAttack":len(data),"deployed":a.leave_running}
        (out/"deployment.json").write_text(json.dumps(info,indent=2))
        print(json.dumps(info),flush=True)
    finally:
        if not a.leave_running:
            process.terminate();process.wait(timeout=10)

if __name__=="__main__":main()
