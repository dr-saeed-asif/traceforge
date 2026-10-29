import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseArgs,readJsonl,toCsv} from '../annotation/lib.mjs';
import {computeWorkspaceDigest} from '../../dist/modules/verification/application/workspace-digest.js';
import {expectationFor} from '../../dist/modules/verification/application/claim-extractor.js';
const a=parseArgs(process.argv.slice(2)),source=String(a.sessions??'research/runs/remarks-r7-controlled-20261029/sessions.jsonl'),out=resolve(String(a['out-dir']??'research/runs/remarks-r7-oracle-20261029'));if(existsSync(out))throw Error('Fresh output required');mkdirSync(out,{recursive:true});
const jobs=[];for(const s of readJsonl(source)){
 if(a['workspace-root'])s.workspacePath=join(resolve(String(a['workspace-root'])),encodeURIComponent(s.id));
 if(!s.workspacePath||await computeWorkspaceDigest(s.workspacePath)!==s.finalDigest)throw Error('Missing/changed W-prime: '+s.id);
 for(let i=0;i<s.gold.length;i++){
  const g=s.gold[i],row={id:s.id,family:s.family,claimIndex:i+1,claimType:g.claimType,gold:g.verdict,quote:g.quote,workspace:s.workspacePath,workspaceDigest:s.finalDigest,expectedPassed:expectationFor(g.quote,g.claimType).passed??null,environment:'Linux namespace/chroot; Node 22.14.0/npm 10.9.2; pinned research pytest pure-Python dependencies; Vitest 3.2.4'};
  if(!['TEST_PASSED','COMMAND_SUCCEEDED','BUILD_PASSED'].includes(g.claimType)){jobs.push({...row,excluded:'Claim is not a test/build/command invocation'});continue;}
  const command=/^(?:node|python3?|pytest|vitest|npm|pnpm|yarn|cargo|go)\b/.test(g.target)?g.target:[...s.evidence].reverse().find(e=>(g.claimType==='TEST_PASSED'?e.eventType==='TEST_COMPLETED':g.claimType==='BUILD_PASSED'?e.eventType==='BUILD_COMPLETED':e.eventType==='COMMAND_COMPLETED'))?.target;
  if(!command||/[;&|<>`$\n]/.test(command)){jobs.push({...row,excluded:'Missing or compound/side-effecting command; no safe standalone invocation'});continue;}
  const tokens=command.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g).map(t=>t.replace(/^["']|["']$/g,''));
  if(tokens[0]==='node'&&['--test','--check','-c'].includes(tokens[1])){tokens[0]='/usr/bin/node';jobs.push({...row,argv:tokens});}
  else if((['pytest','vitest','npm','pnpm','yarn','cargo','go'].includes(tokens[0])&&(/\b(?:test|run|build)\b/.test(command)||tokens[0]==='pytest'))||(/^python3?$/.test(tokens[0])&&tokens[1]==='-m'&&tokens[2]==='pytest')){
   const program=tokens[0];tokens[0]='/usr/bin/'+program;jobs.push({...row,argv:tokens,command,environment:row.environment+'; requires '+program+' and project dependencies'});
  }else jobs.push({...row,excluded:'Nondeterministic or side-effecting invocation outside the read-only oracle allowlist',command});
 }
}writeFileSync(join(out,'jobs.json'),JSON.stringify(jobs,null,2));writeFileSync(join(out,'excluded-commands.csv'),toCsv([['session_id','claim_index','command','reason'],...jobs.filter(j=>j.excluded).map(j=>[j.id,j.claimIndex,j.command??j.quote,j.excluded])]));console.log(JSON.stringify({claims:jobs.length,eligible:jobs.filter(j=>j.argv).length,jobs:join(out,'jobs.json')}));
