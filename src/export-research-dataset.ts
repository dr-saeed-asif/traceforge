import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase } from "./infrastructure/sqlite/sqlite-database.js";
import { applySqliteMigrations } from "./infrastructure/sqlite/sqlite-migrator.js";
import { SqliteVerificationRepository } from "./modules/verification/index.js";

interface SessionRow {
  readonly prompt_id: string;
  readonly final_response: string;
  readonly agent_name: string;
  readonly model_name: string;
  readonly project_name: string | null;
  readonly started_at: string;
}

const databasePath =
  process.env.TRACEFORGE_DATABASE_PATH?.trim() || "./data/traceforge.sqlite";
const outputPath = resolve(
  process.argv[2] ?? "research/annotation-dataset.jsonl",
);
const database = openSqliteDatabase(databasePath);

try {
  await applySqliteMigrations(database);
  const repository = new SqliteVerificationRepository(database);
  const rows = allSessions(database);
  const output: string[] = [];
  for (const row of rows) {
    const evidence = await repository.loadVerificationEvidence(row.prompt_id);
    output.push(
      JSON.stringify({
        id: row.prompt_id,
        finalResponse: row.final_response,
        evidence,
        goldClaims: [],
        metadata: {
          agent: row.agent_name,
          model: row.model_name,
          project: row.project_name,
          startedAt: row.started_at,
        },
      }),
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${output.join("\n")}${output.length > 0 ? "\n" : ""}`,
    "utf8",
  );
  process.stdout.write(`Exported ${rows.length} sessions to ${outputPath}\n`);
} finally {
  database.close();
}

function allSessions(database: DatabaseSync): SessionRow[] {
  return database
    .prepare(
      `
    SELECT session.prompt_id, result.Result AS final_response,
      session.agent_name, session.model_name, session.project_name, session.started_at
    FROM execution_sessions AS session
    INNER JOIN prompt_results AS result ON result.id = session.prompt_result_id
    ORDER BY session.started_at, session.id
  `,
    )
    .all() as unknown as SessionRow[];
}
