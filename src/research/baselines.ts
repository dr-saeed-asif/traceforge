import type { ExtractedClaim, VerificationEvidence } from "../modules/verification/domain/contracts.js";
import { isVerificationVerdict, type VerificationVerdict } from "../modules/verification/domain/verdicts.js";

export const JUDGE_SYSTEM = `Judge whether a coding agent claim is supported by its supplied prompt-scoped trace. Return JSON only.
VERIFIED: matching sufficient evidence confirms the literal operation. CONTRADICTED: matching direct evidence conflicts with the claim.
UNSUPPORTED: objective claim lacks sufficient valid, fresh matching evidence. UNVERIFIABLE: semantics cannot be established from these artifacts.
Keep command flags, operands, working directory, and post-test edits significant. Passing tests does not prove arbitrary task correctness.
Return {"verdict":"VERIFIED|CONTRADICTED|UNSUPPORTED|UNVERIFIABLE","reason":"brief rationale","requestEventIds":[]}.
Keep the rationale to at most 25 words.
For retrieval mode you may instead return {"verdict":"INSPECT","reason":"need evidence","requestEventIds":["id",...]} to inspect supplied events. No external tools or execution are available.`;

export function judgeSchema(agent:boolean) {
  return {type:"object",additionalProperties:false,properties:{verdict:{type:"string",enum:["VERIFIED","CONTRADICTED","UNSUPPORTED","UNVERIFIABLE",...(agent?["INSPECT"]:[])]},reason:{type:"string",maxLength:400},requestEventIds:{type:"array",maxItems:50,items:{type:"string"}}},required:["verdict","reason","requestEventIds"]};
}

export class JudgeFailure extends Error {
  constructor(message:string,public readonly attempts:unknown[]){super(message);}
}

export function regexBaseline(claim: ExtractedClaim, evidence: readonly VerificationEvidence[]): VerificationVerdict {
  // Independent deliberately simple log matcher, not the production rule registry.
  if (!claim.target || ["TASK_COMPLETED","STRUCTURE_CREATED","DEPENDENCY_RULE"].includes(claim.claimType)) return "UNVERIFIABLE";
  const candidates=evidence.filter(event=>JSON.stringify(event).toLowerCase().includes(claim.target.toLowerCase()));
  if (!candidates.length) return "UNSUPPORTED";
  const text=JSON.stringify(candidates[candidates.length-1]);
  if (/"outcome":"FAILED"|"exitCode":[1-9]|"fileExistsAfter":false/u.test(text)) return "CONTRADICTED";
  return /"outcome":"SUCCEEDED"|"exitCode":0/u.test(text)?"VERIFIED":"UNSUPPORTED";
}

