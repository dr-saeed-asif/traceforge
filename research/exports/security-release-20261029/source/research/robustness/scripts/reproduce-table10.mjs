#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs, sha256, readJsonl, toCsv, parseCsv } from "../../annotation/lib.mjs";
import { sourceDigest } from "./freeze.mjs";

const root=resolve(import.meta.dirname,"../../..");
const bundle=join(root,"research/robustness");
const args=parseArgs(process.argv.slice(2));
const freeze=JSON.parse(readFileSync(join(bundle,"baseline-manifest.json")));
// Fail before any output/build if a frozen runtime or reference has changed.
for(const [p,hash] of Object.entries(freeze.sourceFiles)) if(sourceDigest(p,readFileSync(join(root,p)))!==hash) throw new Error(`Frozen 3.1.0/3.2.0 source changed: ${p}. Use its frozen checkout, not a new policy.`);
for(const [p,hash] of Object.entries(freeze.importedBundleFiles)) {
  if(p.startsWith("scripts/")) continue; // Original hashes retained; CLI-only adapters documented.
  if(sha256(readFileSync(join(bundle,p)))!==hash) throw new Error(`Frozen reference changed: ${p}`);
}
if(args["check-only"]===true){console.log("Frozen runtime and reference data verified");process.exit(0);}
const out=resolve(args["out-dir"]??join(bundle,"runs",`acceptance-${new Date().toISOString().replace(/[:.]/gu,"-")}-${randomUUID().slice(0,8)}`));
if(existsSync(out))throw new Error("Use a fresh output directory");
mkdirSync(out,{recursive:true});
const python=String(args.python??"python");
const commands=[];
const git=a=>spawnSync("git",a,{cwd:root,encoding:"utf8"}).stdout.trim();
const commit=git(["rev-parse","HEAD"]);
const toolingFiles={};
for(const f of readdirSync(join(bundle,"scripts"))) if(/\.(mjs|py)$/u.test(f)) toolingFiles[`scripts/${f}`]=sha256(readFileSync(join(bundle,"scripts",f)));
for(const f of ["baseline-manifest.json","README.md","CAPTURE-ACCEPTANCE.md"])toolingFiles[f]=sha256(readFileSync(join(bundle,f)));
writeFileSync(join(out,"tooling-provenance.json"),JSON.stringify({commit,workingTreeDirty:Boolean(git(["status","--porcelain"])),runtimeVersions:{policy:freeze.policyVersion,extraction:freeze.extractionVersion},toolingFiles,publicationStatus:"Local acceptance replay; not yet a tagged/archived release"},null,2));
const run=(name,exe,argv)=>{
  const stdout=openSync(join(out,`${name}.stdout.log`),"wx"), stderr=openSync(join(out,`${name}.stderr.log`),"wx");
  const startedAt=new Date().toISOString();
  console.log(name);
  const r=spawnSync(exe,argv,{cwd:root,stdio:["ignore",stdout,stderr]});closeSync(stdout);closeSync(stderr);
  const row={name,command:[exe,...argv],commit,startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,error:r.error?.message??null};
  commands.push(row);writeFileSync(join(out,"commands.json"),JSON.stringify(commands,null,2));
  if(r.status!==0)throw new Error(`${name} failed: ${row.error??readFileSync(join(out,`${name}.stderr.log`),"utf8").slice(-1500)}`);
  return row;
};
const scripts=join(bundle,"scripts");
run("build",process.execPath,["node_modules/typescript/bin/tsc","-p","tsconfig.json"]);
const dataset=join(root,freeze.controlledDataset);
const phrasing=join(out,"phrasing"),tamper=join(out,"tamper");
run("build-phrasing",process.execPath,[join(scripts,"build-phrasing-datasets.mjs"),dataset,phrasing]);
run("build-tamper",python,[join(scripts,"build-tamper-datasets.py"),dataset,tamper]);
mkdirSync(join(out,"matching"));
run("build-matching",python,[join(scripts,"build-matching-datasets.py"),join(out,"matching/matching.jsonl")]);
const experiments=[];
function evaluate(name,input,output,extractors="oracle",target="strict"){
  const reference=join(bundle,relative(out,input));
  // Require the builders to preserve all supplied claims, evidence and metadata.
  if(JSON.stringify(readJsonl(input))!==JSON.stringify(readJsonl(reference)))throw new Error(`Generated data differs from frozen reference: ${name}`);
  const command=run(name,process.execPath,["dist/evaluate.js","--dataset",input,"--extractors",extractors,"--baselines","deterministic","--allow-unadjudicated","--bootstrap","2000","--seed","42","--matching","exact","--target-matching",target,"--output",output]);
  run(`${name}-csv`,process.execPath,["research/annotation/export-evaluation-suite.mjs","--run-dir",output,"--dataset",input,"--out-dir",join(output,"csv")]);
  const manifest=JSON.parse(readFileSync(join(output,"run-manifest.json")));
  const headers=["experiment","commit","working_tree_dirty","baseline_source_commit","policy_version","extraction_version","environment_json","command_json","exit_code","dataset_sha256","source_hashes_json"];
  writeFileSync(join(output,"csv/run-provenance.csv"),toCsv([headers,[name,commit,manifest.workingTreeDirty,freeze.sourceCommit,manifest.policyVersion,manifest.extractionPromptVersion,JSON.stringify({node:manifest.node,platform:manifest.platform,os:manifest.osRelease,cpu:manifest.cpu}),JSON.stringify(command.command),command.exitCode,sha256(readFileSync(input)),JSON.stringify(manifest.sourceHashes)]]));
  writeFileSync(join(output,"README.md"),`# ${name}\n\nUpdates round-3 manuscript Table 10. Frozen policy 3.1.0 / extraction 3.2.0. Raw metrics use main exact one-to-one alignment. Phrasing coverage in the root Table 10 report uses the separate author-supplied containment/Dice method; do not merge them. Failures are retained.\n`);
  experiments.push({name,dataset:input,output,policyVersion:manifest.policyVersion,extractionVersion:manifest.extractionPromptVersion,model:"not-applicable",modelSeed:null,bootstrapSeed:42});
}
for(const style of ["P0","P0F","N","L","S"])evaluate(`phrasing-${style}`,join(phrasing,`phrasing-${style}.jsonl`),join(phrasing,`out-${style}-exact`),"oracle,heuristic");
for(const attack of ["suppress-all","suppress-negative","forge"])evaluate(`tamper-${attack}`,join(tamper,`tamper-${attack}.jsonl`),join(tamper,`out-${attack}`));
for(const mode of ["strict","legacy-token"])evaluate(`matching-${mode}`,join(out,"matching/matching.jsonl"),join(out,`matching/out-${mode}`),"oracle",mode);
run("author-phrasing-analysis",python,[join(scripts,"analyze-phrasing.py"),phrasing,join(out,"phrasing-summary.csv"),"out-{style}-exact"]);
run("author-phrasing-ci",python,[join(scripts,"phrasing-ci.py"),phrasing,"out-{style}-exact"]);
// Exact counts, not a tolerance fitted to outcomes. CIs are checked at paper precision.
const actual=parseCsv(readFileSync(join(out,"phrasing-summary.csv"),"utf8"));
const expected=parseCsv(readFileSync(join(bundle,"phrasing/phrasing-summary.csv"),"utf8"));
if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error("Phrasing counts do not reproduce the author reference");
writeFileSync(join(out,"experiments.json"),JSON.stringify(experiments,null,2));
run("acceptance-analysis",process.execPath,[join(scripts,"analyze-acceptance.mjs"),"--run-dir",out]);
writeFileSync(join(out,"README.md"),"# Table 10 acceptance reproduction\n\nSee acceptance-checks.csv for exact count and displayed-CI checks. main-exact-statistics.csv and phrasing-coverage-statistics.csv use different alignment estimands and are deliberately separate. CP bounds assume iid Bernoulli trials; session/family bootstrap handles clustering. No seeds or models are pooled. Capture architecture is a design contract, not a deployed security fix.\n");
const hashes={};
const walk=p=>{for(const e of readdirSync(p,{withFileTypes:true})){const f=join(p,e.name);if(e.isDirectory())walk(f);else hashes[relative(out,f).replaceAll("\\","/")]=sha256(readFileSync(f));}};
walk(out);writeFileSync(join(out,"file-hashes.json"),JSON.stringify(hashes,null,2));
console.log(JSON.stringify({output:out,experiments:experiments.length,status:"ACCEPTANCE_CHECKS_PASSED"}));
