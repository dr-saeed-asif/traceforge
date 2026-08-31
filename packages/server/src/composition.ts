import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceForgeApi, StaticBearerAuthenticator, type ApiAuditRecord, type ApiAuditSink } from "@traceforge/api";
import { EncryptedArtifactStore, FileArtifactStore, FileDurableBuffer, ProvenanceCollector, SystemClock, UuidGenerator } from "@traceforge/collector";
import { EnvelopeEncryption, LocalKeyProvider } from "@traceforge/crypto";
import { PostgresEncryptedArtifactMetadata, PostgresEventRepository, PostgresIntegrationContextRegistry, PostgresTraceForgeApiStore, runMigrations } from "@traceforge/database";
import { Pool } from "pg";
import type { CentralServerConfig } from "./config.js";
import { createTraceForgeHttpServer, listen, close } from "./http-server.js";
import { CentralTraceForgeIngestion } from "./ingestion.js";
import { PostgresRunStatusRepository } from "./postgres-run-status.js";

export interface RunningCentralServer { readonly url: string; stop(): Promise<void>; }

export async function startCentralServer(config: CentralServerConfig): Promise<RunningCentralServer> {
  const pool = new Pool({ connectionString: config.databaseUrl, max: config.databasePoolSize });
  const clock = new SystemClock();
  const ids = new UuidGenerator();
  const migrationDirectory = resolve(fileURLToPath(new URL("../../../infrastructure/migrations/", import.meta.url)));
  try {
    await pool.query("SELECT 1");
    await runMigrations(pool, migrationDirectory);
    const backingArtifacts = new FileArtifactStore(config.artifactDirectory);
    const artifacts = new EncryptedArtifactStore(backingArtifacts, new PostgresEncryptedArtifactMetadata(pool), new EnvelopeEncryption(new LocalKeyProvider(config.localKeyId, config.localKek)));
    const collector = new ProvenanceCollector(new PostgresEventRepository(pool), new FileDurableBuffer(config.bufferDirectory), clock, ids);
    await collector.start();
    const ingestion = new CentralTraceForgeIngestion(new PostgresIntegrationContextRegistry(pool), collector, new PostgresRunStatusRepository(pool));
    const authenticator = new StaticBearerAuthenticator([{ token: config.apiToken, subject: "traceforge-operational-plugin", scopes: ["trace:read", "trace:write", "trace:ingest", "trace:verify", "artifact:read", "approval:write"] }]);
    const api = new TraceForgeApi({ store: new PostgresTraceForgeApiStore(pool, artifacts, clock, ids), authenticator, ingestion, audit: new JsonConsoleAuditSink(), maxBodyBytes: config.maxBodyBytes });
    const server = createTraceForgeHttpServer(api, config);
    await listen(server, config);
    let stopped = false;
    return {
      url: `http://${config.host}:${config.port}`,
      async stop() {
        if (stopped) return;
        stopped = true;
        await close(server);
        await collector.stop();
        await pool.end();
        config.localKek.fill(0);
      }
    };
  } catch (error) {
    config.localKek.fill(0);
    await pool.end().catch(() => undefined);
    throw error;
  }
}

class JsonConsoleAuditSink implements ApiAuditSink {
  public async record(record: ApiAuditRecord): Promise<void> {
    process.stdout.write(`${JSON.stringify({ level: "info", type: "api_audit", ...record })}\n`);
  }
}
