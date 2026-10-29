import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {csvRecords,parseCsv,toCsv} from '../annotation/lib.mjs';
const out=resolve('research/exports/remarks-input-audit-20261029');if(existsSync(out))throw Error('Fresh audit output required');mkdirSync(out,{recursive:true});
const credentials=[];
for(const path of ['.env','apps/web/.env','apps/web/.env.local','.env.example','apps/web/.env.example'])if(existsSync(path))for(const line of readFileSync(path,'utf8').split(/\r?\n/)){
 const m=/^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);if(!m||!/(?:OPENAI|ANTHROPIC|GROQ|OPENROUTER|TOGETHER|ZENODO|API_KEY|REGISTRY_ADDRESS)/.test(m[1]))continue;
 const value=m[2].replace(/^["']|["']$/g,'').trim();credentials.push([path,m[1],!!value&&!/^(?:your|replace|example|changeme|<)/i.test(value),path.endsWith('.example')?'template only':'configuration']);
}
const annotations=[];for(const path of ['research/datasets/natural-v1.annotator-a.csv','research/datasets/natural-v1.annotator-b.csv','research/datasets/natural-v1.adjudications.csv','research/exports/paper-package-20261028-delivery/human-annotation/natural-v1.adjudications.csv']){
 if(!existsSync(path)){annotations.push([path,false,0,0]);continue;}const rows=csvRecords(parseCsv(readFileSync(path,'utf8'))).records;annotations.push([path,true,rows.length,rows.filter(r=>String(r.annotation_status??r.adjudication_status).toUpperCase()==='COMPLETE'||String(r.adjudication_status).toUpperCase()==='ADJUDICATED').length]);
}
writeFileSync(join(out,'credential-availability.csv'),toCsv([['path','variable_name','configured','scope'],...credentials]));writeFileSync(join(out,'annotation-availability.csv'),toCsv([['path','exists','rows','completed_rows'],...annotations]));
writeFileSync(join(out,'README.md'),'Repository configuration and annotation availability audit; secret values are never exported. Public wallet addresses do not grant signing or archive authentication. Template values are not usable credentials. Historical committed secrets are compromised and must not be reused. This audit cannot revoke keys at external providers.\n');console.log(JSON.stringify({credentials,annotations}));
