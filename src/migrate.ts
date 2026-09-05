import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool } from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool({ uri: databaseUrl, connectionLimit: 1, timezone: "Z", multipleStatements: true });
try {
  const migrationDirectory = resolve("infrastructure/mysql-migrations");
  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    const sql = await readFile(resolve(migrationDirectory, migration), "utf8");
    await pool.query(sql);
  }
  process.stdout.write("prompt_results is ready\n");
} finally {
  await pool.end();
}
