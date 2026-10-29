import { parseGeneratedCodeKey } from "./generated-code-crypto.js";

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly apiToken: string;
  readonly generatedCodeKey: Buffer;
  readonly extractor: "heuristic" | "ollama";
  readonly llm?: {
    readonly endpoint: string;
    readonly model: string;
    readonly timeoutMs: number;
  };
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Config {
  const databasePath =
    environment.TRACEFORGE_DATABASE_PATH?.trim() || "./data/traceforge.sqlite";
  const apiToken = required(
    environment.TRACEFORGE_API_TOKEN,
    "TRACEFORGE_API_TOKEN",
  );
  if (apiToken.length < 16)
    throw new Error("TRACEFORGE_API_TOKEN must contain at least 16 characters");
  const port = Number(environment.TRACEFORGE_PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("TRACEFORGE_PORT is invalid");
  const generatedCodeKey = parseGeneratedCodeKey(
    environment.TRACEFORGE_GENERATED_CODE_PRIVATE_KEY,
  );
  const extractorName = environment.TRACEFORGE_EXTRACTOR ?? "ollama";
  if (!["ollama", "heuristic"].includes(extractorName))
    throw new Error("TRACEFORGE_EXTRACTOR must be ollama or heuristic");
  const extractor = extractorName as "ollama" | "heuristic";
  const timeoutMs = Number(environment.TRACEFORGE_LLM_TIMEOUT_MS ?? "180000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000)
    throw new Error("TRACEFORGE_LLM_TIMEOUT_MS must be 1000–600000");
  const llm = extractor === "ollama" ? {
    endpoint: environment.TRACEFORGE_LLM_ENDPOINT ?? "http://127.0.0.1:11434/api/chat",
    model: environment.TRACEFORGE_LLM_MODEL ?? "qwen3.5:4b",
    timeoutMs,
  } : undefined;
  return {
    host: environment.TRACEFORGE_HOST ?? "127.0.0.1",
    port,
    databasePath,
    apiToken,
    generatedCodeKey,
    extractor,
    ...(llm ? { llm } : {}),
  };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
