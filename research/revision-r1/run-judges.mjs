#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readJsonl,parseArgs,sha256} from '../annotation/lib.mjs';
import {modelJudge,JUDGE_SYSTEM,judgeSchema} from '../../dist/research/baselines.js';
import {metric,saveReport,provenance} from './report.mjs';
const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir'])),model=String(a.model??'qwen3:4b'),seed=Number(a.seed??7),agent=a.agent===true,dataset=resolve(String(a.dataset??'research/robustness/phrasing/phrasing-P0.jsonl'));
if(existsSync(out))throw Error('Fresh output directory required');mkdirSync(out,{recursive:true});
const start=new Date().toISOString(),endpoint=String(a.endpoint??process.env.TRACEFORGE_LLM_ENDPOINT??'http://127.0.0.1:11434/api/chat'),hosted=process.env.TRACEFORGE_JUDGE_PROVIDER==='openai-compatible';
if(hosted&&!a['model-version'])throw Error('Hosted runs require --model-version pinned identifier');
const tags=hosted?{models:[{name:model,digest:String(a['model-version'])}]}:await fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json()),version=hosted?{provider:'hosted API-compatible',endpoint:new URL(endpoint).origin}:await fetch('http://127.0.0.1:11434/api/version').then(r=>r.json()),tag=tags.models.find(m=>m.name===model);
if(!tag)throw Error('Model is not installed: '+model);
const prompt={system:JUDGE_SYSTEM,schema:judgeSchema(agent),temperature:0,contextTokens:Number(process.env.TRACEFORGE_LLM_CONTEXT_TOKENS??8192),repairBudget:1,maxRounds:agent?4:1};
writeFileSync(join(out,'frozen-prompt.json'),JSON.stringify(prompt,null,2));
const promptHash=sha256(readFileSync(join(out,'frozen-prompt.json'))),condition=`${agent?'agent':'llm'}/${model}/seed-${seed}`,rows=[],failures=[];
writeFileSync(join(out,'model.json'),JSON.stringify({tag,version,promptHash,datasetSha256:sha256(readFileSync(dataset))},null,2));
for(const session of readJsonl(dataset)){
 for(const claim of session.goldClaims){const began=performance.now();let result,error=null;
  try{result=await modelJudge(claim,session.evidence,{model,endpoint,agent,seed,promptQuery:session.promptQuery??'',finalResponse:session.finalResponse});}catch(e){error=e.message;result={attempts:e.attempts??[]};failures.push({condition,id:session.id,claimIndex:claim.claimIndex,error});}
  const row={condition,id:session.id,family:session.metadata?.family??session.id,claimIndex:claim.claimIndex,gold:claim.verdict,predicted:result.verdict??null,valid:!error,reason:error??result.reason,latencyMs:performance.now()-began,inputTokens:result.attempts.reduce((s,x)=>s+(x.inputTokens??0),0),outputTokens:result.attempts.reduce((s,x)=>s+(x.outputTokens??0),0)};
  row.goldAdvisory=!!claim.testTampering;
  for(const attempt of result.attempts)if(attempt.error)failures.push({condition,id:session.id,claimIndex:claim.claimIndex,error:'Attempt failure: '+attempt.error,countedAsError:false});
  rows.push(row);appendFileSync(join(out,'raw.jsonl'),JSON.stringify({...row,attempts:result.attempts})+'\n');
 }
 writeFileSync(join(out,'progress.json'),JSON.stringify({completedClaims:rows.length,errors:failures.length,lastSession:session.id}));
 if(rows.length%20===0)console.log(`${condition}: ${rows.length} claims; ${failures.length} errors`);
}
const pricing=hosted&&a['input-usd-per-million']!==undefined&&a['output-usd-per-million']!==undefined?{input:Number(a['input-usd-per-million']),output:Number(a['output-usd-per-million'])}:null;
if(pricing)writeFileSync(join(out,'pricing.json'),JSON.stringify({...pricing,unit:'USD per million tokens',scope:'User-supplied tariff estimate; not billed invoice'},null,2));
const costUsd=pricing?rows.reduce((s,r)=>s+(r.inputTokens*pricing.input+r.outputTokens*pricing.output)/1e6,0):null;
const m=metric(condition,rows,{model,seed,costUsd});saveReport(out,[m],rows,failures,[provenance({model_id:model,model_version:tag.digest,seed,prompt_sha256:promptHash,start,end:new Date().toISOString(),exit_code:0})],`# R1 judges\n\nAdditional Table 6 rows. ${condition}; full trace and public claim only, no gold labels supplied to model. Frozen prompt SHA-256 ${promptHash}. Temperature 0; one schema repair; remaining output failures are errors. Every invalid attempt is retained, including repaired attempts. Bootstrap 2000, seed 7, separately by session and family; exact binomial bounds supplementary. Local token counts are not monetary costs. Any supplied hosted tariff produces an estimated token cost, not an invoice. Bounded retrieval is an SDK-independent read-only judge, not a reproduction of another agent framework.\n`);
writeFileSync(join(out,'judge-metrics.csv'),readFileSync(join(out,'metrics.csv')));console.log(JSON.stringify(m));
