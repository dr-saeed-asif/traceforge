import { parseGeneratedCodeKey } from "./generated-code-crypto.js";

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly apiToken: string;
  readonly generatedCodeKey: Buffer;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const databasePath = environment.TRACEFORGE_DATABASE_PATH?.trim() || "./data/traceforge.sqlite";
  const apiToken = required(environment.TRACEFORGE_API_TOKEN, "TRACEFORGE_API_TOKEN");
  if (apiToken.length < 16) throw new Error("TRACEFORGE_API_TOKEN must contain at least 16 characters");
  const port = Number(environment.TRACEFORGE_PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("TRACEFORGE_PORT is invalid");
  const generatedCodeKey = parseGeneratedCodeKey(environment.TRACEFORGE_GENERATED_CODE_PRIVATE_KEY);
  return { host: environment.TRACEFORGE_HOST ?? "127.0.0.1", port, databasePath, apiToken, generatedCodeKey };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
