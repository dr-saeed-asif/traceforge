import type { DatabaseSync } from "node:sqlite";
import type {
  PersistPromptResultInput,
  PromptResultRepository
} from "../../persistence/prompt-result-repository.js";

interface PromptResultIdRow {
  readonly id: number;
}

/** SQLite projection writer retaining the legacy prompt_results contract. */
export class SqlitePromptResultRepository implements PromptResultRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public async save(input: PersistPromptResultInput): Promise<number> {
    this.database.prepare(
      `INSERT INTO prompt_results (
        PromptQuery, AgentName, ModelName, Result, Resources, FilePaths,
        GeneratedCode, EncryptedGeneratedCode, GitUser, PromptId, SessionId,
        RunId, ProjectName, ProjectPath, Status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(PromptId) DO NOTHING`
    ).run(
      input.promptQuery,
      input.agentName,
      input.modelName,
      input.result,
      JSON.stringify(input.resources),
      JSON.stringify(input.filePaths),
      JSON.stringify(input.generatedCode),
      JSON.stringify(input.encryptedGeneratedCode),
      input.gitUser,
      input.promptId,
      input.sessionId,
      input.runId,
      input.projectName,
      input.projectPath,
      input.status
    );
    const row = this.database.prepare(
      "SELECT id FROM prompt_results WHERE PromptId = ? LIMIT 1"
    ).get(input.promptId) as PromptResultIdRow | undefined;
    if (!row) throw new Error(`Prompt result was not found for ${input.promptId}`);
    return row.id;
  }
}

