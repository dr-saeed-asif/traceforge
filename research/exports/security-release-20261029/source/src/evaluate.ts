import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { HeuristicClaimExtractor, OllamaClaimExtractor, verifyClaims, type ClaimExtractor, type ExtractedClaim, type VerificationEvidence } from "./modules/verification/index.js";
import { isClaimType } from "./modules/verification/domain/claim-types.js";
import { isVerificationVerdict, type VerificationVerdict } from "./modules/verification/domain/verdicts.js";
import { alignClaims } from "./research/claim-alignment.js";
import { scorePairs, clusteredBootstrap, type ScoredCluster, type ScoredPair } from "./research/metrics.js";
import { modelJudge, regexBaseline, JUDGE_SYSTEM } from "./research/baselines.js";
import { runManifest, sha256 } from "./research/run-manifest.js";
interface GoldClaim extends ExtractedClaim {verdict:VerificationVerdict}
interface Case {id:string;promptQuery?:string;finalResponse:string;evidence:VerificationEvidence[];goldClaims:GoldClaim[];annotationStatus?:string;metadata?:{collectionMetadata?:{taskId?:string}}}
const args=process.argv.slice(2);
const option=(name:string,fallback:string)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1]??fallback;};
const dataset=option("--dataset",args[0]&&!args[0].startsWith("--")?args[0]:"research/evaluation.example.jsonl");
const extractorNames=option("--extractors",option("--extractor",args[1]&&!args[1].startsWith("--")?args[1]:"oracle,heuristic")).split(",");
const baselines=option("--baselines","deterministic,accept,regex").split(",");
const matching=option("--matching","exact");
if(!["exact","relaxed"].includes(matching))throw new Error("--matching must be exact or relaxed (token F1 >= 0.8). Run both separately.");
if(extractorNames.some(x=>!["oracle","heuristic","ollama"].includes(x))||baselines.some(x=>!["deterministic","accept","regex","llm","agent"].includes(x)))throw new Error("Unsupported extractor or baseline.");
const targetMatching=option("--target-matching","strict");if(!["strict","legacy-token"].includes(targetMatching))throw new Error("--target-matching must be strict or legacy-token.");
const clusterUnit=option("--cluster","session");if(!["session","task"].includes(clusterUnit))throw new Error("--cluster must be session or task.");
const repetitions=Number(option("--bootstrap","1000")),seed=Number(option("--seed","42"));
if(!Number.isSafeInteger(repetitions)||repetitions<100||repetitions>10000||!Number.isSafeInteger(seed))throw new Error("Use 100–10000 bootstrap replicates and an integer seed.");
const raw=await readFile(dataset,"utf8");
const cases=raw.replace(/^\uFEFF/u,"").split(/\r?\n/u).filter(line=>line.trim()&&!line.trimStart().startsWith("#")).map(line=>JSON.parse(line) as Case);
const ids=new Set<string>();
for(const item of cases){
 if(!item.id||ids.has(item.id)||typeof item.finalResponse!=="string"||!Array.isArray(item.evidence)||!Array.isArray(item.goldClaims))throw new Error("Dataset requires unique IDs, finalResponse, evidence, and independently labelled goldClaims.");ids.add(item.id);
 if(item.annotationStatus!=="adjudicated"&&!args.includes("--allow-unadjudicated"))throw new Error(`Case ${item.id} has not been independently adjudicated. Use --allow-unadjudicated only for smoke tests.`);
 if(new Set(item.evidence.map(e=>e.promptId)).size>1)throw new Error(`Cross-prompt evidence in ${item.id}`);
 if(clusterUnit==="task"&&!item.metadata?.collectionMetadata?.taskId)throw new Error(`Missing taskId for task-clustered analysis: ${item.id}`);
 const indices=new Set<number>();
 for(const claim of item.goldClaims){if(!isVerificationVerdict(claim.verdict)||!isClaimType(claim.claimType)||!claim.claimText||typeof claim.target!=="string"||typeof claim.expectedResult!=="string"||!Number.isSafeInteger(claim.claimIndex)||claim.claimIndex<1||indices.has(claim.claimIndex))throw new Error(`Invalid gold claim in ${item.id}`);indices.add(claim.claimIndex);}
}
if(!cases.length)throw new Error("Dataset is empty.");
const out=resolve(option("--output",`research/runs/run-${new Date().toISOString().replace(/[:.]/gu,"-")}`));
await mkdir(dirname(out),{recursive:true});await mkdir(out); // Never overwrite a frozen run.
const grouped=new Map<string,Map<string,ScoredPair[]>>();
const predictions:unknown[]=[],latencies:unknown[]=[],extraction:unknown[]=[];
const failures:unknown[]=[];
const extractionCache = new Map<string, {claims: readonly ExtractedClaim[]; sessionId: string}>();
const cacheExtractions = args.includes("--cache-extractions");
let completedSessions = 0;
for(const item of cases){
 for(const extractorName of extractorNames){
  let predicted:readonly ExtractedClaim[]=[];let extractionMetadata:unknown=null;let extractionError:string|null=null;
  const start=performance.now();
  try{
   if(extractorName==="oracle")predicted=item.goldClaims;
   else {
    const cached = cacheExtractions && extractorName === "ollama" ? extractionCache.get(item.finalResponse) : undefined;
    if (cached) { predicted = cached.claims; extractionMetadata = { cacheHit: true, cacheSourceSessionId: cached.sessionId, outcome: "CACHED", attemptCount: 0, usage: { input_tokens: 0, output_tokens: 0 } }; }
    else {const extractor:ClaimExtractor=extractorName==="heuristic"?new HeuristicClaimExtractor():new OllamaClaimExtractor({endpoint:process.env.TRACEFORGE_LLM_ENDPOINT??"http://127.0.0.1:11434/api/chat",model:process.env.TRACEFORGE_LLM_MODEL??"qwen3.5:4b",contextTokens:Number(process.env.TRACEFORGE_LLM_CONTEXT_TOKENS??8192),timeoutMs:Number(process.env.TRACEFORGE_LLM_TIMEOUT_MS??180000)});
    if(extractor.extractDetailed){const result=await extractor.extractDetailed({finalResponse:item.finalResponse,modelName:"evaluation"});predicted=result.claims;extractionMetadata={...result.metadata, cacheHit:false};}else predicted=await extractor.extract({finalResponse:item.finalResponse,modelName:"evaluation"});
    if(cacheExtractions && extractorName === "ollama") extractionCache.set(item.finalResponse, { claims: predicted, sessionId: item.id });
    }
   }
  }catch(error){extractionError=error instanceof Error?error.message:"Extraction failed";extractionMetadata=error && typeof error === "object" && "extractionMetadata" in error ? error.extractionMetadata : null;failures.push({id:item.id,extractor:extractorName,error:extractionError});}
  const alignment=alignClaims(predicted,item.goldClaims,matching==="relaxed");
  extraction.push({id:item.id,extractor:extractorName,gold:item.goldClaims.length,predicted:predicted.length,matched:alignment.length,typeCorrect:alignment.filter(m=>predicted[m.predictedIndex]!.claimType===item.goldClaims[m.goldIndex]!.claimType).length,failed:extractionError!==null,successfulEmpty:!extractionError&&predicted.length===0});
  latencies.push({id:item.id,stage:"extraction",extractor:extractorName,latencyMs:Math.round(performance.now()-start),metadata:extractionMetadata,error:extractionError});
  for(const baseline of baselines){
   const decisions:{verdict:VerificationVerdict|null;reason:unknown}[]=[];
   const judgeStart=performance.now();
   if(baseline==="deterministic"){
    const promptId=item.evidence[0]?.promptId;
    const results=verifyClaims(predicted,item.evidence,{...(promptId?{promptId}:{}),freshness:!args.includes("--no-freshness"),targetMatching:targetMatching as "strict"|"legacy-token"});
    decisions.push(...results.map(value=>({verdict:value.verdict,reason:value})));
   }else for(const claim of predicted){
    try{if(baseline==="accept")decisions.push({verdict:"VERIFIED",reason:"B0 accepts every reported claim"});
    else if(baseline==="regex")decisions.push({verdict:regexBaseline(claim,item.evidence),reason:"B3 independent target substring / completion marker matcher"});
    else {const result=await modelJudge(claim,item.evidence,{model:option("--judge-model",process.env.TRACEFORGE_JUDGE_MODEL??process.env.TRACEFORGE_LLM_MODEL??"qwen3.5:4b"),endpoint:process.env.TRACEFORGE_LLM_ENDPOINT??"http://127.0.0.1:11434/api/chat",agent:baseline==="agent",seed,promptQuery:item.promptQuery??"",finalResponse:item.finalResponse});decisions.push({verdict:result.verdict,reason:result});}}
    catch(error){decisions.push({verdict:null,reason:error instanceof Error?error.message:"Judge failure"});failures.push({id:item.id,extractor:extractorName,baseline,claimIndex:claim.claimIndex,error:decisions.at(-1)!.reason});}
   }
   latencies.push({id:item.id,stage:"verification",extractor:extractorName,baseline,latencyMs:Math.round(performance.now()-judgeStart)});
   const pairs:ScoredPair[]=alignment.map(m=>({expected:item.goldClaims[m.goldIndex]!.verdict,actual:decisions[m.predictedIndex]?.verdict??null}));
   const matchedGold=new Set(alignment.map(m=>m.goldIndex)),matchedPred=new Set(alignment.map(m=>m.predictedIndex));
   item.goldClaims.forEach((claim,index)=>{if(!matchedGold.has(index))pairs.push({expected:claim.verdict,actual:null});});
   predicted.forEach((_,index)=>{if(!matchedPred.has(index)&&decisions[index]?.verdict)pairs.push({expected:null,actual:decisions[index]!.verdict});});
   const key=`${extractorName}/${baseline}`,cluster=clusterUnit==="task"?item.metadata!.collectionMetadata!.taskId!:item.id;
   if(!grouped.has(key))grouped.set(key,new Map());const map=grouped.get(key)!;map.set(cluster,[...(map.get(cluster)??[]),...pairs]);
   predictions.push({id:item.id,extractor:extractorName,baseline,claims:predicted,decisions,alignment,pairs,extractionError});
  }
 }
 completedSessions++;
 await writeFile(join(out,"progress.json"),JSON.stringify({completedSessions,totalSessions:cases.length,lastSessionId:item.id,failures:failures.length,updatedAt:new Date().toISOString()}));
 if(completedSessions%10===0) console.error(`Evaluated ${completedSessions}/${cases.length} sessions; failures=${failures.length}`);
}
const reports=Object.fromEntries([...grouped].map(([key,groups])=>{const clusters:ScoredCluster[]=[...groups].map(([id,pairs])=>({id,pairs}));return[key,{...scorePairs(clusters.flatMap(c=>c.pairs)),clusters:clusters.length,confidenceIntervals:clusteredBootstrap(clusters,repetitions,seed)}];}));
const manifest={...runManifest(),cacheExtractions,requestedContextTokens:Number(process.env.TRACEFORGE_LLM_CONTEXT_TOKENS??8192),extractionCacheEntries:extractionCache.size,dataset:resolve(dataset),datasetHash:sha256(raw),datasetSessions:cases.length,extractors:extractorNames,baselines,matching,relaxedThreshold:matching==="relaxed"?0.8:null,clusterUnit,seed,bootstrap:repetitions,targetMatching,freshness:!args.includes("--no-freshness"),allowUnadjudicated:args.includes("--allow-unadjudicated"),judgePrompt:JUDGE_SYSTEM,judgeModel:option("--judge-model",process.env.TRACEFORGE_JUDGE_MODEL??process.env.TRACEFORGE_LLM_MODEL??"not-used"),agentBaseline:"bounded read-only trace-retrieval adaptation; not a reproduction of Agent-as-a-Judge",failures:failures.length};
await writeFile(join(out,"run-manifest.json"),JSON.stringify(manifest,null,2));
await writeFile(join(out,"metrics.json"),JSON.stringify(reports,null,2));
for(const [name,rows] of Object.entries({predictions,latencies,extraction,failures}))await writeFile(join(out,name+".jsonl"),rows.map(row=>JSON.stringify(row)).join("\n")+"\n");
await writeFile(join(out,"dataset.jsonl"),raw);
console.log(JSON.stringify({output:out,sessions:cases.length,failures:failures.length,reports},null,2));
