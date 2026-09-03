import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool } from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool({ uri: databaseUrl, connectionLimit: 1, timezone: "Z", multipleStatements: true });
try {
  const sql = await readFile(resolve("infrastructure/mysql-migrations/001_prompt_results.sql"), "utf8");
  await pool.query(sql);
  process.stdout.write("prompt_results is ready\n");
} finally {
  await pool.end();
}
