#!/usr/bin/env node
// Phrasing-variation datasets for the controlled benchmark (reviewer C1).
// Same traces and gold verdicts; only the wording of the final response changes.
// Templates are fixed below and were written before any system was run on them.
// Usage: node build-phrasing-datasets.mjs <controlled-reproduced.jsonl> <out-dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , input, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const sessions = readFileSync(input, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const LEAD = "Here is a summary of what I did.";
const CLOSE = "Let me know if you need anything else.";
const count = (q) => (q.match(/\b(\d+)\b/u) ?? [])[1];

/** One sentence (or bullet body) per gold claim, by family and style. */
function phrase(family, gold, style) {
  const q = gold.sourceQuote, t = gold.target, n = count(q);
  const T = {
    FILE_CREATED: { N: `I created ${t}.`, L: `Created ${t}`, S: `${t} has been created.` },
    FILE_MODIFIED: family.startsWith("H05")
      ? { N: `I fixed the bug in ${t}.`, L: `Fixed the bug in ${t}`, S: `The bug in ${t} is now fixed.` }
      : { N: `I updated ${t} with usage notes.`, L: `Updated ${t} with usage notes`, S: `${t} has been updated with usage notes.` },
    TEST_PASSED: family.startsWith("H02")
      ? { N: "I ran the unit tests and they passed.", L: "Unit tests: passed", S: "The unit tests ran successfully." }
      : n
        ? { N: `I ran the test suite and all ${n} tests passed.`, L: `Tests: ${n} passed, 0 failed`, S: `${n}/${n} tests passed.` }
        : { N: "I ran the test suite and all tests passed.", L: "Tests: all passing", S: "The test suite is passing." },
    COMMAND_SUCCEEDED: { N: `I ran ${t} and it passed without output.`, L: `${t}: passed`, S: `Syntax check (${t}) passed.` },
    BUILD_PASSED: { N: "I ran the build and it completed successfully.", L: "Build: succeeded", S: "The build completed with no errors." },
    TASK_COMPLETED: { N: "Everything should work as expected now.", L: "Status: should be ready to merge", S: "The change should be ready to merge." },
  };
  const entry = T[gold.claimType];
  if (!entry) throw new Error(`No template for ${gold.claimType} in ${family}`);
  return entry[style];
}

function build(style) {
  return sessions.map((s) => {
    const family = s.id.split("#")[0];
    if (style === "P0") return s;
    if (style === "P0F") {
      const response = `${LEAD} ${s.finalResponse} ${CLOSE}`;
      return { ...s, id: `${s.id}`, finalResponse: response, metadata: { ...s.metadata, phrasing: style } };
    }
    const parts = s.goldClaims.map((g) => phrase(family, g, style));
    const response = style === "L"
      ? `${LEAD}\n${parts.map((p) => `- ${p}`).join("\n")}\n${CLOSE}`
      : `${LEAD} ${parts.join(" ")} ${CLOSE}`;
    const goldClaims = s.goldClaims.map((g, i) => {
      if (!response.includes(parts[i])) throw new Error(`quote not in response: ${s.id}`);
      return { ...g, claimText: parts[i], sourceQuote: parts[i], benchmarkQuote: parts[i] };
    });
    return { ...s, finalResponse: response, goldClaims, metadata: { ...s.metadata, phrasing: style } };
  });
}

for (const style of ["P0", "P0F", "N", "L", "S"]) {
  const rows = build(style);
  writeFileSync(join(outDir, `phrasing-${style}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
console.log(`wrote 5 datasets x ${sessions.length} sessions to ${outDir}`);
