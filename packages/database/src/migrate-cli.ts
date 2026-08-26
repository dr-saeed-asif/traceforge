import { resolve } from "node:path";
import { Pool } from "pg";
import { runMigrations } from "./migrations/migration-runner.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  const result = await runMigrations(pool, resolve(process.cwd(), "infrastructure/migrations"));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
