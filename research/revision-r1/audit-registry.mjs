import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createPublicClient,http} from 'viem';
import {toCsv} from '../annotation/lib.mjs';
import {provenance,saveReport} from './report.mjs';
const out='research/exports/remarks-r2-registry-audit-20261029';if(existsSync(out))throw Error('Fresh output required');mkdirSync(out,{recursive:true});const start=new Date().toISOString();
const addresses=new Map();for(const p of ['.env.example','.env','apps/web/.env','apps/web/.env.local'])if(existsSync(p)){const match=/^TRACEFORGE_SEPOLIA_REGISTRY_ADDRESS\s*=\s*["']?(0x[0-9a-f]{40})/im.exec(readFileSync(p,'utf8'));if(match)addresses.set(match[1],p);}
const client=createPublicClient({transport:http('https://ethereum-sepolia-rpc.publicnode.com',{timeout:15000,retryCount:0})}),rows=[];
for(const[address,path]of addresses){try{const code=await client.getCode({address});if(!code||code==='0x'){rows.push([address,path,'NO_CODE','','','No deployed contract at configured address']);continue;}
 const owner=await client.readContract({address,abi:[{name:'owner',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'owner'}),compromised=owner.toLowerCase()==='0xc5d9e40aa244e30d7c0953d1ecd76b7c42c31d26';
 rows.push([address,path,'DEPLOYED',owner,false,compromised?'Historical compromised signer is immutable V1 owner; cannot claim on-chain revocation. Retire this deployment.':'Owner differs; no comprehensive revocation claim made']);
 }catch(e){rows.push([address,path,'QUERY_FAILED','','',e.shortMessage??e.message]);}}
saveReport(out,[],[],rows.filter(r=>r[2]==='QUERY_FAILED').map(r=>({condition:'registry',id:r[0],claimIndex:'',error:r[5]})),[provenance({start,end:new Date().toISOString(),exit_code:0})],'# R2 deployed registry audit\n\nRead-only Sepolia queries for registry addresses in current project configuration. Not exhaustive discovery of every possible deployment. Immutable V1 cannot revoke its owner signer; local web refusal does not change that contract. No transactions, fees or confirmations measured. Appendix A remains unmeasured. Historical secrets must never be reused. External-provider revocation, coordinated history cleanup and archive publication remain author/admin actions requiring actual account authentication.\n');
writeFileSync(join(out,'metrics.csv'),toCsv([['registry','source_path','status','owner','onchain_revocation_confirmed','finding'],...rows]));console.log(JSON.stringify(rows));
