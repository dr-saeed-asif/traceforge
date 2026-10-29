import type { EncryptedGeneratedCode } from "../generated-code-crypto.js";

export interface PersistPromptResultInput {
  readonly promptId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly projectName: string | null;
  readonly projectPath: string | null;
  readonly status: string;
  readonly promptQuery: string;
  readonly agentName: string;
  readonly modelName: string;
  readonly result: string;
  readonly resources: readonly unknown[];
  readonly filePaths: readonly string[];
  readonly generatedCode: readonly { readonly path: string; readonly code: string }[];
  readonly encryptedGeneratedCode: EncryptedGeneratedCode;
  readonly gitUser: string;
}

/** Persistence port for the backward-compatible prompt_results projection. */
export interface PromptResultRepository {
  save(input: PersistPromptResultInput): Promise<number>;
}

