import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, totalmem, platform, release } from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EXTRACTION_PROMPT_VERSION } from "../modules/verification/application/claim-extractor.js";
import { CLAIM_VERIFICATION_POLICY_VERSION } from "../modules/verification/domain/claim-verification-policy.js";
export const sha256 = (text:string|Buffer) => createHash("sha256").update(text).digest("hex");
export function runManifest() {
  const git = (args:string[]) => {try{return execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();}catch{return null;}};
  const sourceHashes: Record<string,string> = {};
  const walk = (dir:string) => {for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())walk(path);else if(item.name.endsWith(".ts"))sourceHashes[path.replace(/\\/gu,"/")]=sha256(readFileSync(path));}};
  walk("src");
  return { schemaVersion:1, createdAt:new Date().toISOString(), revision:git(["rev-parse","HEAD"]), workingTreeDirty:!!git(["status","--porcelain"]),
    policyVersion:CLAIM_VERIFICATION_POLICY_VERSION, extractionPromptVersion:EXTRACTION_PROMPT_VERSION,
    node:process.version, platform:platform(), osRelease:release(), cpu:cpus()[0]?.model??null, logicalCpus:cpus().length,totalMemoryBytes:totalmem(),
    gpuDescription:process.env.TRACEFORGE_STUDY_GPU??null,sourceHashes, packageLockHash:sha256(readFileSync("package-lock.json")),
    collectionMetadata:{agentVersion:process.env.TRACEFORGE_STUDY_AGENT_VERSION??null,decodingSettings:process.env.TRACEFORGE_STUDY_DECODING_SETTINGS??null} };
}
