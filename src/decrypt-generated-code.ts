import { createPool, type RowDataPacket } from "mysql2/promise";
import { decryptGeneratedCode, parseGeneratedCodeKey, type EncryptedGeneratedCode } from "./generated-code-crypto.js";

const promptQuery = process.argv.slice(2).filter((value) => value !== "--").join(" ").trim();
if (!promptQuery) throw new Error("Usage: npm run code:decrypt -- <exact prompt query>");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const key = parseGeneratedCodeKey(process.env.TRACEFORGE_GENERATED_CODE_PRIVATE_KEY);
const pool = createPool({ uri: databaseUrl, connectionLimit: 1, timezone: "Z" });

try {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT `EncryptedGeneratedCode` FROM prompt_results WHERE `PromptQuery` = ?",
    [promptQuery]
  );
  if (rows.length === 0) throw new Error(`No prompt result matched the exact query: ${JSON.stringify(promptQuery)}`);
  const decrypted = rows.map((row) => decryptGeneratedCode(row.EncryptedGeneratedCode as EncryptedGeneratedCode, key));
  process.stdout.write(`${JSON.stringify(decrypted.length === 1 ? decrypted[0] : decrypted, null, 2)}\n`);
} finally {
  await pool.end();
}
