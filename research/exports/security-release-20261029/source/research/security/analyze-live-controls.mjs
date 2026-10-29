import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readJsonl,toCsv,parseArgs} from '../annotation/lib.mjs';
import {openProtectedCapture,verifyProtectedClaims} from '../../dist/security/protected-capture.js';
import {extractClaims} from '../../dist/modules/verification/application/claim-extractor.js';
const args=parseArgs(process.argv.slice(2));
const run=resolve(args['run-dir']??'research/security/runs/live-dispatcher-20261029-persistent'),out=resolve(args['out-dir']??'research/exports/protected-live-controls-20261029');
if(existsSync(out))throw Error('Use a fresh output directory');mkdirSync(out,{recursive:true});
const key=readFileSync('research/security/runs/capture-20261029-v1/collector-public-key.pem','utf8');
const rows=[['control','session_id','capture_valid','claim_index','statement','verdict','reason_code','reason']];
for(const c of readJsonl(join(run,'live-controls.jsonl'))){const capture=openProtectedCapture(c.snapshot,key,c.id,c.finalResponse),claims=extractClaims(c.finalResponse),decisions=verifyProtectedClaims(claims,capture);if(!capture.valid)throw Error(capture.reason);for(let i=0;i<claims.length;i++)rows.push([c.name,c.id,capture.valid,claims[i].claimIndex,claims[i].claimText,decisions[i].verdict,decisions[i].reasonCode,decisions[i].explanation]);}
writeFileSync(join(out,'live-control-claims.csv'),toCsv(rows));writeFileSync(join(out,'README.md'),'Two real sandbox command controls, separate from the 200-session replay experiment. Descriptive functional checks only; not an accuracy benchmark or natural-agent evaluation.\n');console.log(JSON.stringify({controls:2,claims:rows.length-1,output:out}));
