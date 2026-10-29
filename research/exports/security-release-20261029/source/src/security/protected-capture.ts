import { createHash, verify } from "node:crypto";
import { verifyClaims } from "../modules/verification/application/claim-verifier.js";
import type { ExtractedClaim, VerificationEvidence, ClaimVerificationResult } from "../modules/verification/domain/contracts.js";
import type { GateDecision } from "../modules/verification/application/claim-record.js";

export const PROTECTED_CAPTURE_PROFILE = "3.2.0-capture.1";
const sha = (s:string)=>createHash("sha256").update(s).digest("hex");
export interface CaptureEnvelope { payload:string; signature:string }
export interface CaptureResult { valid:boolean; reason:string; evidence:VerificationEvidence[] }

/** Only trust a collector key pinned outside the agent's writable environment. */
export function openProtectedCapture(envelope:CaptureEnvelope, publicKeyPem:string, sessionId:string, response:string):CaptureResult {
  const invalid=(reason:string):CaptureResult=>({valid:false,reason,evidence:[]});
  try {
    if(!verify(null,Buffer.from(envelope.payload),publicKeyPem,Buffer.from(envelope.signature,"base64")))return invalid("SIGNATURE_INVALID");
    const body=JSON.parse(envelope.payload);
    if(body.profile!==PROTECTED_CAPTURE_PROFILE||body.sessionId!==sessionId||body.responseHash!==sha(response)||body.valid!==true||body.errors.length!==0||body.hostUid===body.collectorUid||body.hostUid===0)return invalid("SEAL_INVALID");
    if(!Array.isArray(body.records)||body.records.length!==body.eventCount||!body.invocations||!Object.keys(body.invocations).length)return invalid("COMPLETION_MISSING");
    let head="0".repeat(64);const evidence:VerificationEvidence[]=[],ids=new Set<string>(),counts=new Map<string,number>();
    for(const [index,r]of body.records.entries()) {
      if(r.sequence!==index+1||r.previousHash!==head||ids.has(r.eventId)||!body.invocations[r.invocationId])return invalid("GAP_OR_REPLAY");
      head=sha(`${head}\n${r.sequence}\n${r.invocationId}\n${r.eventId}\n${r.payloadJson}`);
      if(head!==r.hash)return invalid("EVENT_CHANGED");
      const event=JSON.parse(r.payloadJson);
      if(event.promptId!==body.promptId||event.eventId!==r.eventId||!Number.isSafeInteger(event.sequenceNumber)||event.sequenceNumber!==index+1||typeof event.eventType!=="string"||!event.metadata)return invalid("EVENT_IDENTITY_INVALID");
      evidence.push(event);ids.add(r.eventId);counts.set(r.invocationId,(counts.get(r.invocationId)??0)+1);
    }
    if(head!==body.head)return invalid("TAIL_MISSING");
    for(const [id,value]of Object.entries(body.invocations)) {
      const inv=value as {required:number;received:number;ended:boolean};
      if(!inv.ended||!Number.isSafeInteger(inv.required)||inv.required<1||inv.received!==inv.required||counts.get(id)!==inv.required)return invalid("HOOK_OR_TAIL_MISSING");
    }
    // Dispatcher observations are authenticated frames. Expand their observed
    // file deltas; never derive a file event from an agent's asserted result.
    const expanded:VerificationEvidence[]=[];
    for(const event of evidence){
      const argv=event.metadata.argv;
      const changes=event.metadata.changes;
      if(Array.isArray(argv)&&argv.every(v=>typeof v==="string")&&Array.isArray(changes)) {
        for(const [i,value] of changes.entries()) {
          const change=value as {path:string;before:string|null;after:string|null};
          if(typeof change.path!=="string"||change.path.startsWith("/")||change.path.split("/").includes(".."))return invalid("UNSAFE_OBSERVED_PATH");
          expanded.push({...event,eventId:`${event.eventId}:file:${i}`,sequenceNumber:expanded.length+1,eventType:change.after===null?"FILE_DELETED":change.before===null?"FILE_CREATED":"FILE_MODIFIED",target:change.path,metadata:{fileExistedBefore:change.before!==null,fileExistsAfter:change.after!==null,fileHashBefore:change.before,fileHashAfter:change.after}});
        }
        const command=argv.map((v,i)=>i===0?String(v).split("/").at(-1)!:/\s/u.test(String(v))?JSON.stringify(v):String(v)).join(" ");
        expanded.push({...event,sequenceNumber:expanded.length+1,target:command,metadata:{...event.metadata,command,workingDirectory:"/workspace"}});
      }else expanded.push({...event,sequenceNumber:expanded.length+1});
    }
    return {valid:true,reason:"AUTHENTICATED_COMPLETE_CAPTURE",evidence:expanded};
  }catch{return invalid("MALFORMED_OR_MISSING_SEAL");}
}

export function verifyProtectedClaims(claims:readonly ExtractedClaim[], capture:CaptureResult):readonly ClaimVerificationResult[] {
  if(!capture.valid)return claims.map(claim=>({claimIndex:claim.claimIndex,verdict:"UNSUPPORTED",reasonCode:"EVIDENCE_IS_INVALID",explanation:`INVALID protected capture: ${capture.reason}`,evidence:[],ruleVersion:PROTECTED_CAPTURE_PROFILE}));
  const promptId=capture.evidence[0]?.promptId;
  return verifyClaims(claims,capture.evidence,{...(promptId?{promptId}:{}),ruleVersion:PROTECTED_CAPTURE_PROFILE});
}

/** Capture integrity is a prerequisite, including when extraction is empty. */
export function protectedGateDecision(capture:CaptureResult, ordinaryDecision:GateDecision):GateDecision {
  return capture.valid?ordinaryDecision:{decision:"REJECT",reasons:[`INVALID protected capture: ${capture.reason}`]};
}
