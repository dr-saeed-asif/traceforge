import { createPool, type RowDataPacket } from "mysql2/promise";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { openSqliteDatabase } from "./infrastructure/sqlite/sqlite-database.js";
import { applySqliteMigrations } from "./infrastructure/sqlite/sqlite-migrator.js";

const mysqlUrl = process.env.DATABASE_URL?.trim();
if (!mysqlUrl?.startsWith("mysql://")) {
  throw new Error("DATABASE_URL must contain the source MySQL connection URL");
}
const databasePath = process.env.TRACEFORGE_DATABASE_PATH?.trim() || "./data/traceforge.sqlite";
const sqlite = openSqliteDatabase(databasePath);
const mysql = createPool({ uri: mysqlUrl, connectionLimit: 1, timezone: "Z" });

const TABLES = [
  {
    name: "prompt_results",
    columns: [
      "id", "PromptQuery", "AgentName", "ModelName", "Result", "Resources",
      "FilePaths", "GeneratedCode", "EncryptedGeneratedCode", "GitUser",
      "PromptId", "SessionId", "RunId", "ProjectName", "ProjectPath", "Status",
      "created_at", "created_by"
    ],
    jsonColumns: new Set(["Resources", "FilePaths", "GeneratedCode", "EncryptedGeneratedCode"])
  },
  {
    name: "execution_sessions",
    columns: [
      "id", "prompt_id", "external_session_id", "run_id", "prompt_result_id",
      "project_name", "project_path", "agent_name", "model_name", "execution_status",
      "extraction_status", "verification_status", "total_claims", "verified_claims",
      "contradicted_claims", "unsupported_claims", "unverifiable_claims", "scored_claims",
      "reliability_percent", "coverage_percent", "policy_version", "started_at",
      "completed_at", "created_at", "updated_at"
    ],
    jsonColumns: new Set<string>()
  },
  {
    name: "trace_events",
    columns: [
      "id", "execution_session_id", "source_event_id", "sequence_number", "event_type",
      "outcome", "occurred_at", "target", "tool_name", "file_path", "command_text",
      "working_directory", "exit_code", "test_passed", "test_failed", "test_skipped",
      "file_existed_before", "file_exists_after", "file_hash_before", "file_hash_after",
      "output_hash", "previous_event_hash", "event_hash", "metadata_json", "created_at"
    ],
    jsonColumns: new Set(["metadata_json"])
  },
  {
    name: "agent_claims",
    columns: [
      "id", "execution_session_id", "claim_index", "claim_text", "claim_type", "target",
      "expected_result", "verdict", "verdict_reason_code", "verdict_explanation",
      "evidence_event_ids", "extractor_model", "extraction_prompt_version",
      "verification_rule_version", "verified_at", "created_at", "updated_at"
    ],
    jsonColumns: new Set(["evidence_event_ids"])
  }
] as const;

try {
  await applySqliteMigrations(sqlite);
  ensureEmpty(sqlite);
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const table of TABLES) {
      const [rows] = await mysql.query<RowDataPacket[]>(
        `SELECT ${table.columns.map(quoteMysql).join(", ")} FROM ${quoteMysql(table.name)} ORDER BY id ASC`
      );
      const insert = sqlite.prepare(
        `INSERT INTO ${quoteSqlite(table.name)} (${table.columns.map(quoteSqlite).join(", ")})
         VALUES (${table.columns.map(() => "?").join(", ")})`
      );
      for (const row of rows) {
        insert.run(...table.columns.map(column => sqliteValue(row[column], table.jsonColumns.has(column))));
      }
      process.stdout.write(`Imported ${rows.length} ${table.name} rows\n`);
    }
    sqlite.exec("COMMIT");
  } catch (error) {
    try { sqlite.exec("ROLLBACK"); } catch { /* Preserve import failure. */ }
    throw error;
  }
  const foreignKeyErrors = sqlite.prepare("PRAGMA foreign_key_check").all();
  const integrity = sqlite.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
  if (foreignKeyErrors.length > 0 || integrity?.integrity_check !== "ok") {
    throw new Error("SQLite integrity verification failed after import");
  }
  process.stdout.write(`MySQL data imported successfully into ${databasePath}\n`);
} finally {
  await mysql.end();
  sqlite.close();
}

function ensureEmpty(database: DatabaseSync): void {
  for (const table of TABLES) {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteSqlite(table.name)}`).get() as { count: number };
    if (row.count !== 0) {
      throw new Error(`SQLite import requires empty tables; ${table.name} already contains ${row.count} rows`);
    }
  }
}

function sqliteValue(value: unknown, json: boolean): SQLInputValue {
  if (value === null || value === undefined) return null;
  if (json) return jsonText(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  return String(value);
}

function jsonText(value: unknown): string {
  if (typeof value === "string") {
    try { JSON.parse(value); return value; }
    catch { return JSON.stringify(value); }
  }
  if (Buffer.isBuffer(value)) return jsonText(value.toString("utf8"));
  return JSON.stringify(value);
}

function quoteMysql(identifier: string): string {
  return `\`${identifier.replace(/`/gu, "``")}\``;
}

function quoteSqlite(identifier: string): string {
  return `"${identifier.replace(/"/gu, '""')}"`;
}

