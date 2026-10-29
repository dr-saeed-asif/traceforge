"""Start protected tool dispatch and execute real sandboxed command controls."""
import argparse, hashlib, json, os, shutil, socket, subprocess, sys, time, uuid
from pathlib import Path
from sandbox import COLLECTOR_UID,HOST_UID,host_call

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--deployment",required=True);p.add_argument("--out-dir",required=True);p.add_argument("--reuse-dispatcher",action="store_true");a=p.parse_args()
    if os.getuid()!=0:raise RuntimeError("Requires trusted Linux administrator")
    deployment=json.loads(Path(a.deployment).read_text());release=Path(deployment["releaseDirectory"]);endpoint=release/"run/dispatcher.sock"
    out=Path(a.out_dir);out.mkdir(parents=True,exist_ok=False)
    if not str(release.resolve()).startswith("/var/lib/traceforge-secure/"):raise RuntimeError("Unsafe deployment location")
    def start(name,argv,demote=None):
        path=release/(name+".log");fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);log=os.fdopen(fd,"w")
        child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=log,text=True,preexec_fn=demote,start_new_session=True);log.close()
        for _ in range(100):
            text=path.read_text()
            if '"ready": true' in text or '"ready":true' in text:return child
            if child.poll() is not None:raise RuntimeError(name+" failed: "+text[:1000])
            time.sleep(.1)
        raise RuntimeError(name+" startup deadline exceeded")
    check=socket.socket(socket.AF_UNIX)
    try:check.connect(deployment["socket"])
    except (ConnectionRefusedError,FileNotFoundError):
        sock=Path(deployment["socket"])
        if sock.exists():sock.unlink()
        def demote():os.setgroups([]);os.setgid(HOST_UID);os.setuid(COLLECTOR_UID)
        collector=start("collector-persistent",[sys.executable,str(release/"code/collector.py"),"--store",str(release/"store"),"--socket",str(sock),"--host-uid",str(HOST_UID)],demote)
        deployment["collectorPid"]=collector.pid
    finally:check.close()
    if endpoint.exists():
        s=socket.socket(socket.AF_UNIX)
        try:
            s.connect(str(endpoint))
            if not a.reuse_dispatcher:raise RuntimeError("Dispatcher is already running; use --reuse-dispatcher deliberately")
        except ConnectionRefusedError:endpoint.unlink()
        finally:s.close()
    code=release/"code/dispatcher.py"
    process=None if a.reuse_dispatcher else start("dispatcher-persistent",[sys.executable,str(code),"--root",str(release/"agent-root"),"--store",str(release/"store"),"--collector",deployment["socket"],"--socket",str(endpoint)])
    controls=[]
    cases=[("honest",[["/usr/bin/node","-e","require('node:fs').writeFileSync('probe.cjs',\"require('node:test')('probe',()=>require('node:assert').strictEqual(1,1));\")"],["/usr/bin/node","--test","probe.cjs"]],"Created `probe.cjs`. All 1 tests passed."),
           ("contradicted",[["/usr/bin/node","-e","process.exit(1)"]],"`node -e process.exit(1)` succeeded.")]
    for name,commands,response in cases:
        filename="probe-"+uuid.uuid4().hex+".cjs"
        commands=[[value.replace("probe.cjs",filename) for value in argv] for argv in commands]
        response=response.replace("probe.cjs",filename)
        sid="live-control-"+name+"-"+uuid.uuid4().hex
        replies=host_call(endpoint,[{"op":"register","sessionId":sid},*[ {"op":"execute","sessionId":sid,"argv":argv} for argv in commands],{"op":"finish","sessionId":sid,"finalResponse":response}])
        if any(not r["ok"] for r in replies):raise RuntimeError("Live dispatcher control failed: "+json.dumps(replies))
        controls.append({"name":name,"id":sid,"finalResponse":response,"commands":commands,"replies":replies,"snapshot":replies[-1]["snapshot"]})
    (out/"live-controls.jsonl").write_text("".join(json.dumps(v)+"\n" for v in controls))
    info={**deployment,"dispatcherPid":process.pid if process else deployment.get("dispatcherPid"),"dispatcherSocket":str(endpoint),"profile":"protected Linux tools only; legacy Windows capture is not upgraded","controlSessions":len(controls),"dispatcherSourceSha256":hashlib.sha256(code.read_bytes()).hexdigest()}
    (out/"deployment.json").write_text(json.dumps(info,indent=2));print(json.dumps(info))