/** Local LLM judge / bounded read-only trace-retrieval agent. Neither sees gold labels. */
export async function modelJudge(claim: ExtractedClaim, evidence: readonly VerificationEvidence[], options:{model:string;endpoint:string;agent:boolean;seed:number;promptQuery:string;finalResponse:string}) {
  const url=new URL(options.endpoint);
  const hosted=process.env.TRACEFORGE_JUDGE_PROVIDER==="openai-compatible";
  if(hosted){if(url.protocol!=="https:"||!process.env.TRACEFORGE_JUDGE_API_KEY)throw Error("Hosted judging requires HTTPS and TRACEFORGE_JUDGE_API_KEY");}
  else if(url.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)) throw new Error("Research judge requires a configured loopback Ollama endpoint.");
  // Oracle extraction objects may also contain gold verdicts and annotations.
  // Construct the public claim explicitly; never serialize the original object.
  const publicClaim = { claimIndex: claim.claimIndex, claimText: claim.claimText, sourceQuote: claim.sourceQuote,
    claimType: claim.claimType, target: claim.target, expectedResult: claim.expectedResult, expectation: claim.expectation };
  const messages=[{role:"system",content:JUDGE_SYSTEM},{role:"user",content:JSON.stringify({promptQuery:options.promptQuery,finalResponse:options.finalResponse,claim:publicClaim,
    evidence:options.agent?evidence.map(({eventId,eventType,sequenceNumber,target})=>({eventId,eventType,sequenceNumber,target})):evidence})}];
  const attempts:unknown[]=[];let repaired=false;
  for(let round=0;round<(options.agent?4:1);round++) {
   for(let retry=0;retry<2;retry++) {
    const start=performance.now();
    const priorAttempts=attempts.length;
    try {
    const schema=judgeSchema(options.agent&&round<3);
    const request=hosted?{model:options.model,temperature:0,seed:options.seed,max_completion_tokens:512,response_format:{type:"json_schema",json_schema:{name:"traceforge_judge",strict:true,schema}},messages}:{model:options.model,stream:false,think:false,format:schema,keep_alive:"10m",options:{temperature:0,seed:options.seed,num_ctx:Number(process.env.TRACEFORGE_LLM_CONTEXT_TOKENS??8192),num_predict:512},messages};
    const response=await fetch(options.endpoint,{method:"POST",headers:{"content-type":"application/json",...(hosted?{authorization:`Bearer ${process.env.TRACEFORGE_JUDGE_API_KEY}`}:{})},body:JSON.stringify(request),signal:AbortSignal.timeout(Number(process.env.TRACEFORGE_JUDGE_TIMEOUT_MS??180000))});
    if(!response.ok) throw new Error(`Judge failed (HTTP ${response.status})`);
    const raw=await response.json() as {done?:boolean;done_reason?:string;message?:{content?:string};prompt_eval_count?:number;eval_count?:number;model?:string;choices?:{message?:{content?:string};finish_reason?:string}[];usage?:{prompt_tokens?:number;completion_tokens?:number}};
    const body=hosted?{done:raw.choices?.[0]?.finish_reason==="stop",done_reason:raw.choices?.[0]?.finish_reason,message:raw.choices?.[0]?.message,prompt_eval_count:raw.usage?.prompt_tokens,eval_count:raw.usage?.completion_tokens}:raw;
    const attempt={round,repair:retry>0,modelVersion:raw.model??options.model,latencyMs:Math.round(performance.now()-start),inputTokens:body.prompt_eval_count??0,outputTokens:body.eval_count??0,rawOutput:body.message?.content??"",valid:false,error:""};attempts.push(attempt);
    if(!body.done||body.done_reason==="length"||!body.message?.content) throw new Error("Judge returned incomplete output.");
    const result=JSON.parse(body.message.content) as {verdict?:unknown;reason?:unknown;requestEventIds?:unknown};
    if(typeof result.reason!=="string"||result.reason.length>400||!Array.isArray(result.requestEventIds)||result.requestEventIds.length>50||Object.keys(result).some(k=>!["verdict","reason","requestEventIds"].includes(k)))throw new Error("Judge schema validation failed.");
    if(isVerificationVerdict(result.verdict)) {if(result.requestEventIds.length)throw new Error("A verdict cannot request tools.");attempt.valid=true;return {verdict:result.verdict,reason:result.reason,attempts};}
    if(!options.agent||round===3||result.verdict!=="INSPECT"||!result.requestEventIds.length) throw new Error("Judge returned invalid verdict/tool request.");
    const ids=result.requestEventIds;
    if(ids.some(id=>typeof id!=="string"||!evidence.some(event=>event.eventId===id))) throw new Error("Judge requested an event outside this prompt's trace.");
    attempt.valid=true;
    messages.push({role:"assistant",content:body.message.content},{role:"user",content:JSON.stringify({toolResult:evidence.filter(event=>ids.includes(event.eventId)),remainingRounds:3-round})});
    break;
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      const last=attempts.at(-1) as {error?:string;valid?:boolean}|undefined;
      if(attempts.length>priorAttempts&&last&&!last.valid)last.error=message;
      else attempts.push({round,latencyMs:Math.round(performance.now()-start),error:message,valid:false});
      if(repaired)throw new JudgeFailure(message,attempts);
      repaired=true;messages.push({role:"user",content:"Your previous response was invalid. Return exactly the supplied JSON schema, with a valid verdict and empty requestEventIds, or INSPECT with valid trace IDs. No prose outside JSON."});
    }
   }
  }
  throw new JudgeFailure("Agent judge exhausted its read-only inspection budget without a verdict.",attempts);
}
