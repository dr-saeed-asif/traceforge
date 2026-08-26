CREATE TABLE tasks (
  task_id text PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 1000),
  repository text NOT NULL,
  workspace text NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))
);

CREATE TABLE sessions (
  session_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(task_id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  developer text NOT NULL,
  environment jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(environment) = 'object'),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE agent_runs (
  run_id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(session_id),
  agent_id text NOT NULL,
  agent_name text NOT NULL,
  agent_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  terminal_event_hash char(64),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (terminal_event_hash IS NULL OR terminal_event_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE model_invocations (
  invocation_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  provider text NOT NULL,
  model text NOT NULL,
  model_version text,
  request_id text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms bigint CHECK (duration_ms >= 0),
  input_tokens bigint CHECK (input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0)
);

CREATE TABLE prompts (
  prompt_id text PRIMARY KEY,
  invocation_id text REFERENCES model_invocations(invocation_id),
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  content_redacted text NOT NULL,
  prompt_hash char(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  reasoning_availability text NOT NULL CHECK (reasoning_availability IN ('USER_VISIBLE_SUMMARY','NOT_AVAILABLE'))
);

CREATE TABLE provenance_events (
  event_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(task_id),
  session_id text NOT NULL REFERENCES sessions(session_id),
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'TASK_CREATED','SESSION_STARTED','SESSION_COMPLETED','PROMPT_SUBMITTED','AGENT_STARTED','AGENT_COMPLETED',
    'MODEL_REQUEST','MODEL_RESPONSE','TOOL_STARTED','TOOL_COMPLETED','RESOURCE_ACCESSED','FILE_READ',
    'FILE_CREATED','FILE_MODIFIED','FILE_DELETED','CODE_DIFF_GENERATED','TERMINAL_COMMAND_STARTED',
    'TERMINAL_COMMAND_COMPLETED','TEST_EXECUTION','ARTIFACT_CREATED','HUMAN_APPROVAL','HUMAN_REJECTION',
    'GIT_COMMIT_CREATED','ERROR','RUN_COMPLETED'
  )),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor) = 'object'),
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  payload jsonb NOT NULL,
  previous_event_hash char(64),
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  hash_algorithm text NOT NULL CHECK (hash_algorithm = 'sha256'),
  schema_version text NOT NULL,
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, event_hash),
  CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[a-f0-9]{64}$'),
  CHECK ((sequence = 1 AND previous_event_hash IS NULL) OR (sequence > 1 AND previous_event_hash IS NOT NULL))
);

