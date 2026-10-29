"""Linux protected collector. Never run this daemon as the agent's UID.
Origin authentication is kernel SO_PEERCRED, not a bearer token inherited by tools.
"""
import argparse, base64, hashlib, json, os, socket, socketserver, sqlite3, struct, threading, time
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

PROFILE = "3.2.0-capture.1"
ZERO = "0" * 64
def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def digest(value): return hashlib.sha256(value.encode()).hexdigest()

class Collector:
    def __init__(self, directory, host_uid):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if os.stat(self.directory).st_uid != os.getuid() or os.stat(self.directory).st_mode & 0o077:
            raise RuntimeError("Collector storage must be owned by collector and mode 0700")
        if host_uid in (os.getuid(), 0): raise RuntimeError("Trusted host must be a distinct non-root UID")
        self.host_uid = host_uid
        self.lock = threading.Lock()
        key_file = self.directory / "collector.key"
        if not key_file.exists():
            key = Ed25519PrivateKey.generate()
            fd = os.open(key_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "wb") as f: f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        if os.stat(key_file).st_uid != os.getuid() or os.stat(key_file).st_mode & 0o077:
            raise RuntimeError("Unsafe collector key permissions")
        self.key = serialization.load_pem_private_key(key_file.read_bytes(), None)
        self.db = sqlite3.connect(self.directory / "ledger.sqlite3", check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
        self.db.commit()
        os.chmod(self.directory / "ledger.sqlite3", 0o600)

    def public_key(self):
        return self.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def handle(self, uid, request):
        if uid != self.host_uid: return {"ok": False, "error": "UNAUTHENTICATED_ORIGIN"}
        with self.lock:
            sid = request.get("sessionId")
            if not isinstance(sid, str) or not sid or len(sid) > 256: return {"ok": False, "error": "INVALID_SESSION_ID"}
            op = request.get("op")
            row = self.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()
            if op == "register":
                if row: return {"ok": False, "error": "SESSION_ALREADY_REGISTERED"}
                if not isinstance(request.get("promptId"), str) or not request["promptId"]: return {"ok":False,"error":"INVALID_PROMPT"}
                if request.get("responseHash") is not None and (not isinstance(request["responseHash"], str) or len(request["responseHash"]) != 64): return {"ok":False,"error":"INVALID_RESPONSE_HASH"}
                state = {"sessionId": sid, "promptId": request["promptId"], "responseHash": request["responseHash"], "profile": PROFILE,
                         "hostUid": self.host_uid, "collectorUid": os.getuid(), "records": [], "invocations": {}, "errors": [], "deadline": time.time()+300, "sealed": None}
            else:
                if not row: return {"ok": False, "error": "SESSION_NOT_REGISTERED"}
                state = json.loads(row[0])
                if op == "seal" and state["sealed"]: return {"ok":True,"snapshot":state["sealed"]}
                if state["sealed"]: return {"ok":False,"error":"SESSION_SEALED"}
                if time.time() > state["deadline"]: state["errors"].append("SESSION_DEADLINE_EXCEEDED")
                invocation = request.get("invocationId")
                if op == "bind-response":
                    value=request.get("responseHash")
                    if state["responseHash"] is not None or not isinstance(value,str) or len(value)!=64:return {"ok":False,"error":"RESPONSE_ALREADY_BOUND_OR_INVALID"}
                    state["responseHash"]=value
                elif op == "begin":
                    required = request.get("requiredEvents")
                    if not isinstance(invocation,str) or not invocation or invocation in state["invocations"] or type(required) is not int or not 1 <= required <= 10000:
                        return {"ok":False,"error":"INVALID_INVOCATION"}
                    state["invocations"][invocation] = {"required":required,"received":0,"ended":False}
                elif op == "event":
                    seq, event_id, payload = request.get("sequence"), request.get("eventId"), request.get("payload")
                    encoded = canonical(payload)
                    previous = next((r for r in state["records"] if r["eventId"] == event_id), None)
                    if previous and previous["sequence"] == seq and previous["payloadJson"] == encoded and previous["invocationId"] == invocation:
                        return {"ok":True,"sequence":seq,"hash":previous["hash"],"idempotent":True}
                    valid = (type(seq) is int and seq == len(state["records"])+1 and isinstance(event_id,str) and bool(event_id) and not previous and isinstance(payload,dict)
                             and payload.get("promptId") == state["promptId"] and payload.get("eventId") == event_id and invocation in state["invocations"]
                             and not state["invocations"][invocation]["ended"] and state["invocations"][invocation]["received"] < state["invocations"][invocation]["required"])
                    if not valid:
                        state["errors"].append("EVENT_SEQUENCE_OR_IDENTITY_INVALID")
                    else:
                        prev_hash = state["records"][-1]["hash"] if state["records"] else ZERO
                        h = digest(prev_hash+"\n"+str(seq)+"\n"+invocation+"\n"+event_id+"\n"+encoded)
                        state["records"].append({"sequence":seq,"invocationId":invocation,"eventId":event_id,"payloadJson":encoded,"previousHash":prev_hash,"hash":h})
                        state["invocations"][invocation]["received"] += 1
                elif op == "end":
                    if invocation not in state["invocations"]: return {"ok":False,"error":"UNKNOWN_INVOCATION"}
                    inv = state["invocations"][invocation]
                    if inv["received"] != inv["required"]: state["errors"].append("HOOK_OR_TAIL_MISSING")
                    inv["ended"] = True
                elif op == "seal":
                    if state["responseHash"] is None:state["errors"].append("FINAL_RESPONSE_MISSING")
                    if not state["invocations"] or any(not v["ended"] or v["received"] != v["required"] for v in state["invocations"].values()):
                        state["errors"].append("COMPLETION_SEAL_INCOMPLETE")
                    body = {k:v for k,v in state.items() if k not in ("sealed","deadline")}
                    body.update({"valid":not state["errors"],"eventCount":len(state["records"]),"head":state["records"][-1]["hash"] if state["records"] else ZERO})
                    encoded = canonical(body)
                    state["sealed"] = {"payload":encoded,"signature":base64.b64encode(self.key.sign(encoded.encode())).decode()}
                else: return {"ok":False,"error":"UNKNOWN_OPERATION"}
            self.db.execute("INSERT OR REPLACE INTO sessions(id,state) VALUES(?,?)", (sid,canonical(state)))
            self.db.commit()  # FULL synchronous commit before any acknowledgement.
            if state["sealed"]: return {"ok":True,"snapshot":state["sealed"]}
            if op == "event" and state["errors"]: return {"ok":False,"error":state["errors"][-1]}
            return {"ok":True,"sequence":len(state["records"]),"hash":state["records"][-1]["hash"] if state["records"] else ZERO}

def serve(directory, socket_path, host_uid):
    collector = Collector(directory, host_uid)
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            _, uid, _ = struct.unpack("3i", self.request.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
            for line in iter(lambda:self.rfile.readline(2*1024*1024+1), b""):
                try:
                    if len(line)>2*1024*1024: raise ValueError("Request too large")
                    result = collector.handle(uid,json.loads(line))
                except (ValueError,KeyError,TypeError): result = {"ok":False,"error":"INVALID_REQUEST"}
                self.wfile.write((canonical(result)+"\n").encode()); self.wfile.flush()
    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True
    path = Path(socket_path)
    if path.exists(): raise RuntimeError("Refusing to replace an existing collector socket")
    with Server(str(path),Handler) as server:
        os.chmod(path,0o660)
        print(canonical({"ready":True,"publicKeyPem":collector.public_key(),"uid":os.getuid(),"hostUid":host_uid}),flush=True)
        server.serve_forever()

if __name__ == "__main__":
    p=argparse.ArgumentParser(); p.add_argument("--store",required=True);p.add_argument("--socket",required=True);p.add_argument("--host-uid",type=int,required=True)
    a=p.parse_args();serve(a.store,a.socket,a.host_uid)
