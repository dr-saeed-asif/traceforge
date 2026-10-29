#!/usr/bin/env node
// Real local-EVM execution, not Sepolia measurements. No production keys used.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createPublicClient,createWalletClient,custom,keccak256,toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {toCsv,parseArgs} from '../annotation/lib.mjs';
const args=parseArgs(process.argv.slice(2)),out=resolve(args['out-dir']??'research/security/registry-tests-20261029');
if(existsSync(out))throw Error('Use a fresh output directory');mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),ganache=require(resolve('.traceforge/security-release/tools/node_modules/ganache'));
const provider=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:3},chain:{chainId:1337}});
const accounts=Object.values(provider.getInitialAccounts()).map(x=>privateKeyToAccount(x.secretKey));
const [owner,other,signer]=accounts,revoked=privateKeyToAccount(toHex(randomBytes(32)));
const client=createPublicClient({transport:custom(provider)}),wallet=createWalletClient({account:owner,transport:custom(provider)});
const artifact=JSON.parse(readFileSync(args.artifact??'research/security/deployment-20261029-final/registry-v2-artifact.json'));
const rows=[['check','passed','detail']],abi=artifact.abi;
const receipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi,bytecode:artifact.bytecode,args:[signer.address,revoked.address],chain:null})}),address=receipt.contractAddress;
const read=(functionName,args=[])=>client.readContract({address,abi,functionName,args});
async function check(name,fn,shouldReject=false){try{await fn();rows.push([name,!shouldReject,shouldReject?'Unexpected success':'Executed']);}catch(e){rows.push([name,shouldReject,String(e.shortMessage??e.message).slice(0,300)]);}}
const types={ClaimAnchor:[['sessionHash','bytes32'],['claimIndex','uint32'],['manifestHash','bytes32'],['evidenceRoot','bytes32'],['schemaVersion','uint32'],['nonce','uint256'],['deadline','uint64'],['signerEpoch','uint64']].map(([name,type])=>({name,type}))};
const domain={name:'TraceForge Verified Claim Registry',version:'2',chainId:1337,verifyingContract:address};
let nonce=0n;
async function authorization(account=signer,overrides={}){const m={sessionHash:keccak256(toHex(`session-${nonce}`)),claimIndex:0,manifestHash:keccak256(toHex('manifest')),evidenceRoot:keccak256(toHex('evidence')),schemaVersion:1,nonce:nonce++,deadline:BigInt((await client.getBlock()).timestamp)+600n,signerEpoch:await read('signerEpoch'),...overrides};return {m,signature:await account.signTypedData({domain,types,primaryType:'ClaimAnchor',message:m})};}
const submit=async({m,signature},account=other)=>{const hash=await createWalletClient({account,transport:custom(provider)}).writeContract({address,abi,functionName:'anchorVerifiedClaimWithAuthorization',args:[m.sessionHash,m.claimIndex,m.manifestHash,m.evidenceRoot,m.schemaVersion,m.nonce,m.deadline,signature],chain:null});const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error('Transaction reverted');return r;};
const good=await authorization();
await check('valid authorization',()=>submit(good));
await check('duplicate rejected',()=>submit(good),true);
await check('expired rejected',async()=>submit(await authorization(signer,{deadline:0n})),true);
await check('foreign signer rejected',async()=>submit(await authorization(other)),true);
await check('revoked signer rejected',async()=>submit(await authorization(revoked)),true);
await check('payload edit rejected',async()=>{const a=await authorization();a.m.manifestHash=keccak256(toHex('edited'));return submit(a);},true);
await check('malformed signature rejected',async()=>{const a=await authorization();a.signature='0x12';return submit(a);},true);
await check('high-s rejected',async()=>{const a=await authorization();const n=BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');const s=BigInt('0x'+a.signature.slice(66,130));a.signature=a.signature.slice(0,66)+(n-s).toString(16).padStart(64,'0')+(a.signature.slice(130)==='1b'?'1c':'1b');return submit(a);},true);
const rotate=async(account,newSigner)=>{const hash=await createWalletClient({account,transport:custom(provider)}).writeContract({address,abi,functionName:'rotateSigner',args:[newSigner],chain:null});const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error('Transaction reverted');};
await check('non-owner rotation rejected',()=>rotate(other,other.address),true);
await check('revoked rotation rejected',()=>rotate(owner,revoked.address),true);
const stale=await authorization();
await check('owner rotation succeeds',()=>rotate(owner,other.address));
await check('old epoch rejected',()=>submit(stale),true);
await check('new signer succeeds',async()=>submit(await authorization(other)));
await check('V1-compatible anchor getter',async()=>{const id=await read('getRecordId',[good.m.sessionHash,0]);const record=await read('getAnchor',[id]);if(!record.verified||record.anchoredBy.toLowerCase()!==other.address.toLowerCase())throw Error('Record mismatch');});
writeFileSync(join(out,'contract-checks.csv'),toCsv(rows));
writeFileSync(join(out,'README.md'),'Local Ganache EVM checks for Registry V2. These are not Sepolia receipts, costs or confirmation measurements. Ephemeral test keys only.\n');
await provider.disconnect();console.log(JSON.stringify({checks:rows.length-1,passed:rows.slice(1).filter(r=>r[1]).length,output:out}));if(rows.some(r=>r[1]===false))process.exitCode=1;
