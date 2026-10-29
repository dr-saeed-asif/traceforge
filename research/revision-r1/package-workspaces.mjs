import {cpSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {readJsonl,parseArgs,toCsv} from '../annotation/lib.mjs';
import {computeWorkspaceDigest} from '../../dist/modules/verification/application/workspace-digest.js';
const a=parseArgs(process.argv.slice(2)),out=resolve(String(a['out-dir']??'research/exports/remarks-final-workspaces-20261029'));if(existsSync(out))throw Error('Fresh output required');mkdirSync(out,{recursive:true});const rows=[];
for(const s of readJsonl('research/runs/remarks-r7-controlled-20261029/sessions.jsonl')){
 const path=join(out,encodeURIComponent(s.id));cpSync(s.workspacePath,path,{recursive:true,filter:p=>!['.git','node_modules','__pycache__','.pytest_cache'].includes(basename(p))});
 const actual=await computeWorkspaceDigest(path);if(actual!==s.finalDigest)throw Error('Portable W-prime digest mismatch: '+s.id);rows.push([s.id,encodeURIComponent(s.id),s.finalDigest,actual===s.finalDigest]);
}writeFileSync(join(out,'workspace-manifest.csv'),toCsv([['session_id','relative_directory','workspace_digest','verified'],...rows]));writeFileSync(join(out,'README.md'),'200 preserved final controlled workspaces, portable snapshot. Git administrative data, host node_modules and caches are excluded under the declared workspace-digest policy; all 200 subject digests verified unchanged. Test dependencies must be provisioned independently in the clean sandbox. Use prepare-oracle.mjs --workspace-root <this-folder> --out-dir <fresh> to override machine-specific paths in the original session log.\n');console.log(JSON.stringify({sessions:rows.length,digestsVerified:true,out}));
