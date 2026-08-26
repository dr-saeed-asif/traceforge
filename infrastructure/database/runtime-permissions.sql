-- Run as the database owner after creating the NOLOGIN group roles below.
-- Login roles should inherit these groups; passwords and authentication belong
-- in the deployment secret manager, never in this repository.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'traceforge_runtime') THEN
    CREATE ROLE traceforge_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'traceforge_reader') THEN
    CREATE ROLE traceforge_reader NOLOGIN;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO traceforge_runtime, traceforge_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO traceforge_reader;
GRANT SELECT, INSERT ON tasks, sessions, agent_runs, model_invocations, prompts,
  projects, agents, test_executions,
  provenance_events, ingress_receipts, resources, artifacts, artifact_manifests,
  artifact_manifest_entries, encrypted_artifact_blobs, file_changes, tool_invocations, command_executions,
  approvals, git_commits, run_git_commits, integrity_records, anchor_receipts,
  outbox_events TO traceforge_runtime;
GRANT UPDATE (locked_by, locked_until, attempts, published_at, last_error)
  ON outbox_events TO traceforge_runtime;
GRANT UPDATE (status) ON tasks TO traceforge_runtime;
GRANT UPDATE (ended_at) ON sessions TO traceforge_runtime;
GRANT UPDATE (status, completed_at, terminal_event_hash) ON agent_runs TO traceforge_runtime;
GRANT UPDATE (completed_at, duration_ms, input_tokens, output_tokens) ON model_invocations TO traceforge_runtime;
GRANT UPDATE (completed_event_id, status, response_redacted) ON tool_invocations TO traceforge_runtime;
GRANT UPDATE (completed_event_id, exit_code, output_redacted) ON command_executions TO traceforge_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON provenance_events, ingress_receipts FROM traceforge_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
