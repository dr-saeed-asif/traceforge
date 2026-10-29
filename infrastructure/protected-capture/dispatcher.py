"""Protected Linux command dispatcher, independent of OpenCode plugin hooks.
Only a trusted host principal may use its local socket; tools run in sandbox.py.
"""
import argparse, hashlib, json, os, re, shlex, signal, socket, socketserver, stat, struct, subprocess, tempfile, threading, uuid
from pathlib import Path
from sandbox import HOST_UID, AGENT_UID, host_call, sandbox_preexec

def snapshot(workspace):
    result={}
    for directory,dirs,files,fd in os.fwalk(workspace,follow_symlinks=False):
        dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(directory,d))]
        for name in files:
            try:
                handle=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
                with os.fdopen(handle,"rb") as f:
                    info=os.fstat(f.fileno())
                    if not stat.S_ISREG(info.st_mode):continue
                    if len(result)>=20000 or info.st_size>5*1024*1024:raise RuntimeError("Workspace observation incomplete")
                    content=f.read(5*1024*1024+1)
                    if len(content)>5*1024*1024:raise RuntimeError("File grew beyond capture budget")
                    result[str(Path(directory,name).relative_to(workspace))]=hashlib.sha256(content).hexdigest()
            except OSError:raise RuntimeError("Workspace changed during capture or contains an unsafe link")
    return result

