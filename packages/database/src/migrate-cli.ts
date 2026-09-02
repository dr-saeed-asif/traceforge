import { resolve } from "node:path";
import { runMigrations } from "./migrations/migration-runner.js";
import { createMySqlPool } from "./mysql/mysql-pool.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL is required");
}

const pool = createMySqlPool(databaseUrl, 2);
try {
  const result = await runMigrations(pool, resolve(process.cwd(), "infrastructure/migrations"));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
