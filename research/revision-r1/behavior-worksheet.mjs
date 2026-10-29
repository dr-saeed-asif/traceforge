import {writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {toCsv} from '../annotation/lib.mjs';
const out='research/annotation/behavior-basis-100';if(existsSync(out))throw Error('Do not overwrite author annotations');mkdirSync(out,{recursive:true});
const subjects=['Login validation','The cache bug','The search issue','The upload feature','The export workflow','The parser','The checkout flow','The pagination issue','The error handler','The refresh behavior'];
const predicates=['is now fixed.','has been fixed.','is resolved.','works now.','is working correctly.','has not been fixed.','might be resolved.','will be fixed.','is mentioned in the README.','has been documented.'];
const rows=subjects.flatMap(s=>predicates.map(p=>`${s} ${p}`));
writeFileSync(out+'/statements.csv',toCsv([['statement_id','statement','human_behavior_label','annotator_id','annotation_status','rationale'],...rows.map((s,i)=>[i+1,s,'','','',''])]));writeFileSync(out+'/README.md','100 unlabelled challenge statements for the behavior-basis rule. Authors must independently label whether each assertion requires behavioral acceptance evidence (true/false), with annotator identity and COMPLETE status. These are developer-authored challenge inputs, not held-out or human-labelled evidence. No precision/recall is claimed before completed human labels exist.\n');
