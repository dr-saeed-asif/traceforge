import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { openSqliteDatabase } from "./infrastructure/sqlite/sqlite-database.js";
import { applySqliteMigrations } from "./infrastructure/sqlite/sqlite-migrator.js";
import { SqliteVerificationRepository } from "./modules/verification/index.js";
import { runManifest, sha256 } from "./research/run-manifest.js";

const outputPath = resolve(process.argv[2] ?? "research/annotation-dataset.jsonl");
const database = openSqliteDatabase(process.env.TRACEFORGE_DATABASE_PATH?.trim() || "./data/traceforge.sqlite");
const csv = (rows:unknown[][]) => rows.map(row=>row.map(value=>`"${String(value ?? "").replace(/"/gu,'""')}"`).join(",")).join("\n")+"\n";
try {
  await applySqliteMigrations(database);
  database.exec("BEGIN");
  const repository = new SqliteVerificationRepository(database);
  const rows = database.prepare(`SELECT s.prompt_id,s.policy_version,r.Result AS final_response FROM execution_sessions s LEFT JOIN prompt_results r ON r.id=s.prompt_result_id ORDER BY s.started_at,s.id`).all() as unknown as {prompt_id:string;policy_version:string;final_response:string|null}[];
  const annotation:string[]=[], audit:string[]=[];
  const sessions:unknown[][]=[["session_id","query","agent_model","agent_provider","execution_status","extraction_status","extraction_outcome","claim_count","started_at","completed_at","collection_metadata"]];
  const claims:unknown[][]=[["session_id","claim_index","query","agent_model","extractor_model","claim_text","claim_type","target","file_hash_before","file_hash_after","traceforge_verdict","gold_verdict","reason_code","evidence_event_ids","verification_rule_version","sui_transaction_digest","sui_confirmation_ms","sepolia_transaction_hash","sepolia_confirmation_ms"]];
  const labels:unknown[][]=[["session_id","claim_id","source_quote","claim_type","target","annotator_a_verdict","annotator_b_verdict","adjudicated_verdict","rationale","evidence_event_ids","capture_completeness"]];
  for (const row of rows) {
    const details = await repository.getSessionDetails(row.prompt_id);
    if (!details) continue;
    const evidence = await repository.loadVerificationEvidence(row.prompt_id);
    const session=details.session, metrics=session.processingMetrics;
    const study=evidence.find(e=>e.eventType==="PROMPT_SUBMITTED")?.metadata.study??null;
    const provider=evidence.find(e=>e.eventType==="MODEL_REQUESTED")?.metadata.provider??null;
    const outcome=session.extractionStatus==="FAILED"?"FAILED":session.extractionStatus!=="SUCCEEDED"?session.extractionStatus:
      metrics?.extractionMetadata?.fallback?"FALLBACK":details.claims.length?"SUCCEEDED":"SUCCESSFUL_EMPTY";
    const metadata={agent:session.agentName,model:session.modelName,provider,project:session.projectName,startedAt:session.startedAt,collectionMetadata:study,
      recordedPolicyVersion:row.policy_version, extractionOutcome:outcome,finalResponseAvailable:row.final_response!==null,
      annotationNote:"Zero extracted claims does not establish a genuinely claim-free response. Annotators must identify claims independently."};
    annotation.push(JSON.stringify({id:row.prompt_id,promptQuery:session.promptQuery,finalResponse:row.final_response??"",evidence,goldClaims:[],annotationStatus:"unannotated",metadata}));
    audit.push(JSON.stringify({id:row.prompt_id,finalResponse:row.final_response,details,evidence,metadata,processingMetrics:metrics??null}));
    sessions.push([row.prompt_id,session.promptQuery,session.modelName,provider,session.executionStatus,session.extractionStatus,outcome,details.claims.length,session.startedAt,session.completedAt,JSON.stringify(study)]);
    for(const claim of details.claims){
      const refs=details.traceEvents.filter(e=>claim.evidenceEventIds.includes(e.eventId)&&e.filePath===claim.target);
      const file=refs.length===1?refs[0]:undefined;
      claims.push([row.prompt_id,claim.claimIndex,session.promptQuery,session.modelName,claim.extractorModel,claim.claimText,claim.claimType,claim.target,file?.fileHashBefore??"NA",file?.fileHashAfter??"NA",claim.verdict??"", "",claim.reasonCode,JSON.stringify(claim.evidenceEventIds),claim.verificationRuleVersion,"NA","NA","NA","NA"]);
    }
    // Annotators identify their own claims from finalResponse. Do not pre-fill system predictions here.
    labels.push([row.prompt_id,"","","","","","","","","",""]);
  }
  database.exec("COMMIT");
  const stem=outputPath.replace(/\.jsonl$/u,"");
  const files:Record<string,string>={ [outputPath]:annotation.join("\n")+(annotation.length?"\n":""),[stem+".audit.jsonl"]:audit.join("\n")+(audit.length?"\n":""),[stem+".sessions.csv"]:csv(sessions),[stem+".claims.csv"]:csv(claims),[stem+".annotations.csv"]:csv(labels) };
  await mkdir(dirname(outputPath),{recursive:true});
  for(const [path,content] of Object.entries(files)) await writeFile(path,content,{encoding:"utf8",flag:"wx"});
  const manifest={...runManifest(),kind:"research export; historical collection versions are not inferred from export revision",sessions:rows.length,claims:claims.length-1,
    annotationStatus:"unannotated",blockchainNote:"Browser-local timing/receipt measurements are not in SQLite. Import independently recorded receipts/measurements; never fabricate missing values.",
    files:Object.fromEntries(Object.entries(files).map(([path,content])=>[path,sha256(content)]))};
  await writeFile(stem+".manifest.json",JSON.stringify(manifest,null,2)+"\n",{encoding:"utf8",flag:"wx"});
  console.log(`Exported ${rows.length} sessions (including zero-claim sessions), ${claims.length-1} predicted claims. Annotation and audit files are separate. Gold labels remain blank.`);
} finally {if(database.isTransaction)database.exec("ROLLBACK");database.close();}
