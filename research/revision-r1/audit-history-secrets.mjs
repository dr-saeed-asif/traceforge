import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {toCsv} from '../annotation/lib.mjs';
const out='research/exports/remarks-r2-history-audit-20261029';if(existsSync(out))throw Error('Fresh output required');mkdirSync(out,{recursive:true});
const paths=['.env','.env.example','apps/web/.env','apps/web/.env.example','apps/web/.env.local','.env.production','apps/web/.env.production.example'];
const commits=execFileSync('git',['log','--all','--format=%H','--',...paths],{encoding:'utf8'}).trim().split('\n').filter(Boolean),findings=new Map();
for(const commit of commits)for(const path of paths){let content;try{content=execFileSync('git',['show',`${commit}:${path}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{continue;}
 for(const line of content.split(/\r?\n/)){const match=/^([A-Z0-9_]*(?:PRIVATE_KEY|API_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);if(!match)continue;const value=match[2].replace(/^["']|["']$/g,'').trim();if(!value||/^(?:your|replace|example|changeme|<|test|dummy|0x0+$)/i.test(value))continue;
 const fingerprint=createHash('sha256').update(value).digest('hex');let publicAddress='';if(/PRIVATE_KEY/i.test(match[1])&&/^0x[0-9a-f]{64}$/i.test(value)){try{publicAddress=privateKeyToAccount(value).address;}catch{}}
 const key=match[1]+'::'+fingerprint,prior=findings.get(key);if(prior)prior.commits.add(commit);else findings.set(key,{name:match[1],fingerprint,path,commits:new Set([commit]),publicAddress,status:'EXPOSED_CANDIDATE; external revocation unconfirmed'});
 }
}
writeFileSync(join(out,'credential-history-audit.csv'),toCsv([['variable','value_sha256','example_path','commits_containing_value','public_address_if_ec_key','revocation_status'],...[...findings.values()].map(f=>[f.name,f.fingerprint,f.path,f.commits.size,f.publicAddress,f.status])]));
writeFileSync(join(out,'README.md'),'Read-only audit of all reachable revisions of known environment/configuration paths. Values never exported; SHA-256 fingerprints and public EC addresses only. This is not an exhaustive repository-wide secret scanner, external revocation, or certification that history is clean. Candidate values may include non-production examples. Every exposed real credential must be revoked at its provider; a local replacement or archive does not do that.\n');console.log(JSON.stringify({revisions:commits.length,candidates:findings.size,secretValuesExported:0}));
