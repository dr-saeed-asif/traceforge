#!/usr/bin/env node
// Run only on an otherwise idle fixed host; never concurrently with judge runs.
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import os from 'node:os';
import {readJsonl,parseArgs,sha256,toCsv} from '../annotation/lib.mjs';
import {OllamaClaimExtractor,EXTRACTION_SYSTEM_PROMPT,CLAIM_SCHEMA} from '../../dist/modules/verification/application/ollama-claim-extractor.js';
import {alignClaims} from '../../dist/research/claim-alignment.js';
import {verifyClaims} from '../../dist/modules/verification/application/claim-verifier.js';
import {metric,saveReport,provenance} from './report.mjs';
const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir'])),models=String(a.models??'qwen3:4b,qwen3:8b').split(','),seeds=String(a.seeds??'7,17,27').split(',').map(Number),datasets=String(a.datasets??'research/robustness/phrasing/phrasing-P0.jsonl,research/robustness/phrasing/phrasing-S.jsonl').split(',');
const sources=datasets.map(path=>({path,cases:readJsonl(path)}));
for(const s of sources)if(s.cases.some(c=>!['controlled','adjudicated'].includes(c.annotationStatus)))throw Error('Unadjudicated natural data cannot be scored: '+s.path);
if(existsSync(out))throw Error('Fresh output required');mkdirSync(out,{recursive:true});
const start=new Date().toISOString(),frozen={system:EXTRACTION_SYSTEM_PROMPT,schema:CLAIM_SCHEMA,temperature:0,contextTokens:8192,repairBudget:1};writeFileSync(join(out,'frozen-prompt.json'),JSON.stringify(frozen,null,2));const promptHash=sha256(readFileSync(join(out,'frozen-prompt.json')));
writeFileSync(join(out,'hardware.json'),JSON.stringify({cpus:os.cpus().map(c=>c.model),totalMemory:os.totalmem(),os:os.release(),models:await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json()),version:await fetch('http://127.0.0.1:11434/api/version').then(r=>r.json())},null,2));
const rows=[],metrics=[],failures=[],summary=[['condition','responses','gold_claims','predicted_claims','matched_claims','precision','recall','f1','fallback_rate','extraction_errors','p50_ms','p95_ms']],provs=[];
for(const model of models)for(const seed of seeds)for(const source of sources){
 const conditions=new Map(['cold','warm'].map(mode=>[mode,{rows:[],gold:0,pred:0,matched:0,fallback:0,errors:0,latencies:[]}]));
 const extractor=new OllamaClaimExtractor({endpoint:'http://127.0.0.1:11434/api/chat',model,seed,contextTokens:8192});
 for(const session of source.cases){
  const unload=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,keep_alive:0}),signal:AbortSignal.timeout(180000)});if(!unload.ok)throw Error('Cold-model unload failed');
  for(const mode of ['cold','warm']){const c=conditions.get(mode),condition=`${source.path}/${model}/seed${seed}/${mode}`,began=performance.now();let extracted={claims:[],metadata:{}},error=null;
   try{extracted=await extractor.extractDetailed({finalResponse:session.finalResponse,modelName:model});}catch(e){error=e.message;extracted.metadata=e.extractionMetadata??{};c.errors++;failures.push({condition,id:session.id,error,claimIndex:''});}
   const latencyMs=performance.now()-began;c.latencies.push(latencyMs);c.fallback+=Number(!!extracted.metadata.fallback);c.gold+=session.goldClaims.length;c.pred+=extracted.claims.length;const aligned=alignClaims(extracted.claims,session.goldClaims),dec=verifyClaims(extracted.claims,session.evidence,{promptId:session.evidence[0]?.promptId});c.matched+=aligned.length;
   for(let i=0;i<session.goldClaims.length;i++){const g=session.goldClaims[i],m=aligned.find(m=>m.goldIndex===i),d=m?dec[m.predictedIndex]:null;c.rows.push({condition,id:session.id,family:session.metadata?.family??session.id,claimIndex:g.claimIndex,gold:g.verdict,predicted:d?.verdict??null,valid:!!d,reason:error??d?.reasonCode??'MISSED',goldAdvisory:!!g.testTampering,advisory:d?.explanation.includes('Advisory:')});}
   appendFileSync(join(out,'extraction-telemetry.jsonl'),JSON.stringify({condition,id:session.id,latencyMs,error,metadata:extracted.metadata,claims:extracted.claims})+'\n');
  }
 }
 for(const [mode,c]of conditions){const condition=`${source.path}/${model}/seed${seed}/${mode}`,p=c.pred?c.matched/c.pred:null,r=c.gold?c.matched/c.gold:null,lat=c.latencies.sort((a,b)=>a-b);summary.push([condition,source.cases.length,c.gold,c.pred,c.matched,p,r,p&&r?2*p*r/(p+r):0,c.fallback/source.cases.length,c.errors,lat[Math.floor((lat.length-1)*.5)],lat[Math.floor((lat.length-1)*.95)]]);rows.push(...c.rows);metrics.push(metric(condition,c.rows,{model,seed}));}
 provs.push(provenance({model_id:model,seed,prompt_sha256:promptHash,start,end:new Date().toISOString(),exit_code:0}));
}
saveReport(out,metrics,rows,failures,provs,'# R9 repeated extraction\n\nTables 6–8 extraction repeats. Three seeds, two models by default. Each response has a truly unloaded cold call immediately followed by a warm call; no extraction cache. Complete adjudication required for natural accuracy. Prompt and hardware frozen; failures and fallback remain included. Run on an idle fixed host and record external interruptions; do not characterize interrupted runs as clean latency measurements.\n');writeFileSync(join(out,'extraction-metrics.csv'),toCsv(summary));
