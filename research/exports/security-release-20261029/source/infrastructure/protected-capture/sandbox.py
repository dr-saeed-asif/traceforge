"""Root-owned Linux tool dispatcher primitives. No host filesystem or network in tools.
The controlling Windows/WSL administrator is trusted; agent commands are not.
"""
import ctypes, json, os, resource, shutil, socket, subprocess, sys, sysconfig
from pathlib import Path

COLLECTOR_UID, HOST_UID, AGENT_UID = 61000, 61001, 61002

def prepare_root(path):
    path=Path(path);path.mkdir(mode=0o755,parents=True)
    for d in ["usr/bin","usr/lib","lib","lib64","bin","run","protected","workspace","tmp"]:(path/d).mkdir(parents=True,exist_ok=True)
    binary=Path(sys.executable).resolve()
    executables={binary:path/"usr/bin/python3",Path("/bin/sh").resolve():path/"bin/sh",Path("/usr/bin/node").resolve():path/"usr/bin/node"}
    for src,dst in executables.items():shutil.copy2(src,dst)
    # Debian/Ubuntu externalize some Node builtins into this read-only tree.
    if Path('/usr/share/nodejs').is_dir():
        shutil.copytree('/usr/share/nodejs',path/'usr/share/nodejs',dirs_exist_ok=True)
    library=Path(sysconfig.get_path("stdlib"))
    shutil.copytree(library,path/"usr/lib"/library.name,ignore=shutil.ignore_patterns("__pycache__","site-packages","dist-packages"),dirs_exist_ok=True)
    binaries=[*executables,*library.glob("lib-dynload/*.so")]
    deps=set()
    for file in binaries:
        result=subprocess.run(["ldd",str(file)],capture_output=True,text=True)
        for line in result.stdout.splitlines():
            for value in line.split():
                if value.startswith("/") and Path(value).is_file():deps.add(Path(value))
    for file in deps:
        target=path/str(file).lstrip("/");target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target)
    os.chown(path/"workspace",AGENT_UID,AGENT_UID);os.chmod(path/"workspace",0o700)
    os.chown(path/"tmp",AGENT_UID,AGENT_UID);os.chmod(path/"tmp",0o700)
    (path/"run/collector.sock").touch()
    return path

def sandbox_preexec(root, store, endpoint):
    # Separate namespaces; no /proc, Windows drives, WSL /init, or host credentials.
    libc=ctypes.CDLL(None,use_errno=True)
    if libc.unshare(0x40000000|0x00020000)!=0:raise OSError(ctypes.get_errno(),"Namespace isolation unavailable")
    subprocess.run(["mount","--make-rprivate","/"],check=True)
    subprocess.run(["mount","--bind",str(store),str(root/"protected")],check=True)
    subprocess.run(["mount","--bind",str(endpoint),str(root/"run/collector.sock")],check=True)
    os.chroot(root);os.chdir("/workspace")
    os.setgroups([]);os.setgid(AGENT_UID);os.setuid(AGENT_UID)
    if libc.prctl(38,1,0,0,0)!=0:raise OSError("Cannot enforce no_new_privs")
    resource.setrlimit(resource.RLIMIT_CPU,(10,10));resource.setrlimit(resource.RLIMIT_FSIZE,(2*1024*1024,2*1024*1024));resource.setrlimit(resource.RLIMIT_NOFILE,(64,64));resource.setrlimit(resource.RLIMIT_NPROC,(32,32))

def agent_probe(root,store,endpoint,probe,request=None):
    code = r'''
import json,os,socket
result={"uid":os.getuid(),"gid":os.getgid(),"probe":PROBE}
try:
 if PROBE=="inject":
  s=socket.socket(socket.AF_UNIX);s.connect("/run/collector.sock");s.sendall(REQUEST);result["reply"]=s.recv(4096).decode()
 elif PROBE=="delete": os.unlink("/protected/ledger.sqlite3");result["unexpected_success"]=True
 elif PROBE=="rewrite": open("/protected/ledger.sqlite3","wb").write(b"forged");result["unexpected_success"]=True
 elif PROBE=="key_read": open("/protected/collector.key","rb").read();result["unexpected_success"]=True
 elif PROBE=="network":
  s=socket.socket();s.settimeout(.2);s.connect(("1.1.1.1",443));result["unexpected_success"]=True
 elif PROBE=="host_escape": open("/mnt/c/Windows/System32/wsl.exe","rb").read();result["unexpected_success"]=True
except OSError as e: result.update({"blocked":True,"errno":e.errno})
print(json.dumps(result))
'''.replace("PROBE",repr(probe)).replace("REQUEST",repr((json.dumps(request or {"op":"event","sessionId":"victim","sequence":1,"eventId":"forged","payload":{}})+"\n").encode()))
    r=subprocess.run(["/usr/bin/python3","-I","-c",code],capture_output=True,text=True,timeout=15,env={"PATH":"/usr/bin","LANG":"C.UTF-8"},preexec_fn=lambda:sandbox_preexec(root,store,endpoint))
    if r.returncode:raise RuntimeError("Sandbox failed: "+r.stderr[:500])
    value=json.loads(r.stdout)
    if not value.get("blocked") or value.get("unexpected_success"):raise RuntimeError("Sandbox isolation failed: "+json.dumps(value))
    return value

def host_call(endpoint, messages):
    # Fork to a kernel-authenticated, non-agent principal. No credentials in tools.
    read_fd,write_fd=os.pipe();pid=os.fork()
    if pid==0:
        try:
            os.close(read_fd);os.setgroups([]);os.setgid(HOST_UID);os.setuid(HOST_UID)
            s=socket.socket(socket.AF_UNIX);s.connect(str(endpoint));f=s.makefile("rwb")
            replies=[]
            import time
            for message in messages:
                start=time.perf_counter_ns();f.write((json.dumps(message)+"\n").encode());f.flush();reply=json.loads(f.readline());reply["ackMs"]=(time.perf_counter_ns()-start)/1e6;replies.append(reply)
            os.write(write_fd,json.dumps(replies).encode())
        except Exception as e:os.write(write_fd,json.dumps({"error":str(e)}).encode())
        finally:os.close(write_fd);os._exit(0)
    os.close(write_fd);parts=[]
    while True:
        chunk=os.read(read_fd,65536)
        if not chunk:break
        parts.append(chunk)
    os.close(read_fd);os.waitpid(pid,0);value=json.loads(b"".join(parts))
    if isinstance(value,dict):raise RuntimeError(value["error"])
    return value
