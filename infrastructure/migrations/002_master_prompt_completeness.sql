CREATE TABLE projects (
  project_id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 1000),
  repository text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);

ALTER TABLE tasks ADD COLUMN project_id text REFERENCES projects(project_id);
CREATE INDEX tasks_project_id_idx ON tasks(project_id);

CREATE TABLE agents (
  agent_id text PRIMARY KEY,
  name text NOT NULL,
  adapter_name text NOT NULL,
  version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE test_executions (
  test_execution_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  started_event_id text REFERENCES provenance_events(event_id),
  completed_event_id text REFERENCES provenance_events(event_id),
  command_redacted text NOT NULL,
  framework text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  passed integer CHECK (passed >= 0),
  failed integer CHECK (failed >= 0),
  skipped integer CHECK (skipped >= 0),
  exit_code integer,
  output_reference text,
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX test_executions_run_id_idx ON test_executions(run_id);

ALTER TABLE provenance_events DROP CONSTRAINT provenance_events_event_type_check;
ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_event_type_check CHECK (event_type IN (
  'PROJECT_CREATED','TASK_CREATED','TASK_UPDATED','TASK_COMPLETED','SESSION_STARTED','SESSION_COMPLETED',
  'PROMPT_SUBMITTED','AGENT_STARTED','AGENT_COMPLETED','AGENT_FAILED','MODEL_REQUEST','MODEL_RESPONSE',
  'MODEL_ERROR','TOOL_STARTED','TOOL_COMPLETED','TOOL_FAILED','RESOURCE_ACCESSED','FILE_READ','FILE_CREATED',
  'FILE_MODIFIED','FILE_DELETED','FILE_RENAMED','CODE_DIFF_GENERATED','TERMINAL_COMMAND_STARTED',
  'TERMINAL_COMMAND_COMPLETED','TERMINAL_COMMAND_FAILED','TEST_STARTED','TEST_COMPLETED','TEST_FAILED',
  'TEST_EXECUTION','ARTIFACT_CREATED','ARTIFACT_MODIFIED','HUMAN_APPROVAL','HUMAN_REJECTION',
  'CHANGES_REQUESTED','GIT_COMMIT_CREATED','RUN_COMPLETED','RUN_FAILED','INTEGRITY_VERIFIED',
  'INTEGRITY_FAILED','ERROR'
));

ALTER TABLE resources DROP CONSTRAINT resources_evidence_check;
ALTER TABLE resources ADD CONSTRAINT resources_evidence_check CHECK (
  evidence IN ('OBSERVED','DECLARED','INFERRED','NOT_OBSERVED','UNKNOWN','NOT_AVAILABLE')
);
