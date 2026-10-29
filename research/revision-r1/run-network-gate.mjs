import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createClaimGateHttpServer} from '../../dist/mcp-claim-gate-http.js';
import {buildClaimRecord,signClaimRecord,decideOnClaimRecord} from '../../dist/modules/verification/application/claim-record.js';
import {computeWorkspaceDigest} from '../../dist/modules/verification/application/workspace-digest.js';
import {parseArgs,toCsv} from '../annotation/lib.mjs';
import {saveReport,provenance} from './report.mjs';
const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir']??'research/exports/remarks-r6-network-mcp-20261029'));if(existsSync(out))throw Error('Fresh directory required');mkdirSync(out,{recursive:true});
const start=new Date().toISOString(),key=generateKeyPairSync('ed25519'),foreign=generateKeyPairSync('ed25519'),pub=key.publicKey.export({type:'spki',format:'pem'}),token=randomBytes(32).toString('hex'),records=new Map(),fixtures=[];
for(const condition of ['honest','contradicted','edited-payload','foreign-key','swapped-artifact'])for(let i=0;i<4;i++){
 const id=condition+'-'+i,workspace=join(out,'artifacts',id);mkdirSync(workspace,{recursive:true});writeFileSync(join(workspace,'output.txt'),id);
 const digest=await computeWorkspaceDigest(workspace),input={session:{promptId:id,runId:'network-mcp',agentName:'fixture-author',modelName:'controlled'},claims:[{claimIndex:1,claimType:'TEST_PASSED',claimText:'Tests passed.',target:'node --test',verdict:condition==='contradicted'?'CONTRADICTED':'VERIFIED',reasonCode:'REQUIRED_EVIDENCE_CONFIRMED',evidenceEventIds:['e1'],verificationRuleVersion:'3.2.0'}],traceEvents:[{eventId:'e1',sequenceNumber:1,eventHash:'a'.repeat(64),previousEventHash:null,metadata:{workspaceDigest:digest,workspaceObservation:'complete'}}]};
 const statement=buildClaimRecord(input),signer=condition==='foreign-key'?foreign:key;let envelope=signClaimRecord(statement,signer.privateKey.export({type:'pkcs8',format:'pem'}));
 if(condition==='edited-payload'){const changed=JSON.parse(Buffer.from(envelope.payload,'base64'));changed.predicate.promptId='edited';envelope={...envelope,payload:Buffer.from(JSON.stringify(changed)).toString('base64')};}
 if(condition==='swapped-artifact')writeFileSync(join(workspace,'output.txt'),'swapped');
 const expected=decideOnClaimRecord(envelope,pub,await computeWorkspaceDigest(workspace)).decision;records.set(id,envelope);fixtures.push({id,condition,workspace,expected});
}
writeFileSync(join(out,'fixtures.json'),JSON.stringify(fixtures,null,2));writeFileSync(join(out,'record-public-key.pem'),pub);
const server=createClaimGateHttpServer({token,fetchRecord:async id=>{if(!records.has(id))throw Error('Unknown record');return records.get(id);},publicKeyPem:async()=>pub});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const python=String(a.python??'.traceforge/revision-20261028/venv/Scripts/python.exe');
try{const child=spawn(python,['research/revision-r1/mcp-client.py',`http://127.0.0.1:${server.address().port}/mcp`,join(out,'fixtures.json'),out],{env:{...process.env,TF_EXPERIMENT_MCP_TOKEN:token},stdio:'inherit'});const code=await new Promise(r=>child.on('exit',r));
 const {readFileSync}=await import('node:fs'),rows=JSON.parse(readFileSync(join(out,'client-results.json'))),fields=['condition','records','agreement','failures','latency_p50_ms','latency_p95_ms'];
 const metrics=fixtures.filter((v,i,all)=>all.findIndex(x=>x.condition===v.condition)===i).map(f=>{const rs=rows.filter(r=>r.condition===f.condition),lat=rs.map(r=>r.latencyMs??0).sort((a,b)=>a-b);return [f.condition,rs.length,rs.filter(r=>r.agreement).length/rs.length,rs.filter(r=>r.error).length,lat[Math.floor((lat.length-1)*.5)],lat[Math.floor((lat.length-1)*.95)]];});
 saveReport(out,[],rows.map(r=>({condition:r.condition,id:r.id,family:r.condition,claimIndex:1,gold:r.expected,predicted:r.actual,valid:!r.error,reason:r.agreement?'GATE_PARITY':'MISMATCH'})),rows.filter(r=>r.error).map(r=>({...r,claimIndex:1})),[provenance({python,exit_code:code,start,end:new Date().toISOString()})],'# R6 network consumer\n\nTable 9/additional Web evidence: 20 controlled records, five attack/control classes, all three tools over authenticated Streamable HTTP MCP 2025-11-25. Independent Python JSON-RPC client, not OpenCode; not a live agent-framework study. Full requests/responses retained without bearer secrets. Includes unauthenticated rejection control. Loopback HTTP is a local transport experiment, not public TLS deployment.\n');
 writeFileSync(join(out,'metrics.csv'),toCsv([fields,...metrics]));if(code!==0)throw Error('Independent client failed');console.log(JSON.stringify({records:rows.length,agreement:rows.filter(r=>r.agreement).length}));
}finally{await new Promise(r=>server.close(r));}
