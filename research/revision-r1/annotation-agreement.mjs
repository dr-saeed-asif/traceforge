import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonl,csvRecords,parseCsv,parseArgs,toCsv} from '../annotation/lib.mjs';
export function cohenKappa(a,b){if(a.length!==b.length||!a.length)throw Error('Paired nonempty observations required');const labels=new Set([...a,...b]),n=a.length,observed=a.filter((v,i)=>v===b[i]).length/n,expected=[...labels].reduce((s,l)=>s+a.filter(v=>v===l).length*b.filter(v=>v===l).length/(n*n),0);return {n,observed,expected,kappa:expected===1?null:(observed-expected)/(1-expected)};}
export function agreement(dataset,left,right){
 const all={span:[[],[]],type:[[],[]],verdict:[[],[]]},disagreements=[];
 for(const s of dataset){const tokens=[...s.finalResponse.matchAll(/[\p{L}\p{N}_]+|[^\s]/gu)].map(m=>({start:m.index,end:m.index+m[0].length})),sets=[left,right].map(rows=>{
  const rs=rows.filter(r=>r.session_id===s.id&&r.source_quote?.trim());if(!rows.some(r=>r.session_id===s.id&&String(r.annotation_status).toUpperCase()==='COMPLETE'))throw Error(s.id+': unfinished independent annotation');
  const labels=tokens.map(()=>({span:'O',type:'O',verdict:'O'}));
  for(const r of rs){if(String(r.annotation_status).toUpperCase()!=='COMPLETE'||!r.claim_type||!['VERIFIED','CONTRADICTED','UNSUPPORTED','UNVERIFIABLE'].includes(r.annotator_verdict))throw Error('Incomplete claim annotation');
   const quote=r.source_quote,start=r.source_start?.trim()?Number(r.source_start):s.finalResponse.indexOf(quote);if(start<0||s.finalResponse.slice(start,start+quote.length)!==quote||(!r.source_start?.trim()&&s.finalResponse.indexOf(quote,start+1)!==-1))throw Error('Ambiguous/missing quote; provide source_start offset');
   const selected=tokens.map((t,i)=>({t,i})).filter(({t})=>t.start>=start&&t.end<=start+quote.length);for(const [part,{i}]of selected.entries()){if(labels[i].span!=='O')throw Error('Overlapping spans need author resolution before token agreement');labels[i]={span:part?'I':'B',type:r.claim_type,verdict:r.annotator_verdict};}
  }return labels;
 });
 for(let i=0;i<tokens.length;i++){for(const key of Object.keys(all)){all[key][0].push(sets[0][i][key]);all[key][1].push(sets[1][i][key]);}if(JSON.stringify(sets[0][i])!==JSON.stringify(sets[1][i]))disagreements.push([s.id,tokens[i].start,tokens[i].end,JSON.stringify(sets[0][i]),JSON.stringify(sets[1][i])]);}
 }
 return {metrics:Object.entries(all).map(([unit,[a,b]])=>({unit,...cohenKappa(a,b)})),disagreements};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir']));if(existsSync(out))throw Error('Fresh output required');
 const result=agreement(readJsonl(a.dataset??'research/datasets/natural-v1.jsonl'),csvRecords(parseCsv(readFileSync(String(a.a),'utf8'))).records,csvRecords(parseCsv(readFileSync(String(a.b),'utf8'))).records);mkdirSync(out,{recursive:true});
 writeFileSync(join(out,'kappa.csv'),toCsv([['unit','tokens','observed_agreement','chance_agreement','kappa'],...result.metrics.map(r=>[r.unit,r.n,r.observed,r.expected,r.kappa])]));writeFileSync(join(out,'disagreements.csv'),toCsv([['session_id','start','end','annotator_a','annotator_b'],...result.disagreements]));writeFileSync(join(out,'README.md'),'Token-level Cohen kappa on a fixed tokenization of every final response: BIO span, claim type and verdict including O outside claims. No ambiguous or unfinished annotations accepted. Undefined kappa is blank, never replaced by 1. Independent author annotation remains a prerequisite.\n');
}
