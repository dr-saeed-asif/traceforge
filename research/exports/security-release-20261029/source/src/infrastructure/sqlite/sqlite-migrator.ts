import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

interface MigrationRow {
  readonly checksum: string;
}

/** Applies each immutable SQLite migration exactly once. */
export async function applySqliteMigrations(
  database: DatabaseSync,
  migrationDirectory = resolve("infrastructure/sqlite-migrations")
): Promise<void> {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const migrations = (await readdir(migrationDirectory))
    .filter(name => name.endsWith(".sql"))
    .sort();
  const findMigration = database.prepare(
    "SELECT checksum FROM schema_migrations WHERE name = ?"
  );
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)"
  );

  for (const name of migrations) {
    const sql = await readFile(resolve(migrationDirectory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = findMigration.get(name) as MigrationRow | undefined;
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Applied SQLite migration changed: ${name}`);
      }
      continue;
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      recordMigration.run(name, checksum);
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Preserve migration error. */ }
      throw error;
    }
  }
}

