import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJsonl,sha256,parseArgs} from '../annotation/lib.mjs';
export function freezeHeldout(path,manifestPath){
 if(existsSync(manifestPath))throw Error('Frozen manifest already exists');const rows=readJsonl(path),families=new Map(),ids=new Set();
 for(const r of rows){if(!r.id||ids.has(r.id)||!Array.isArray(r.goldClaims)||!r.goldClaims.length||!Array.isArray(r.evidence)||typeof r.finalResponse!=='string')throw Error('Invalid or duplicate held-out session');ids.add(r.id);const m=r.metadata;if(!m?.family||!m.externalAuthorId||m.independentAuthor!==true)throw Error('External authorship attestation missing');const prior=families.get(m.family);if(prior&&prior.author!==m.externalAuthorId)throw Error('Inconsistent family authorship');families.set(m.family,{author:m.externalAuthorId,variants:(prior?.variants??0)+1});}
 if(families.size<10||[...families.values()].some(f=>f.variants<8))throw Error('Need at least 10 externally authored families with 8 variants each');
 const manifest={schemaVersion:1,dataset:resolve(path),sha256:sha256(readFileSync(path)),frozenAt:new Date().toISOString(),sessions:rows.length,families:Object.fromEntries(families),authorship:'Author-supplied attestation; software cannot prove social independence'};writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx'});return manifest;
}
export function loadFrozenHeldout(path,manifestPath){const m=JSON.parse(readFileSync(manifestPath));if(m.sha256!==sha256(readFileSync(path)))throw Error('Frozen held-out dataset changed');return readJsonl(path);}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const a=parseArgs(process.argv.slice(2));if(!a.dataset||!a.manifest)throw Error('--dataset and --manifest required');if(a.freeze)console.log(JSON.stringify(freezeHeldout(a.dataset,a.manifest)));else console.log(JSON.stringify({sessions:loadFrozenHeldout(a.dataset,a.manifest).length,sha256Verified:true}));}
