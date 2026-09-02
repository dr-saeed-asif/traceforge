-- Run as a MySQL database administrator after creating the traceforge database.
-- Login users, passwords, and role membership belong in the deployment secret
-- manager and are intentionally not defined here.
CREATE ROLE IF NOT EXISTS 'traceforge_runtime'@'%';
CREATE ROLE IF NOT EXISTS 'traceforge_reader'@'%';

REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'traceforge_runtime'@'%';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'traceforge_reader'@'%';
GRANT SELECT ON traceforge.* TO 'traceforge_reader'@'%';
GRANT SELECT, INSERT ON traceforge.* TO 'traceforge_runtime'@'%';
GRANT UPDATE (locked_by, locked_until, attempts, published_at, last_error)
  ON traceforge.outbox_events TO 'traceforge_runtime'@'%';
GRANT UPDATE (status) ON traceforge.tasks TO 'traceforge_runtime'@'%';
GRANT UPDATE (ended_at) ON traceforge.sessions TO 'traceforge_runtime'@'%';
GRANT UPDATE (status, completed_at, terminal_event_hash) ON traceforge.agent_runs TO 'traceforge_runtime'@'%';
GRANT UPDATE (completed_at, duration_ms, input_tokens, output_tokens)
  ON traceforge.model_invocations TO 'traceforge_runtime'@'%';
GRANT UPDATE (completed_event_id, status, response_redacted)
  ON traceforge.tool_invocations TO 'traceforge_runtime'@'%';
GRANT UPDATE (completed_event_id, exit_code, output_redacted)
  ON traceforge.command_executions TO 'traceforge_runtime'@'%';

-- Grant a role to a separately managed login account, for example:
-- GRANT 'traceforge_runtime'@'%' TO 'traceforge_app'@'127.0.0.1';
