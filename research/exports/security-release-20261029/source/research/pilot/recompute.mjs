#!/usr/bin/env node
// Recomputes the pilot totals and shares from dashboard-counts.csv.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const csv = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "dashboard-counts.csv"), "utf8").trim().split("\n");
const header = csv[0].split(",");
const rows = csv.slice(1).map((line) => Object.fromEntries(line.split(",").map((value, i) => [header[i], value])));
const sum = (key) => rows.reduce((total, row) => total + Number(row[key]), 0);
const total = { queries: sum("queries"), claims: sum("claims"), verified: sum("verified"), contradicted: sum("contradicted"), unsupported: sum("unsupported"), unverifiable: sum("unverifiable") };
const scored = total.verified + total.contradicted + total.unsupported;
console.log(total);
console.log(`claims per query: ${(total.claims / total.queries).toFixed(2)}`);
console.log(`verified share S_V = ${(100 * total.verified / scored).toFixed(1)}%; coverage K = ${(100 * scored / total.claims).toFixed(1)}%`);
for (const row of rows) console.log(`${row.date}: verified share ${(100 * row.verified / (Number(row.verified) + Number(row.contradicted) + Number(row.unsupported))).toFixed(1)}%`);
