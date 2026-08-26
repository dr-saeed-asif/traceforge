import type { EvidenceLevel, ProvenanceEvent } from "@traceforge/domain";

export const COMPLETENESS_CATEGORIES = [
  "prompt", "agent", "model", "tool", "resource", "file", "command", "artifact", "test", "approval", "git"
] as const;
export type CompletenessCategory = typeof COMPLETENESS_CATEGORIES[number];
export interface CategoryCoverage { readonly category:CompletenessCategory; readonly status:EvidenceLevel|"NOT_OBSERVED"; readonly observedEvents:number; }
export interface CompletenessReport { readonly categories:readonly CategoryCoverage[]; readonly observableCategories:number; readonly observedCategories:number; readonly score:number|null; }

const eventCategories:Readonly<Record<string,CompletenessCategory>>={
  PROMPT_SUBMITTED:"prompt",AGENT_STARTED:"agent",MODEL_REQUEST:"model",TOOL_STARTED:"tool",RESOURCE_ACCESSED:"resource",
  FILE_READ:"file",FILE_CREATED:"file",FILE_MODIFIED:"file",FILE_DELETED:"file",FILE_RENAMED:"file",
  TERMINAL_COMMAND_STARTED:"command",ARTIFACT_CREATED:"artifact",ARTIFACT_MODIFIED:"artifact",TEST_STARTED:"test",
  TEST_EXECUTION:"test",HUMAN_APPROVAL:"approval",HUMAN_REJECTION:"approval",CHANGES_REQUESTED:"approval",GIT_COMMIT_CREATED:"git"
};

export function evaluateCompleteness(events:readonly ProvenanceEvent[],declaredUnavailable:Readonly<Partial<Record<CompletenessCategory,"NOT_OBSERVED"|"NOT_AVAILABLE">>>={}):CompletenessReport{
  const categories=COMPLETENESS_CATEGORIES.map((category):CategoryCoverage=>{
    const matching=events.filter(event=>eventCategories[event.eventType]===category);
    if(matching.some(event=>event.source.evidence==="OBSERVED"))return{category,status:"OBSERVED",observedEvents:matching.length};
    const declared=declaredUnavailable[category];if(declared)return{category,status:declared,observedEvents:0};
    if(matching.length>0)return{category,status:matching[0]!.source.evidence,observedEvents:matching.length};
    return{category,status:"UNKNOWN",observedEvents:0};
  });
  const measurable=categories.filter(item=>item.status!=="NOT_AVAILABLE"&&item.status!=="NOT_OBSERVED"),observed=measurable.filter(item=>item.status==="OBSERVED");
  return{categories,observableCategories:measurable.length,observedCategories:observed.length,score:measurable.length===0?null:observed.length/measurable.length};
}

export interface OperationMeasurement<T>{readonly result:T;readonly durationMs:number;readonly heapDeltaBytes:number;}
export async function measureOperation<T>(operation:()=>Promise<T>,clock:()=>number=()=>performance.now()):Promise<OperationMeasurement<T>>{
  const before=process.memoryUsage().heapUsed,start=clock();const result=await operation();const durationMs=clock()-start;
  return{result,durationMs,heapDeltaBytes:process.memoryUsage().heapUsed-before};
}

export interface DynamicRunSummary{readonly agents:number;readonly modelInvocations:number;readonly resources:number;readonly artifacts:number;}
export function summarizeRun(events:readonly ProvenanceEvent[],artifactIds:readonly string[]):DynamicRunSummary{
  const agents=new Set(events.filter(event=>event.eventType==="AGENT_STARTED").map(event=>event.actor.id??event.actor.name).filter((value):value is string=>value!==undefined));
  const invocations=new Set(events.filter(event=>event.eventType==="MODEL_REQUEST").map(event=>typeof event.payload.invocationId==="string"?event.payload.invocationId:event.eventId));
  return{agents:agents.size,modelInvocations:invocations.size,resources:events.filter(event=>event.eventType==="RESOURCE_ACCESSED").length,artifacts:new Set(artifactIds).size};
}
