import {readFileSync,writeFileSync,existsSync,cpSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseArgs,parseCsv,toCsv} from '../annotation/lib.mjs';
const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir']));if(existsSync(out))throw Error('Fresh output required');mkdirSync(out,{recursive:true});
const source=resolve(String(a['run-dir']));cpSync(source,out,{recursive:true});
for(const name of ['README.md','metrics.csv','per-claim.csv','failures.csv','run-provenance.csv'])if(!existsSync(join(out,name)))throw Error('Missing delivery file: '+name);
const claims=parseCsv(readFileSync(join(out,'per-claim.csv'),'utf8')),rename={id:'session_id',familyId:'family',claimIndex:'claim_index',actual_verdict:'predicted_verdict'};
claims[0]=claims[0].map(k=>rename[k]??k);writeFileSync(join(out,'per-claim.csv'),toCsv(claims));
