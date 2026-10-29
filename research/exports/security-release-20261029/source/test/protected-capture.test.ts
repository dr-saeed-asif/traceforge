import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { expect,it } from "vitest";
import { openProtectedCapture,verifyProtectedClaims,protectedGateDecision,PROTECTED_CAPTURE_PROFILE } from "../src/security/protected-capture.js";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function fixture(){
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");const response="Created a.ts.";
 const event={promptId:"p",eventId:"e1",sequenceNumber:1,eventType:"FILE_CREATED",outcome:"SUCCEEDED",occurredAt:"2026-01-01T00:00:00Z",target:"a.ts",metadata:{fileExistedBefore:false,fileExistsAfter:true}};
 const payloadJson=JSON.stringify(event),zero="0".repeat(64),head=hash(`${zero}\n1\ni1\ne1\n${payloadJson}`);
 const body={profile:PROTECTED_CAPTURE_PROFILE,sessionId:"s",promptId:"p",responseHash:hash(response),hostUid:61001,collectorUid:61000,valid:true,errors:[],eventCount:1,invocations:{i1:{required:1,received:1,ended:true}},records:[{sequence:1,invocationId:"i1",eventId:"e1",payloadJson,previousHash:zero,hash:head}],head};
 const seal=(value:unknown)=>{const payload=JSON.stringify(value);return{payload,signature:sign(null,Buffer.from(payload),privateKey).toString("base64")};};
 return{body,response,seal,envelope:seal(body),publicKey:publicKey.export({type:"spki",format:"pem"}).toString()};
}
it("checks the pinned signature, session, response, event hashes and independent completion expectations",()=>{
 const f=fixture();expect(openProtectedCapture(f.envelope,f.publicKey,"s",f.response).valid).toBe(true);
 expect(openProtectedCapture(f.envelope,f.publicKey,"other",f.response).valid).toBe(false);
 expect(openProtectedCapture(f.envelope,f.publicKey,"s","Another report").valid).toBe(false);
 expect(openProtectedCapture({...f.envelope,payload:f.envelope.payload+" "},f.publicKey,"s",f.response).valid).toBe(false);
 expect(openProtectedCapture(f.seal({...f.body,records:[]}),f.publicKey,"s",f.response).valid).toBe(false);
 expect(openProtectedCapture(f.seal({...f.body,invocations:{i1:{required:2,received:1,ended:true}}}),f.publicKey,"s",f.response).valid).toBe(false);
 expect(openProtectedCapture(f.seal({...f.body,valid:false,errors:["HOOK_MISSING"]}),f.publicKey,"s",f.response).valid).toBe(false);
});
it("fails closed for an invalid capture even when no claims were extracted",()=>{
 const f=fixture(),capture=openProtectedCapture(f.seal({...f.body,valid:false}),f.publicKey,"s",f.response);
 const claims=[{claimIndex:1,claimText:f.response,claimType:"FILE_CREATED" as const,target:"a.ts",expectedResult:"exists"}];
 expect(verifyProtectedClaims(claims,capture)[0]).toMatchObject({verdict:"UNSUPPORTED",reasonCode:"EVIDENCE_IS_INVALID",ruleVersion:PROTECTED_CAPTURE_PROFILE});
 expect(protectedGateDecision(capture,{decision:"ACCEPT",reasons:[]})).toMatchObject({decision:"REJECT"});
 expect(protectedGateDecision(capture,{decision:"REVIEW",reasons:["empty claims"]})).toMatchObject({decision:"REJECT"});
 expect(verifyProtectedClaims(claims,openProtectedCapture(f.envelope,f.publicKey,"s",f.response))[0]?.verdict).toBe("VERIFIED");
});
