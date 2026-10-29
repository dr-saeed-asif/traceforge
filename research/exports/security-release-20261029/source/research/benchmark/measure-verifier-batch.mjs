#!/usr/bin/env node
// Synthetic scalability measurement; compare equivalent public API decisions.
import { performance } from "node:perf_hooks";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cpus, platform } from "node:os";
import { verifyClaim, verifyClaims } from "../../dist/modules/verification/application/claim-verifier.js";
import { parseArgs, toCsv } from "../annotation/lib.mjs";
const args = parseArgs(process.argv.slice(2));
const output = resolve(args.output ?? "verification-microbenchmark.csv");
if (existsSync(output)) throw new Error(`Use a fresh output: ${output}`);
const rows = [["workload", "claims", "evidence_events", "repetitions", "individual_median_ms", "batch_median_ms", "speedup", "identical_decisions", "node", "platform", "cpu"]];
const median = xs => xs.toSorted((a,b)=>a-b)[Math.floor(xs.length/2)];
for (const count of [1, 10, 100]) {
  const claims = Array.from({length:count},(_,i)=>({claimIndex:i+1,claimType:"FILE_CREATED",claimText:`Created file-${i}.ts.`,target:`file-${i}.ts`,expectedResult:"exists"}));
  const evidence = Array.from({length:1000},(_,i)=>({promptId:"synthetic",eventId:`e${i}`,sequenceNumber:i+1,eventType:i<count?"FILE_CREATED":"RESOURCE_ACCESSED",outcome:i<count?"SUCCEEDED":"RECORDED",occurredAt:"2026-01-01T00:00:00.000Z",target:i<count?`file-${i}.ts`:"unrelated",metadata:i<count?{fileExistedBefore:false,fileExistsAfter:true}:{}})).reverse();
  const individual = () => claims.map(c=>verifyClaim(c,evidence));
  const batched = () => verifyClaims(claims,evidence);
  if (JSON.stringify(individual())!==JSON.stringify(batched())) throw new Error("Batch decisions differ");
  for(let i=0;i<5;i++){individual();batched();}
  const timings=[[],[]], functions=[individual,batched];
  for(let repeat=0;repeat<50;repeat++) for(const index of repeat%2?[1,0]:[0,1]) {
    const start=performance.now(); functions[index](); timings[index].push(performance.now()-start);
  }
  rows.push(["synthetic_sorted_trace_reuse",count,evidence.length,50,median(timings[0]),median(timings[1]),median(timings[0])/median(timings[1]),true,process.version,platform(),cpus()[0]?.model]);
}
writeFileSync(output,toCsv(rows),{flag:"wx"}); console.log(toCsv(rows));
