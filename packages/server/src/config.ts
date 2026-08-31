import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CentralServerConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly apiToken: string;
  readonly artifactDirectory: string;
  readonly bufferDirectory: string;
  readonly localKeyId: string;
  readonly localKek: Uint8Array;
  readonly databasePoolSize: number;
  readonly maxBodyBytes: number;
}

export function loadEnvironmentFile(path: string, target: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([^#=\s]+)=(.*)$/u.exec(line);
    if (match?.[1] && target[match[1]] === undefined) target[match[1]] = match[2] ?? "";
  }
}

export function defaultRuntimeEnvironmentPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../.traceforge/operational/runtime.env");
}

export function loadCentralServerConfig(environment: NodeJS.ProcessEnv = process.env): CentralServerConfig {
  const port = integer(environment.TRACEFORGE_PORT ?? "8080", "TRACEFORGE_PORT", 1, 65535);
  const poolSize = integer(environment.TRACEFORGE_DB_POOL_SIZE ?? "10", "TRACEFORGE_DB_POOL_SIZE", 1, 100);
  const maxBodyBytes = integer(environment.TRACEFORGE_MAX_BODY_BYTES ?? "65536", "TRACEFORGE_MAX_BODY_BYTES", 1024, 10 * 1024 * 1024);
  const kek = Buffer.from(required(environment.TRACEFORGE_LOCAL_KEK_BASE64, "TRACEFORGE_LOCAL_KEK_BASE64"), "base64");
  if (kek.byteLength !== 32) throw new TypeError("TRACEFORGE_LOCAL_KEK_BASE64 must decode to exactly 32 bytes");
  if ((environment.ENCRYPTION_PROVIDER ?? "local") !== "local") throw new TypeError("This composition root currently requires ENCRYPTION_PROVIDER=local");
  return {
    host: environment.TRACEFORGE_HOST?.trim() || "127.0.0.1",
    port,
    databaseUrl: required(environment.DATABASE_URL, "DATABASE_URL"),
    apiToken: minimum(required(environment.TRACEFORGE_API_TOKEN, "TRACEFORGE_API_TOKEN"), "TRACEFORGE_API_TOKEN", 16),
    artifactDirectory: required(environment.TRACEFORGE_ARTIFACT_DIR, "TRACEFORGE_ARTIFACT_DIR"),
    bufferDirectory: environment.TRACEFORGE_BUFFER_DIR?.trim() || resolve(".traceforge", "operational", "buffer"),
    localKeyId: required(environment.TRACEFORGE_LOCAL_KEY_ID, "TRACEFORGE_LOCAL_KEY_ID"),
    localKek: kek,
    databasePoolSize: poolSize,
    maxBodyBytes
  };
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}
function minimum(value: string, name: string, length: number): string {
  if (value.length < length) throw new TypeError(`${name} must contain at least ${length} characters`);
  return value;
}
function integer(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  return parsed;
}
