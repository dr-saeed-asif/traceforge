import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Opens the single-file TraceForge database with production-safe local defaults. */
export function openSqliteDatabase(databasePath: string): DatabaseSync {
  const resolvedPath = resolve(databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA synchronous = NORMAL");
  return database;
}

