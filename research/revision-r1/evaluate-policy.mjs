#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readJsonl,toCsv,parseArgs,sha256} from '../annotation/lib.mjs';
import {extractClaims} from '../../dist/modules/verification/application/claim-extractor.js';
import {verifyClaims} from '../../dist/modules/verification/application/claim-verifier.js';
import {extractClaims as oldExtract} from '../../.traceforge/frozen-source-310/dist/modules/verification/application/claim-extractor.js';
import {verifyClaims as oldVerify} from '../../.traceforge/frozen-source-310/dist/modules/verification/application/claim-verifier.js';
import {alignClaims} from '../../dist/research/claim-alignment.js';
import {metric,saveReport,provenance} from './report.mjs';
const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir']??'research/exports/remarks-policy320-extraction330-20261029'));if(existsSync(out))throw Error('Fresh directory required');mkdirSync(out,{recursive:true});
const start=new Date().toISOString(),datasets=['P0','P0F','N','L','S'].map(s=>[`phrasing-${s}`,`research/robustness/phrasing/phrasing-${s}.jsonl`]).concat([['matching','research/robustness/matching/matching.jsonl']],['forge','suppress-all','suppress-negative'].map(s=>['tamper-'+s,`research/robustness/tamper/tamper-${s}.jsonl`]));
const all=[],metrics=[],changes=[['dataset','extractor','session_id','claim_index','old_verdict','new_verdict','old_reason','new_reason','explanation']],extractions=[['dataset','extractor','gold','predicted','exact_matched','coverage_detected','exact_precision','exact_recall','exact_f1','false_verified_coverage']],raw=[];
const norm=s=>(s??'').toLowerCase().replace(/\s+/g,' ').replace(/[.]+$/,'').trim();
for(const [name,path]of datasets)for(const ext of ['oracle','heuristic']){
 const rows=[];let goldN=0,predN=0,matchedN=0,covered=0,fv=0;
 for(const s of readJsonl(path)){
  const claims=ext==='oracle'?s.goldClaims:extractClaims(s.finalResponse),oldClaims=ext==='oracle'?s.goldClaims:oldExtract(s.finalResponse),options={promptId:s.evidence[0]?.promptId},dec=verifyClaims(claims,s.evidence,options),before=oldVerify(oldClaims,s.evidence,options),exact=alignClaims(claims,s.goldClaims),used=new Set();goldN+=s.goldClaims.length;predN+=claims.length;matchedN+=exact.length;
  for(const g of s.goldClaims){let parts=claims.map((p,i)=>({p,i})).filter(({p})=>norm(p.sourceQuote??p.claimText).includes(norm(g.sourceQuote??g.claimText))||norm(g.sourceQuote??g.claimText).includes(norm(p.sourceQuote??p.claimText)));const rank={CONTRADICTED:0,UNSUPPORTED:1,UNVERIFIABLE:2,VERIFIED:3};
   const chosen=parts.map(({i})=>{used.add(i);return dec[i];}).sort((x,y)=>rank[x.verdict]-rank[y.verdict])[0],oldParts=oldClaims.map((p,i)=>({p,i})).filter(({p})=>norm(p.sourceQuote??p.claimText).includes(norm(g.sourceQuote??g.claimText))||norm(g.sourceQuote??g.claimText).includes(norm(p.sourceQuote??p.claimText))),old=oldParts.map(({i})=>before[i]).sort((x,y)=>rank[x.verdict]-rank[y.verdict])[0];
   if(chosen)covered++;if(g.verdict!=='VERIFIED'&&chosen?.verdict==='VERIFIED')fv++;
   const row={condition:name+'/'+ext,id:s.id,family:s.metadata?.family??s.id,claimIndex:g.claimIndex,gold:g.verdict,predicted:chosen?.verdict??null,reason:chosen?.reasonCode??'MISSED',valid:!!chosen,goldAdvisory:!!g.testTampering,advisory:chosen?.explanation.includes('Advisory:')};rows.push(row);
   if((old?.verdict??null)!==row.predicted)changes.push([name,ext,s.id,g.claimIndex,old?.verdict??'MISSED',row.predicted??'MISSED',old?.reasonCode??'MISSED',row.reason,chosen?.explanation??'No extraction']);
  }
  for(let i=0;i<claims.length;i++)if(!used.has(i))rows.push({condition:name+'/'+ext,id:s.id,family:s.metadata?.family??s.id,claimIndex:claims[i].claimIndex,gold:null,predicted:dec[i].verdict,reason:'SPURIOUS: '+dec[i].reasonCode,valid:true});
  raw.push({dataset:name,extractor:ext,id:s.id,claims,decisions:dec});
 }
 const p=predN?matchedN/predN:null,r=goldN?matchedN/goldN:null;extractions.push([name,ext,goldN,predN,matchedN,covered,p,r,p&&r?2*p*r/(p+r):0,fv]);all.push(...rows);metrics.push(metric(name+'/'+ext,rows));
}
saveReport(out,metrics,all,[],[provenance({start,end:new Date().toISOString(),exit_code:0})],'# R4/R5 additional versioned results\n\nTables 6–10: policy 3.2.0 / extraction 3.3.0; frozen baseline source compiled from pre-revision Git HEAD separately. Original result files untouched. Per-claim verification uses declared quote-containment coverage; exact one-to-one extraction metrics are separate. Do not mix coverage with exact alignment. Oracle extraction does not change supplied gold expectations. Bootstrap 2000 seed 7; exact FVR bounds supplementary. Every changed covered verdict is in changed-verdicts.csv.\n');
writeFileSync(join(out,'changed-verdicts.csv'),toCsv(changes));writeFileSync(join(out,'extraction-metrics.csv'),toCsv(extractions));writeFileSync(join(out,'predictions.jsonl'),raw.map(r=>JSON.stringify(r)).join('\n')+'\n');console.log(JSON.stringify({out,conditions:metrics.length,changed:changes.length-1}));
