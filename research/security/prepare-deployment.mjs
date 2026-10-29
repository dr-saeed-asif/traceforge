#!/usr/bin/env node
import { readFileSync,writeFileSync,mkdirSync,existsSync } from "node:fs";
import { resolve,join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { encodeDeployData } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { parseArgs } from "../annotation/lib.mjs";
const args=parseArgs(process.argv.slice(2));
const out=resolve(args["out-dir"]??"research/security/deployment-20261029");
if(existsSync(out))throw new Error("Use a fresh deployment output directory");
const rotation=JSON.parse(readFileSync(String(args.rotation)));
const signer=publicKeyToAddress(rotation.publicKey);
const owner="0x80949bf40bB69ba00Ac21562e7bE2e82450d1919";
if(signer.toLowerCase()===rotation.revokedSigner.toLowerCase())throw new Error("Rotation did not replace compromised signer");
const require=createRequire(import.meta.url),solc=require(resolve(".traceforge/security-release/tools/node_modules/solc"));
const source=readFileSync("packages/claim-anchoring/contracts/VerifiedClaimRegistryV2.sol","utf8");
const input={language:"Solidity",sources:{"VerifiedClaimRegistryV2.sol":{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object"]}}}};
const compiled=JSON.parse(solc.compile(JSON.stringify(input)));
if(compiled.errors?.some(e=>e.severity==="error"))throw new Error(compiled.errors.map(e=>e.formattedMessage).join("\n"));
const contract=compiled.contracts["VerifiedClaimRegistryV2.sol"].VerifiedClaimRegistryV2;
const data=encodeDeployData({abi:contract.abi,bytecode:`0x${contract.evm.bytecode.object}`,args:[signer,rotation.revokedSigner]});
mkdirSync(out,{recursive:true});
const transaction={from:owner,chainId:"0xaa36a7",value:"0x0",data};
let rpcStatus={status:"NOT_CHECKED"};
try{
 const rpc=async(method,params)=>{const r=await fetch("https://ethereum-sepolia-rpc.publicnode.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(10000)});const body=await r.json();if(body.error)throw new Error(body.error.message);return body.result;};
 if(await rpc("eth_chainId",[])!==transaction.chainId)throw new Error("Wrong RPC chain");
 const balance=await rpc("eth_getBalance",[owner,"latest"]);
 const gas=await rpc("eth_estimateGas",[{from:owner,data,value:"0x0"}]);transaction.gas=gas;rpcStatus={status:"READY_FOR_WALLET_SIGNATURE",balanceWei:BigInt(balance).toString(),estimatedGas:BigInt(gas).toString()};
}catch(error){rpcStatus={status:"RPC_PREFLIGHT_FAILED",error:error.message};}
writeFileSync(join(out,"unsigned-sepolia-deployment.json"),JSON.stringify(transaction,null,2));
writeFileSync(join(out,"registry-v2-artifact.json"),JSON.stringify({compiler:solc.version(),abi:contract.abi,bytecode:`0x${contract.evm.bytecode.object}`,deployedBytecode:`0x${contract.evm.deployedBytecode.object}`,sourceSha256:createHash("sha256").update(source).digest("hex")},null,2));
writeFileSync(join(out,"rotation-public.json"),JSON.stringify({...rotation,signer,owner,chainId:11155111,rpcStatus,status:"WALLET_SIGNATURE_REQUIRED; NOT_DEPLOYED"},null,2));
console.log(JSON.stringify({output:out,signer,owner,rpcStatus,status:"Unsigned deployment prepared; no transaction broadcast"}));