class Dispatcher:
    def __init__(self,root,store,collector):self.root=Path(root);self.store=Path(store);self.collector=Path(collector);self.sessions={};self.lock=threading.Lock()
    def send(self,messages):
        replies=host_call(self.collector,messages)
        if any(not r["ok"] for r in replies):raise RuntimeError("Capture rejected: "+json.dumps(replies))
        return replies
    def handle(self,request):
        with self.lock:
            sid=request.get("sessionId");op=request.get("op")
            if not isinstance(sid,str) or not sid or len(sid)>256:raise ValueError("Invalid session ID")
            if op=="register":
                if sid in self.sessions:raise ValueError("Session already registered")
                self.send([{"op":"register","sessionId":sid,"promptId":sid,"responseHash":None}]);self.sessions[sid]={"sequence":0,"closed":False};return {"registered":True}
            session=self.sessions.get(sid)
            if not session or session["closed"]:raise ValueError("Missing/closed supervisor session")
            invocation=uuid.uuid4().hex
            def event(typ,target,metadata,outcome="RECORDED"):
                session["sequence"]+=1;seq=session["sequence"];eid=f"{invocation}:{seq}"
                return {"op":"event","sessionId":sid,"invocationId":invocation,"sequence":seq,"eventId":eid,"payload":{"promptId":sid,"eventId":eid,"sequenceNumber":seq,"eventType":typ,"target":target,"outcome":outcome,"occurredAt":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),"metadata":metadata}}
            if op=="execute":
                argv=request.get("argv")
                if not isinstance(argv,list) or not argv or len(argv)>100 or any(not isinstance(v,str) or len(v)>16000 for v in argv):raise ValueError("argv must be a bounded string array")
                if argv[0] not in ("/usr/bin/python3","/usr/bin/node","/bin/sh"):raise ValueError("Executable is outside this sandbox profile")
                before=snapshot(self.root/"workspace")
                self.send([{"op":"begin","sessionId":sid,"invocationId":invocation,"requiredEvents":2},event("COMMAND_STARTED",json.dumps(argv),{"argv":argv})])
                def setup():os.setsid();sandbox_preexec(self.root,self.store,self.collector)
                # Private regular-file spools inherit the tool's RLIMIT_FSIZE;
                # hostile stdout cannot grow the trusted supervisor's memory.
                with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
                    process=subprocess.Popen(argv,stdout=out,stderr=err,env={"PATH":"/usr/bin:/bin","LANG":"C.UTF-8"},preexec_fn=setup)
                    try:process.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid,signal.SIGKILL);process.wait();raise RuntimeError("Tool timeout; capture left incomplete")
                    finally:
                        try:os.killpg(process.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                    out.seek(0);err.seek(0);stdout=out.read(1024*1024+1);stderr=err.read(1024*1024+1)
                if len(stdout)+len(stderr)>1024*1024:raise RuntimeError("Tool output exceeds capture budget")
                after=snapshot(self.root/"workspace")
                changes=[{"path":p,"before":before.get(p),"after":after.get(p)} for p in sorted(before.keys()|after.keys()) if before.get(p)!=after.get(p)]
                observed_argv=argv
                if argv[:2]==['/bin/sh','-c'] and len(argv)==3 and not re.search(r'[;&|<>`$\n*?{}()]',argv[2]):
                    observed_argv=shlex.split(argv[2])
                is_test=bool(observed_argv) and observed_argv[0] in ('node','/usr/bin/node') and "--test" in observed_argv
                counts={}
                if is_test:
                    for key,word in [("passed","pass"),("failed","fail"),("skipped","skipped")]:
                        values=re.findall(r"^\s*#\s*"+word+r"\s+(\d+)\s*$",stdout.decode(errors="replace"),re.M)
                        if values:counts[key]=int(values[-1])
                self.send([event("TEST_COMPLETED" if is_test else "COMMAND_COMPLETED",json.dumps(observed_argv),{"argv":observed_argv,"launcherArgv":argv,"exitCode":process.returncode,**counts,"stdoutHash":hashlib.sha256(stdout).hexdigest(),"stderrHash":hashlib.sha256(stderr).hexdigest(),"changedPaths":[c["path"] for c in changes],"changes":changes,"workspaceObservation":"complete"},"SUCCEEDED" if process.returncode==0 else "FAILED"),{"op":"end","sessionId":sid,"invocationId":invocation}])
                return {"exitCode":process.returncode,"stdout":stdout.decode(errors="replace"),"stderr":stderr.decode(errors="replace"),"changedPaths":[c["path"] for c in changes]}
            if op=="finish":
                response=request.get("finalResponse")
                if not isinstance(response,str) or len(response)>24000:raise ValueError("Invalid final response")
                digest=hashlib.sha256(json.dumps(snapshot(self.root/"workspace"),sort_keys=True,separators=(",",":")).encode()).hexdigest()
                replies=self.send([{"op":"bind-response","sessionId":sid,"responseHash":hashlib.sha256(response.encode()).hexdigest()},{"op":"begin","sessionId":sid,"invocationId":invocation,"requiredEvents":1},event("FINAL_RESPONSE_CAPTURED","",{"responseHash":hashlib.sha256(response.encode()).hexdigest(),"workspaceDigest":digest}),{"op":"end","sessionId":sid,"invocationId":invocation},{"op":"seal","sessionId":sid}]);session["closed"]=True
                return {"snapshot":replies[-1]["snapshot"]}
            raise ValueError("Unknown dispatcher operation")

if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--root",required=True);parser.add_argument("--store",required=True);parser.add_argument("--collector",required=True);parser.add_argument("--socket",required=True);a=parser.parse_args()
    if os.getuid()!=0:raise RuntimeError("Dispatcher must start under trusted Linux administrator")
    dispatcher=Dispatcher(a.root,a.store,a.collector)
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            _,uid,_=struct.unpack("3i",self.request.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
            for line in iter(lambda:self.rfile.readline(128000),b""):
                try:
                    if uid!=HOST_UID:raise PermissionError("UNAUTHENTICATED_HOST")
                    result={"ok":True,**dispatcher.handle(json.loads(line))}
                except Exception as e:result={"ok":False,"error":str(e)}
                self.wfile.write((json.dumps(result)+"\n").encode());self.wfile.flush()
    class Server(socketserver.ThreadingUnixStreamServer):daemon_threads=True
    with Server(a.socket,Handler) as server:
        os.chown(a.socket,0,HOST_UID);os.chmod(a.socket,0o660);print(json.dumps({"ready":True}),flush=True);server.serve_forever()
