#!/usr/bin/env node
// Prepare a reviewable source snapshot, not a published release or history rewrite.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,cpSync,readdirSync,rmSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const out=resolve(process.argv[2]??'research/exports/security-release-20261029');
if(existsSync(out))throw Error('Use a fresh output directory');mkdirSync(out,{recursive:true});
const stage=join(out,'source');mkdirSync(stage);
const base=join(out,'base.zip');execFileSync('git',['archive','--format=zip',`--output=${base}`,'HEAD']);
const ps=(script)=>execFileSync('powershell',['-NoProfile','-Command',script],{stdio:'pipe'}),quote=s=>"'"+s.replaceAll("'","''")+"'";
ps(`Expand-Archive -LiteralPath ${quote(base)} -DestinationPath ${quote(stage)}`);
const selected=['infrastructure/protected-capture','src/security','test/protected-capture.test.ts','test/robustness-acceptance.test.ts','research/robustness','research/security','research/exports/protected-capture-20261029','research/exports/protected-live-controls-20261029-final','packages/claim-anchoring/contracts/VerifiedClaimRegistryV2.sol','apps/web/src/lib/claim-anchor-signing.ts'];
for(const path of selected)cpSync(resolve(path),join(stage,path),{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.endsWith('.pyc')});
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(join(dir,d.name)):[join(dir,d.name)]);
const historical=execFileSync('git',['show','5fc292c:.env.example'],{encoding:'utf8'});
const leaked=[...historical.matchAll(/(?:PRIVATE_KEY|SIGNER_KEY)\s*=\s*["']?(0x[0-9a-f]{64})/gi)].map(m=>m[1]);
if(!leaked.length)throw Error('Historical-key audit could not establish the comparison value');
const prohibited=[],inventory=[];
for(const file of walk(stage)){const name=relative(stage,file).replaceAll('\\','/'),bytes=readFileSync(file),text=bytes.toString('utf8');if(leaked.some(k=>text.toLowerCase().includes(k.toLowerCase()))||/-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(text)||/(^|\/)\.env$|signer\.hex$|collector\.key$/.test(name))prohibited.push(name);inventory.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
if(prohibited.length)throw Error('Archive blocked: sensitive files: '+prohibited.join(', '));
writeFileSync(join(stage,'SECURITY-ARCHIVE-MANIFEST.json'),JSON.stringify({baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'UNPUBLISHED_SOURCE_SNAPSHOT_WITH_UNCOMMITTED_REVISION_OVERLAY; NOT_A_RELEASE_TAG',knownHistoricalKeyOccurrences:0,scope:'Snapshot only. Existing Git history remains contaminated; this is not a comprehensive credential certification.',files:inventory},null,2));
const archive=join(out,'traceforge-security-source-results.zip');ps(`Compress-Archive -Path ${quote(join(stage,'*'))} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`);
const digest=createHash('sha256').update(readFileSync(archive)).digest('hex');writeFileSync(join(out,'SHA256SUMS'),`${digest}  traceforge-security-source-results.zip\n`);
writeFileSync(join(out,'README.md'),'Unpublished, secret-screened source snapshot and measured security results. No Git history included. Overlay files are identified in the manifest. A release commit/tag, authorized publication and DOI remain pending. Historical Git credential exposure is not repaired by this archive.\n');
console.log(JSON.stringify({archive,sha256:digest,files:inventory.length,knownHistoricalKeyOccurrences:0,published:false}));
