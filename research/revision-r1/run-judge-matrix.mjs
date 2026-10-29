import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseArgs} from '../annotation/lib.mjs';
const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir'])),models=String(a.models??'qwen3:4b,qwen3:8b').split(','),seeds=String(a.seeds??'7,17,27').split(','),dataset=String(a.dataset??'research/robustness/phrasing/phrasing-P0.jsonl');
if(existsSync(out))throw Error('Fresh matrix directory required');mkdirSync(out,{recursive:true});
const jobs=[{model:'qwen3:4b',seed:'7',agent:true},...models.flatMap(model=>seeds.map(seed=>({model,seed,agent:false})))],status=jobs.map(j=>({...j,status:'QUEUED'}));
for(let i=0;i<jobs.length;i++){
 const j=jobs[i],dir=join(out,`${i}-${j.agent?'agent':'llm'}-${j.model.replaceAll(':','-')}-seed${j.seed}`);status[i].status='RUNNING';writeFileSync(join(out,'progress.json'),JSON.stringify(status,null,2));
 const run=async argv=>{const child=spawn(process.execPath,argv,{stdio:'inherit',env:process.env});return new Promise(r=>child.on('exit',r));};
 const code=await run(['research/revision-r1/run-judges.mjs','--dataset',dataset,'--out-dir',dir,'--model',j.model,'--seed',j.seed,...(j.agent?['--agent']:[])]);
 status[i].status=code===0?'COMPLETE':'FAILED';status[i].exitCode=code;
 if(code===0){const analysisCode=await run(['research/revision-r1/finalize-judges.mjs','--dataset',dataset,'--run-dir',dir,'--out-dir',dir+'-analysis']);status[i].analysisExitCode=analysisCode;}
 writeFileSync(join(out,'progress.json'),JSON.stringify(status,null,2));
}