CREATE TABLE ingress_receipts (
  idempotency_key text PRIMARY KEY,
  adapter text NOT NULL,
  event_id text NOT NULL UNIQUE REFERENCES provenance_events(event_id),
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resources (
  resource_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  event_id text NOT NULL REFERENCES provenance_events(event_id),
  resource_type text NOT NULL CHECK (resource_type IN ('webpage','documentation','repository','file','database','API','article','book','search_result','other')),
  url text,
  domain text,
  title text,
  accessed_at timestamptz NOT NULL,
  tool_name text,
  content_hash char(64),
  evidence text NOT NULL CHECK (evidence IN ('OBSERVED','DECLARED','INFERRED','UNKNOWN','NOT_AVAILABLE')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE artifacts (
  artifact_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  artifact_type text NOT NULL,
  relative_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  hash_algorithm text NOT NULL CHECK (hash_algorithm = 'sha256'),
  created_at timestamptz NOT NULL,
  created_by_agent text NOT NULL,
  storage_reference text NOT NULL,
  encryption_metadata jsonb
);

CREATE TABLE artifact_manifests (
  manifest_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  hash_algorithm text NOT NULL CHECK (hash_algorithm = 'sha256'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE encrypted_artifact_blobs (
  content_hash char(64) PRIMARY KEY CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  backing_content_hash char(64) NOT NULL UNIQUE CHECK (backing_content_hash ~ '^[a-f0-9]{64}$'),
  backing_storage_reference text NOT NULL,
  encryption_metadata jsonb NOT NULL CHECK (
    jsonb_typeof(encryption_metadata) = 'object'
    AND encryption_metadata ? 'keyId'
    AND encryption_metadata ? 'encryptedDataKey'
    AND encryption_metadata ? 'iv'
    AND encryption_metadata ? 'authTag'
    AND NOT (encryption_metadata ? 'plaintextKey')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifact_manifest_entries (
  manifest_id text NOT NULL REFERENCES artifact_manifests(manifest_id),
  artifact_id text NOT NULL REFERENCES artifacts(artifact_id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (manifest_id, artifact_id),
  UNIQUE (manifest_id, ordinal)
);

CREATE TABLE file_changes (
  file_change_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  event_id text NOT NULL REFERENCES provenance_events(event_id),
  path text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('CREATED','MODIFIED','DELETED','RENAMED')),
  before_hash char(64),
  after_hash char(64),
  diff_hash char(64),
  CHECK (before_hash IS NULL OR before_hash ~ '^[a-f0-9]{64}$'),
  CHECK (after_hash IS NULL OR after_hash ~ '^[a-f0-9]{64}$'),
  CHECK (diff_hash IS NULL OR diff_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE tool_invocations (
  tool_invocation_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  started_event_id text NOT NULL REFERENCES provenance_events(event_id),
  completed_event_id text REFERENCES provenance_events(event_id),
  tool_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('STARTED','COMPLETED','FAILED')),
  request_redacted jsonb,
  response_redacted jsonb
);

CREATE TABLE command_executions (
  command_execution_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  started_event_id text NOT NULL REFERENCES provenance_events(event_id),
  completed_event_id text REFERENCES provenance_events(event_id),
  command_redacted text NOT NULL,
  working_directory text,
  exit_code integer,
  output_redacted text
);

CREATE TABLE approvals (
  approval_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  artifact_id text REFERENCES artifacts(artifact_id),
  manifest_id text REFERENCES artifact_manifests(manifest_id),
  reviewer text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','REQUESTED_CHANGES')),
  decided_at timestamptz NOT NULL,
  comment text,
  CHECK ((artifact_id IS NOT NULL)::integer + (manifest_id IS NOT NULL)::integer = 1)
);

CREATE TABLE git_commits (
  repository text NOT NULL,
  commit_id text NOT NULL,
  branch text,
  base_commit text,
  author text NOT NULL,
  author_email text NOT NULL,
  committed_at timestamptz NOT NULL,
  changed_files jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changed_files) = 'array'),
  PRIMARY KEY (repository, commit_id)
);

CREATE TABLE run_git_commits (
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  repository text NOT NULL,
  commit_id text NOT NULL,
  evidence text NOT NULL CHECK (evidence IN ('CONFIRMED','CANDIDATE','UNRESOLVED')),
  matched_artifact_ids text[] NOT NULL DEFAULT '{}',
  unmatched_artifact_ids text[] NOT NULL DEFAULT '{}',
  associated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, repository, commit_id),
  FOREIGN KEY (repository, commit_id) REFERENCES git_commits(repository, commit_id)
);

CREATE TABLE integrity_records (
  integrity_record_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  status text NOT NULL CHECK (status IN ('VERIFIED','TAMPERED','INCOMPLETE','UNVERIFIED')),
  root_hash char(64),
  checked_at timestamptz NOT NULL,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (root_hash IS NULL OR root_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE anchor_receipts (
  anchor_receipt_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  adapter text NOT NULL,
  root_hash char(64) NOT NULL CHECK (root_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL,
  anchored_at timestamptz NOT NULL
);

CREATE TABLE outbox_events (
  message_id text PRIMARY KEY,
  topic text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_by text,
  locked_until timestamptz,
  published_at timestamptz,
  last_error text
);

CREATE INDEX sessions_task_id_idx ON sessions(task_id);
CREATE INDEX agent_runs_session_id_idx ON agent_runs(session_id);
CREATE INDEX agent_runs_status_started_at_idx ON agent_runs(status, started_at DESC);
CREATE INDEX model_invocations_run_id_idx ON model_invocations(run_id);
CREATE INDEX provenance_events_run_sequence_idx ON provenance_events(run_id, sequence);
CREATE INDEX resources_run_id_idx ON resources(run_id);
CREATE INDEX artifacts_run_id_idx ON artifacts(run_id);
CREATE INDEX artifacts_content_address_idx ON artifacts(hash_algorithm, content_hash, size_bytes);
CREATE INDEX file_changes_run_id_idx ON file_changes(run_id);
CREATE INDEX run_git_commits_commit_idx ON run_git_commits(repository, commit_id);
CREATE INDEX outbox_pending_idx ON outbox_events(created_at, message_id)
  WHERE published_at IS NULL;

COMMENT ON TABLE provenance_events IS 'Append-only normalized provenance event log. Runtime roles must not receive UPDATE or DELETE.';
COMMENT ON COLUMN prompts.content_redacted IS 'Redacted representation only; plaintext secrets must never be inserted.';
