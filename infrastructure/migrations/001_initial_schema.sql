CREATE TABLE tasks (
  task_id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(1000) NOT NULL CHECK (CHAR_LENGTH(title) BETWEEN 1 AND 1000),
  repository TEXT NOT NULL,
  workspace TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL REFERENCES tasks(task_id),
  started_at DATETIME(6) NOT NULL,
  ended_at DATETIME(6),
  developer VARCHAR(255) NOT NULL,
  environment JSON NOT NULL DEFAULT ('{}') CHECK (JSON_TYPE(environment) = 'OBJECT'),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE agent_runs (
  run_id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL REFERENCES sessions(session_id),
  agent_id VARCHAR(255) NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  agent_version VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6),
  terminal_event_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (terminal_event_hash IS NULL OR terminal_event_hash REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE model_invocations (
  invocation_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  provider VARCHAR(255) NOT NULL,
  model VARCHAR(255) NOT NULL,
  model_version VARCHAR(255),
  request_id VARCHAR(255),
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6),
  duration_ms BIGINT CHECK (duration_ms >= 0),
  input_tokens BIGINT CHECK (input_tokens >= 0),
  output_tokens BIGINT CHECK (output_tokens >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE prompts (
  prompt_id VARCHAR(255) PRIMARY KEY,
  invocation_id VARCHAR(255) REFERENCES model_invocations(invocation_id),
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  content_redacted TEXT NOT NULL,
  prompt_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (prompt_hash REGEXP '^[a-f0-9]{64}$'),
  created_at DATETIME(6) NOT NULL,
  reasoning_availability VARCHAR(32) NOT NULL CHECK (reasoning_availability IN ('USER_VISIBLE_SUMMARY','NOT_AVAILABLE'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE provenance_events (
  event_id VARCHAR(255) PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL REFERENCES tasks(task_id),
  session_id VARCHAR(255) NOT NULL REFERENCES sessions(session_id),
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_type VARCHAR(64) NOT NULL CHECK (event_type IN (
    'PROJECT_CREATED','TASK_CREATED','TASK_UPDATED','TASK_COMPLETED','SESSION_STARTED','SESSION_COMPLETED',
    'PROMPT_SUBMITTED','AGENT_STARTED','AGENT_COMPLETED','AGENT_FAILED','MODEL_REQUEST','MODEL_RESPONSE',
    'MODEL_ERROR','TOOL_STARTED','TOOL_COMPLETED','TOOL_FAILED','RESOURCE_ACCESSED','FILE_READ','FILE_CREATED',
    'FILE_MODIFIED','FILE_DELETED','FILE_RENAMED','CODE_DIFF_GENERATED','TERMINAL_COMMAND_STARTED',
    'TERMINAL_COMMAND_COMPLETED','TERMINAL_COMMAND_FAILED','TEST_STARTED','TEST_COMPLETED','TEST_FAILED',
    'TEST_EXECUTION','ARTIFACT_CREATED','ARTIFACT_MODIFIED','HUMAN_APPROVAL','HUMAN_REJECTION',
    'CHANGES_REQUESTED','GIT_COMMIT_CREATED','RUN_COMPLETED','RUN_FAILED','INTEGRITY_VERIFIED',
    'INTEGRITY_FAILED','ERROR'
  )),
  occurred_at DATETIME(6) NOT NULL,
  recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  actor JSON NOT NULL CHECK (JSON_TYPE(actor) = 'OBJECT'),
  source JSON NOT NULL CHECK (JSON_TYPE(source) = 'OBJECT'),
  payload JSON NOT NULL,
  previous_event_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  event_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (event_hash REGEXP '^[a-f0-9]{64}$'),
  hash_algorithm VARCHAR(16) NOT NULL CHECK (hash_algorithm = 'sha256'),
  schema_version VARCHAR(64) NOT NULL,
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, event_hash),
  CHECK (previous_event_hash IS NULL OR previous_event_hash REGEXP '^[a-f0-9]{64}$'),
  CHECK ((sequence = 1 AND previous_event_hash IS NULL) OR (sequence > 1 AND previous_event_hash IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE ingress_receipts (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  adapter VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NOT NULL UNIQUE REFERENCES provenance_events(event_id),
  accepted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE resources (
  resource_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  event_id VARCHAR(255) NOT NULL REFERENCES provenance_events(event_id),
  resource_type VARCHAR(32) NOT NULL CHECK (resource_type IN ('webpage','documentation','repository','file','database','API','article','book','search_result','other')),
  url TEXT,
  domain VARCHAR(255),
  title TEXT,
  accessed_at DATETIME(6) NOT NULL,
  tool_name VARCHAR(255),
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  evidence VARCHAR(32) NOT NULL CHECK (evidence IN ('OBSERVED','DECLARED','INFERRED','NOT_OBSERVED','UNKNOWN','NOT_AVAILABLE')),
  metadata JSON NOT NULL DEFAULT ('{}'),
  CHECK (content_hash IS NULL OR content_hash REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE artifacts (
  artifact_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  artifact_type VARCHAR(255) NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (content_hash REGEXP '^[a-f0-9]{64}$'),
  hash_algorithm VARCHAR(16) NOT NULL CHECK (hash_algorithm = 'sha256'),
  created_at DATETIME(6) NOT NULL,
  created_by_agent VARCHAR(255) NOT NULL,
  storage_reference TEXT NOT NULL,
  encryption_metadata JSON
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE artifact_manifests (
  manifest_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  manifest_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (manifest_hash REGEXP '^[a-f0-9]{64}$'),
  hash_algorithm VARCHAR(16) NOT NULL CHECK (hash_algorithm = 'sha256'),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE encrypted_artifact_blobs (
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY CHECK (content_hash REGEXP '^[a-f0-9]{64}$'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  backing_content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE CHECK (backing_content_hash REGEXP '^[a-f0-9]{64}$'),
  backing_storage_reference TEXT NOT NULL,
  encryption_metadata JSON NOT NULL CHECK (
    JSON_TYPE(encryption_metadata) = 'OBJECT'
    AND JSON_CONTAINS_PATH(encryption_metadata, 'one', '$.keyId')
    AND JSON_CONTAINS_PATH(encryption_metadata, 'one', '$.encryptedDataKey')
    AND JSON_CONTAINS_PATH(encryption_metadata, 'one', '$.iv')
    AND JSON_CONTAINS_PATH(encryption_metadata, 'one', '$.authTag')
    AND NOT JSON_CONTAINS_PATH(encryption_metadata, 'one', '$.plaintextKey')
  ),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE artifact_manifest_entries (
  manifest_id VARCHAR(255) NOT NULL REFERENCES artifact_manifests(manifest_id),
  artifact_id VARCHAR(255) NOT NULL REFERENCES artifacts(artifact_id),
  ordinal INT NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (manifest_id, artifact_id),
  UNIQUE (manifest_id, ordinal)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE file_changes (
  file_change_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  event_id VARCHAR(255) NOT NULL REFERENCES provenance_events(event_id),
  path TEXT NOT NULL,
  operation VARCHAR(16) NOT NULL CHECK (operation IN ('CREATED','MODIFIED','DELETED','RENAMED')),
  before_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  after_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  diff_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  CHECK (before_hash IS NULL OR before_hash REGEXP '^[a-f0-9]{64}$'),
  CHECK (after_hash IS NULL OR after_hash REGEXP '^[a-f0-9]{64}$'),
  CHECK (diff_hash IS NULL OR diff_hash REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tool_invocations (
  tool_invocation_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  started_event_id VARCHAR(255) NOT NULL REFERENCES provenance_events(event_id),
  completed_event_id VARCHAR(255) REFERENCES provenance_events(event_id),
  tool_name VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('STARTED','COMPLETED','FAILED')),
  request_redacted JSON,
  response_redacted JSON
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE command_executions (
  command_execution_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  started_event_id VARCHAR(255) NOT NULL REFERENCES provenance_events(event_id),
  completed_event_id VARCHAR(255) REFERENCES provenance_events(event_id),
  command_redacted TEXT NOT NULL,
  working_directory TEXT,
  exit_code INT,
  output_redacted TEXT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE approvals (
  approval_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  artifact_id VARCHAR(255) REFERENCES artifacts(artifact_id),
  manifest_id VARCHAR(255) REFERENCES artifact_manifests(manifest_id),
  reviewer VARCHAR(255) NOT NULL,
  decision VARCHAR(32) NOT NULL CHECK (decision IN ('APPROVED','REJECTED','REQUESTED_CHANGES')),
  decided_at DATETIME(6) NOT NULL,
  comment TEXT,
  CHECK ((artifact_id IS NOT NULL) + (manifest_id IS NOT NULL) = 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE git_commits (
  repository VARCHAR(255) NOT NULL,
  commit_id VARCHAR(255) NOT NULL,
  branch VARCHAR(255),
  base_commit VARCHAR(255),
  author VARCHAR(255) NOT NULL,
  author_email VARCHAR(255) NOT NULL,
  committed_at DATETIME(6) NOT NULL,
  changed_files JSON NOT NULL DEFAULT ('[]') CHECK (JSON_TYPE(changed_files) = 'ARRAY'),
  PRIMARY KEY (repository, commit_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE run_git_commits (
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  repository VARCHAR(255) NOT NULL,
  commit_id VARCHAR(255) NOT NULL,
  evidence VARCHAR(32) NOT NULL CHECK (evidence IN ('CONFIRMED','CANDIDATE','UNRESOLVED')),
  matched_artifact_ids JSON NOT NULL DEFAULT ('[]'),
  unmatched_artifact_ids JSON NOT NULL DEFAULT ('[]'),
  associated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (run_id, repository, commit_id),
  FOREIGN KEY (repository, commit_id) REFERENCES git_commits(repository, commit_id),
  CHECK (JSON_TYPE(matched_artifact_ids) = 'ARRAY'),
  CHECK (JSON_TYPE(unmatched_artifact_ids) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE integrity_records (
  integrity_record_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  status VARCHAR(32) NOT NULL CHECK (status IN ('VERIFIED','TAMPERED','INCOMPLETE','UNVERIFIED')),
  root_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  checked_at DATETIME(6) NOT NULL,
  diagnostics JSON NOT NULL DEFAULT ('{}'),
  CHECK (root_hash IS NULL OR root_hash REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE anchor_receipts (
  anchor_receipt_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  adapter VARCHAR(255) NOT NULL,
  root_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (root_hash REGEXP '^[a-f0-9]{64}$'),
  receipt JSON NOT NULL,
  anchored_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE outbox_events (
  message_id VARCHAR(255) PRIMARY KEY,
  topic VARCHAR(255) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_by VARCHAR(255),
  locked_until DATETIME(6),
  published_at DATETIME(6),
  last_error TEXT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
CREATE INDEX outbox_pending_idx ON outbox_events(published_at, created_at, message_id);

ALTER TABLE provenance_events COMMENT = 'Append-only normalized provenance event log. Runtime roles must not receive UPDATE or DELETE.';
ALTER TABLE prompts MODIFY content_redacted TEXT NOT NULL COMMENT 'Redacted representation only; plaintext secrets must never be inserted.';
