import { decryptGeneratedCode, parseGeneratedCodeKey, type EncryptedGeneratedCode } from "./generated-code-crypto.js";
import { openSqliteDatabase } from "./infrastructure/sqlite/sqlite-database.js";

const promptQuery = process.argv.slice(2).filter((value) => value !== "--").join(" ").trim();
if (!promptQuery) throw new Error("Usage: npm run code:decrypt -- <exact prompt query>");
const databasePath = process.env.TRACEFORGE_DATABASE_PATH?.trim() || "./data/traceforge.sqlite";
const key = parseGeneratedCodeKey(process.env.TRACEFORGE_GENERATED_CODE_PRIVATE_KEY);
const database = openSqliteDatabase(databasePath);

try {
  const rows = database.prepare(
    "SELECT EncryptedGeneratedCode FROM prompt_results WHERE PromptQuery = ?"
  ).all(promptQuery) as Array<{ EncryptedGeneratedCode: string }>;
  if (rows.length === 0) throw new Error(`No prompt result matched the exact query: ${JSON.stringify(promptQuery)}`);
  const decrypted = rows.map(row => decryptGeneratedCode(
    JSON.parse(row.EncryptedGeneratedCode) as EncryptedGeneratedCode,
    key
  ));
  process.stdout.write(`${JSON.stringify(decrypted.length === 1 ? decrypted[0] : decrypted, null, 2)}\n`);
} finally {
  database.close();
}
