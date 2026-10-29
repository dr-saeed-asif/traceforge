import {execFileSync} from 'node:child_process';
const paths=execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACMR'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const history=execFileSync('git',['show','5fc292c:.env.example'],{encoding:'utf8'});
const known=history.split(/\r?\n/u).filter(line=>/^[A-Z_]*(?:PRIVATE_KEY|API_KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*=/u.test(line)).map(line=>line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/gu,'')).filter(value=>value.length>24&&!/^(?:your|replace|<)/iu.test(value));
const violations=[];let checked=0;
for(const path of paths){if(path.endsWith('.zip'))continue;const bytes=execFileSync('git',['show',':'+path],{maxBuffer:32*1024*1024});checked++;if(known.some(secret=>bytes.includes(Buffer.from(secret))))violations.push(path);}
console.log(JSON.stringify({checkedStagedFiles:checked,knownHistoricalSecretsFound:violations,scope:'Exact known historical config values only; archives excluded, their source manifest checked separately'}));if(violations.length)process.exitCode=1;
