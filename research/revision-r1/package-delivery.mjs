import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out=resolve(process.argv[2]??'research/exports/remarks-delivery-20261029');if(existsSync(out))throw Error('Fresh delivery directory required');mkdirSync(out,{recursive:true});
const selections={
 'R1-llm-qwen4b-seed7':'research/exports/remarks-r1-qwen4b-seed7-final-20261029',
 'R1-agent-qwen4b-seed7':'research/runs/remarks-r1-full-matrix-20261029/0-agent-qwen3-4b-seed7-analysis',
 'R2-protected-capture':'research/exports/remarks-r2-instrumented-20261029',
 'R2-registry-audit':'research/exports/remarks-r2-registry-audit-20261029',
 'R4-R5-versioned-policy':'research/exports/remarks-policy320-extraction330-release-20261029',
 'R5-natural-diagnostic':'research/exports/remarks-r5-natural-diagnostic-20261029',
 'R6-network-mcp':'research/exports/remarks-r6-network-mcp-final-20261029',
 'R7-reexecution':'research/exports/remarks-r7-reexecution-final-20261029'
};
for(const[name,path]of Object.entries(selections)){
 for(const f of ['README.md','metrics.csv','per-claim.csv','failures.csv','run-provenance.csv'])if(!existsSync(join(path,f)))throw Error('Incomplete result folder: '+path+'/'+f);
 cpSync(path,join(out,name),{recursive:true});
}
for(const[name,path]of Object.entries({'R1-llm-qwen4b-seed7':'research/exports/remarks-r1-qwen4b-seed7-20261029','R1-agent-qwen4b-seed7':'research/runs/remarks-r1-full-matrix-20261029/0-agent-qwen3-4b-seed7'}))for(const f of ['model.json','frozen-prompt.json','raw.jsonl'])cpSync(join(path,f),join(out,name,f));
const evidence=join(out,'supporting-evidence');mkdirSync(evidence);
for(const path of ['research/exports/remarks-input-audit-20261029','research/exports/remarks-r2-history-audit-20261029','research/annotation/behavior-basis-100'])cpSync(path,join(evidence,path.split('/').at(-1)),{recursive:true});
for(const f of ['acceptance-checks.csv','table10-reproduced.csv'])if(existsSync('research/robustness/runs/remarks-frozen-reproduction-20261029/'+f))cpSync('research/robustness/runs/remarks-frozen-reproduction-20261029/'+f,join(evidence,f));
cpSync('research/revision-r1/DELIVERY-STATUS.md',join(out,'README.md'));
writeFileSync(join(out,'model-matrix-progress-at-packaging.json'),readFileSync('research/runs/remarks-r1-full-matrix-20261029/progress.json'));
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(join(dir,d.name)):[join(dir,d.name)]),manifest=walk(out).map(p=>({path:relative(out,p).replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(p)).digest('hex')}));
writeFileSync(join(out,'manifest.json'),JSON.stringify({packagedAt:new Date().toISOString(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeDirty:true,published:false,completeMeasuredFolders:Object.keys(selections),files:manifest},null,2));
const quote=s=>"'"+s.replaceAll("'","''")+"'",zip=out+'.zip';execFileSync('powershell',['-NoProfile','-Command',`Compress-Archive -Path ${quote(join(out,'*'))} -DestinationPath ${quote(zip)} -CompressionLevel Optimal`]);
writeFileSync(out+'.sha256',createHash('sha256').update(readFileSync(zip)).digest('hex')+'  '+zip.split(/[\\/]/).at(-1)+'\n');console.log(JSON.stringify({out,zip,folders:Object.keys(selections).length,files:manifest.length}));
