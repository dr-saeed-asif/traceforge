"""Generate a new signing key inside protected Linux storage, never stdout/Git.
Print ONLY its uncompressed public key and protected credential location.
"""
import argparse, json, os, secrets, uuid
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

if __name__ == "__main__":
    p=argparse.ArgumentParser();p.add_argument("--public-output",required=True);a=p.parse_args()
    if os.getuid()!=0:raise RuntimeError("Use the trusted deployment administrator")
    root=Path("/var/lib/traceforge-keys")/("rotation-"+uuid.uuid4().hex)
    root.mkdir(parents=True,mode=0o700)
    key=ec.generate_private_key(ec.SECP256K1());private=key.private_numbers().private_value.to_bytes(32,"big")
    fd=os.open(root/"signer.hex",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,"w")as f:f.write("0x"+private.hex()+"\n")
    public=key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
    info={"publicKey":"0x"+public.hex(),"privateKeyLocation":str(root/"signer.hex"),"permissions":"root-only 0700 directory / 0600 file","status":"GENERATED_NOT_ACTIVATED_ON_CHAIN","revokedSigner":"0xC5D9e40Aa244e30d7C0953D1Ecd76B7c42c31d26"}
    out=Path(a.public_output)
    if out.exists():raise RuntimeError("Refusing to replace an existing rotation record")
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(info,indent=2));print(json.dumps(info))
