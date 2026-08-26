import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationDirectory=resolve(repositoryRoot,"infrastructure/migrations");
const migration=readdirSync(migrationDirectory).filter(name=>name.endsWith(".sql")).sort().map(name=>readFileSync(resolve(migrationDirectory,name),"utf8")).join("\n");
const permissions = readFileSync(resolve(repositoryRoot, "infrastructure/database/runtime-permissions.sql"), "utf8");

describe("PostgreSQL migration contract", () => {
  it("defines the normalized MVP tables", () => {
    const expected = [
      "projects", "tasks", "sessions", "agents", "agent_runs", "model_invocations", "prompts",
      "provenance_events", "resources", "artifacts", "artifact_manifests",
      "encrypted_artifact_blobs",
      "file_changes", "tool_invocations", "command_executions", "test_executions", "approvals", "integration_run_contexts", "opencode_activities",
      "git_commits", "integrity_records", "anchor_receipts", "ingress_receipts", "outbox_events"
    ];
    for (const table of expected) expect(migration).toMatch(new RegExp(`CREATE TABLE ${table}\\s*\\(`, "u"));
  });

  it("enforces run sequence and idempotency uniqueness", () => {
    expect(migration).toContain("UNIQUE (run_id, sequence)");
    expect(migration).toMatch(/idempotency_key text PRIMARY KEY/u);
    expect(migration).toContain("CHECK ((sequence = 1 AND previous_event_hash IS NULL)");
  });

  it("deduplicates artifact bytes in blob storage without collapsing artifact identity", () => {
    expect(migration).toContain("CREATE INDEX artifacts_content_address_idx");
    expect(migration).not.toContain("UNIQUE (hash_algorithm, content_hash, size_bytes)");
  });

  it("forbids plaintext data keys in encrypted blob metadata", () => {
    expect(migration).toContain("NOT (encryption_metadata ? 'plaintextKey')");
    expect(migration).toContain("encryption_metadata ? 'encryptedDataKey'");
  });

  it("does not grant event mutation to the runtime role", () => {
    expect(permissions).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON provenance_events");
    expect(permissions).not.toMatch(/GRANT\s+UPDATE[^;]+provenance_events/iu);
  });
});
