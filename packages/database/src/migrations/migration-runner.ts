import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export async function runMigrations(pool: Pool, directory: string): Promise<MigrationResult> {
  const connection = await pool.getConnection();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    await acquireLock(connection);
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB`);
    const names = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name)).sort();
    for (const name of names) {
      const sql = await readFile(join(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const [existing] = await connection.query<(RowDataPacket & { checksum: string })[]>(
        "SELECT checksum FROM schema_migrations WHERE migration_name = ?",
        [name]
      );
      const row = existing[0];
      if (row !== undefined) {
        if (row.checksum !== checksum) throw new Error(`Applied migration ${name} has been modified`);
        alreadyApplied.push(name);
        continue;
      }
      // MySQL DDL implicitly commits, so the migration and its ledger row are separate operations.
      await connection.query(sql);
      await connection.query(
        "INSERT INTO schema_migrations (migration_name, checksum) VALUES (?, ?)",
        [name, checksum]
      );
      applied.push(name);
    }
    return { applied, alreadyApplied };
  } finally {
    try { await connection.query("SELECT RELEASE_LOCK(?)", ["traceforge_schema_migrations"]); }
    finally { connection.release(); }
  }
}

async function acquireLock(connection: PoolConnection): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 30) AS acquired", ["traceforge_schema_migrations"]);
  if (Number(rows[0]?.acquired) !== 1) throw new Error("Could not acquire the schema migration lock");
}
