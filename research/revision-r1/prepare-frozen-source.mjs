import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {sourceDigest} from '../robustness/scripts/freeze.mjs';
const manifest=JSON.parse(readFileSync('research/robustness/baseline-manifest.json')),root=resolve('.traceforge/frozen-source-310');
if(!existsSync(root)){
 const zip=resolve('.traceforge/frozen-source-310.zip');execFileSync('git',['archive','--format=zip',`--output=${zip}`,manifest.sourceCommit,'src','tsconfig.json','package.json','package-lock.json']);
 const quote=s=>"'"+s.replaceAll("'","''")+"'";execFileSync('powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(root)}`]);
}
for(const p of Object.keys(manifest.sourceFiles))if(!existsSync(join(root,p))){
 const bytes=p.startsWith('research/robustness/')?readFileSync(p):execFileSync('git',['show',`${manifest.sourceCommit}:${p}`]);
 if(sourceDigest(p,bytes)!==manifest.sourceFiles[p])throw Error('Reference mismatch: '+p);
 mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),bytes);
}
for(const[p,hash]of Object.entries(manifest.sourceFiles))if(sourceDigest(p,readFileSync(join(root,p)))!==hash)throw Error('Frozen runtime mismatch: '+p);
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p',join(root,'tsconfig.json')],{stdio:'inherit'});console.log(JSON.stringify({frozenRuntime:root,baselineCommit:manifest.sourceCommit,verified:true}));
