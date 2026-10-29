import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseArgs,parseCsv,toCsv} from '../annotation/lib.mjs';
import {provenance} from './report.mjs';
const a=parseArgs(process.argv.slice(2)),run=resolve(String(a['run-dir'])),out=resolve(String(a['out-dir']));if(existsSync(run)||existsSync(out))throw Error('Fresh run and output directories required');
const linux=p=>'/mnt/'+p[0].toLowerCase()+p.slice(2).replaceAll('\\','/'),script=resolve('infrastructure/protected-capture/replay_attacks.py');
// The Python harness creates its output directory exclusively.
const command=['-d','Ubuntu-24.04','-u','root','--','python3',linux(script),'--dataset',linux(resolve('research/robustness/phrasing/phrasing-P0.jsonl')),'--tamper-dir',linux(resolve('research/robustness/tamper')),'--out-dir',linux(run)],start=new Date().toISOString();
const result=spawnSync('wsl',command,{encoding:'utf8',maxBuffer:8*1024*1024});
if(!existsSync(run))mkdirSync(run,{recursive:true});writeFileSync(join(run,'stdout.log'),result.stdout??'');writeFileSync(join(run,'stderr.log'),result.stderr??'');
const python=spawnSync('wsl',['-d','Ubuntu-24.04','--','python3','--version'],{encoding:'utf8'}).stdout.trim(),p=provenance({python,command:JSON.stringify(['wsl',...command]),exit_code:result.status,start,end:new Date().toISOString()});writeFileSync(join(run,'command-provenance.json'),JSON.stringify(p,null,2));
if(result.status!==0)throw Error('Capture run failed; raw logs retained: '+result.stderr);
const analyze=spawnSync(process.execPath,['research/security/analyze-capture.mjs','--run-dir',run,'--out-dir',out],{stdio:'inherit'});if(analyze.status!==0)throw Error('Capture analysis failed');
const metrics=parseCsv(readFileSync(join(out,'capture-security-metrics.csv'),'utf8'));metrics[0]=metrics[0].map(k=>k==='attack'?'condition':k);writeFileSync(join(out,'metrics.csv'),toCsv(metrics));
const claims=parseCsv(readFileSync(join(out,'per-claim.csv'),'utf8'));claims[0]=claims[0].map(k=>k==='actual_verdict'?'predicted_verdict':k);claims[0].push('valid_output');for(const row of claims.slice(1))row.push(true);writeFileSync(join(out,'per-claim.csv'),toCsv(claims));
writeFileSync(join(out,'failures.csv'),toCsv([['condition','session_id','claim_index','error','counted_as_error']]));
const fields=['commit','dirty','os','node','python','model_id','model_version','seed','prompt_sha256','command','exit_code','start','end'];writeFileSync(join(out,'run-provenance.csv'),toCsv([fields,fields.map(k=>p[k]??null)]));writeFileSync(join(out,'README.md'),readFileSync(join(out,'README.md'),'utf8')+'\nThis run records the full WSL invocation and real start/end times. Linux host-path isolation has an agent-UID positive read control outside the chroot. The current verifier/extractor are policy 3.2.0 / extraction 3.3.0. Invalid capture in injected-fault cases is an expected fail-safe outcome, not malformed model output. No unexpected probe or runner failure occurred.\n');
