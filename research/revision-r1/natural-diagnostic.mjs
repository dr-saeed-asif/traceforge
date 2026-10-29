import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {readJsonl,toCsv} from '../annotation/lib.mjs';
import {extractClaims} from '../../dist/modules/verification/application/claim-extractor.js';
import {verifyClaims} from '../../dist/modules/verification/application/claim-verifier.js';
import {extractClaims as oldExtract} from '../../.traceforge/frozen-source-310/dist/modules/verification/application/claim-extractor.js';
import {verifyClaims as oldVerify} from '../../.traceforge/frozen-source-310/dist/modules/verification/application/claim-verifier.js';
import {provenance,saveReport} from './report.mjs';
const out='research/exports/remarks-r5-natural-diagnostic-20261029';if(existsSync(out))throw Error('Fresh output required');mkdirSync(out,{recursive:true});const start=new Date().toISOString(),rows=[],counts=[];
for(const [condition,extract,verify] of [['3.1.0/3.2.0',oldExtract,oldVerify],['3.2.0/3.3.0',extractClaims,verifyClaims]]){
 const rs=[];for(const s of readJsonl('research/datasets/natural-v1.jsonl')){const claims=extract(s.finalResponse),decisions=verify(claims,s.evidence,{promptId:s.evidence[0]?.promptId});claims.forEach((c,i)=>rs.push({condition,id:s.id,family:s.metadata?.family??s.id,claimIndex:c.claimIndex,gold:null,predicted:decisions[i].verdict,reason:decisions[i].reasonCode,valid:true,claimText:c.claimText,explanation:decisions[i].explanation}));}
 rows.push(...rs);for(const reason of new Set(rs.map(r=>r.reason)))counts.push([condition,reason,rs.filter(r=>r.reason===reason).length]);
}
saveReport(out,[],rows,[],[provenance({start,end:new Date().toISOString(),exit_code:0})],'# R5 natural diagnostic\n\nForty unadjudicated sessions, before/after extractor and verifier. Gold fields ignored entirely. Reason-count changes are diagnostic outputs, not accuracy, FVR, extraction P/R/F1 or human agreement. Genuine independent annotations and adjudication remain required.\n');writeFileSync(join(out,'metrics.csv'),toCsv([['condition','reason_code','claims'],...counts]));writeFileSync(join(out,'diagnostic-details.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');console.log(JSON.stringify({sessions:40,rows:rows.length}));
