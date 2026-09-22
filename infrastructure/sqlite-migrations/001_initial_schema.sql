CREATE TABLE IF NOT EXISTS prompt_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  PromptQuery TEXT NOT NULL,
  AgentName TEXT NOT NULL,
  ModelName TEXT NOT NULL,
  Result TEXT NOT NULL,
  Resources TEXT NOT NULL CHECK (json_valid(Resources)),
  FilePaths TEXT NOT NULL CHECK (json_valid(FilePaths)),
  GeneratedCode TEXT NOT NULL CHECK (json_valid(GeneratedCode)),
  EncryptedGeneratedCode TEXT NOT NULL CHECK (json_valid(EncryptedGeneratedCode)),
  GitUser TEXT NOT NULL DEFAULT 'NOT_AVAILABLE',
  PromptId TEXT NULL UNIQUE,
  SessionId TEXT NULL,
  RunId TEXT NULL,
  ProjectName TEXT NULL,
  ProjectPath TEXT NULL,
  Status TEXT NOT NULL DEFAULT 'UNKNOWN',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL DEFAULT 'NOT_AVAILABLE'
);

CREATE TABLE IF NOT EXISTS execution_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id TEXT NOT NULL UNIQUE,
  external_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  prompt_result_id INTEGER NULL UNIQUE,
  project_name TEXT NULL,
  project_path TEXT NULL,
  agent_name TEXT NOT NULL DEFAULT 'NOT_AVAILABLE',
  model_name TEXT NOT NULL DEFAULT 'NOT_AVAILABLE',
  execution_status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (execution_status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'INTERRUPTED')),
  extraction_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (extraction_status IN ('NOT_STARTED', 'PENDING', 'SUCCEEDED', 'FAILED')),
  verification_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (verification_status IN ('NOT_STARTED', 'PENDING', 'SUCCEEDED', 'FAILED')),
  total_claims INTEGER NOT NULL DEFAULT 0 CHECK (total_claims >= 0),
  verified_claims INTEGER NOT NULL DEFAULT 0 CHECK (verified_claims >= 0),
  contradicted_claims INTEGER NOT NULL DEFAULT 0 CHECK (contradicted_claims >= 0),
  unsupported_claims INTEGER NOT NULL DEFAULT 0 CHECK (unsupported_claims >= 0),
  unverifiable_claims INTEGER NOT NULL DEFAULT 0 CHECK (unverifiable_claims >= 0),
  scored_claims INTEGER NOT NULL DEFAULT 0 CHECK (scored_claims >= 0),
  reliability_percent REAL NULL CHECK (reliability_percent IS NULL OR reliability_percent BETWEEN 0 AND 100),
  coverage_percent REAL NULL CHECK (coverage_percent IS NULL OR coverage_percent BETWEEN 0 AND 100),
  policy_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (prompt_result_id) REFERENCES prompt_results(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (total_claims = verified_claims + contradicted_claims + unsupported_claims + unverifiable_claims),
  CHECK (scored_claims = verified_claims + contradicted_claims + unsupported_claims)
);

CREATE INDEX IF NOT EXISTS idx_execution_sessions_external_session ON execution_sessions(external_session_id);
CREATE INDEX IF NOT EXISTS idx_execution_sessions_run ON execution_sessions(run_id);
CREATE INDEX IF NOT EXISTS idx_execution_sessions_completed_at ON execution_sessions(completed_at);
CREATE INDEX IF NOT EXISTS idx_execution_sessions_started_at ON execution_sessions(started_at, id);

CREATE TABLE IF NOT EXISTS trace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_session_id INTEGER NOT NULL,
  source_event_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'PROMPT_SUBMITTED', 'AGENT_STARTED', 'MODEL_REQUESTED', 'RESOURCE_ACCESSED',
    'FILE_READ', 'FILE_CREATED', 'FILE_MODIFIED', 'FILE_DELETED', 'DIRECTORY_CREATED',
    'COMMAND_STARTED', 'COMMAND_COMPLETED', 'BUILD_COMPLETED', 'TEST_COMPLETED',
    'ARCHITECTURE_CHECK_COMPLETED', 'FINAL_RESPONSE_CAPTURED', 'AGENT_COMPLETED',
    'AGENT_FAILED', 'SESSION_COMPLETED'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('RECORDED', 'SUCCEEDED', 'FAILED')),
  occurred_at TEXT NOT NULL,
  target TEXT NULL,
  tool_name TEXT NULL,
  file_path TEXT NULL,
  command_text TEXT NULL,
  working_directory TEXT NULL,
  exit_code INTEGER NULL,
  test_passed INTEGER NULL CHECK (test_passed IS NULL OR test_passed >= 0),
  test_failed INTEGER NULL CHECK (test_failed IS NULL OR test_failed >= 0),
  test_skipped INTEGER NULL CHECK (test_skipped IS NULL OR test_skipped >= 0),
  file_existed_before INTEGER NULL CHECK (file_existed_before IS NULL OR file_existed_before IN (0, 1)),
  file_exists_after INTEGER NULL CHECK (file_exists_after IS NULL OR file_exists_after IN (0, 1)),
  file_hash_before TEXT NULL CHECK (file_hash_before IS NULL OR (length(file_hash_before) = 64 AND file_hash_before NOT GLOB '*[^0-9a-f]*')),
  file_hash_after TEXT NULL CHECK (file_hash_after IS NULL OR (length(file_hash_after) = 64 AND file_hash_after NOT GLOB '*[^0-9a-f]*')),
  output_hash TEXT NULL CHECK (output_hash IS NULL OR (length(output_hash) = 64 AND output_hash NOT GLOB '*[^0-9a-f]*')),
  previous_event_hash TEXT NULL CHECK (previous_event_hash IS NULL OR (length(previous_event_hash) = 64 AND previous_event_hash NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (execution_session_id, source_event_id),
  UNIQUE (execution_session_id, sequence_number),
  FOREIGN KEY (execution_session_id) REFERENCES execution_sessions(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_trace_events_type ON trace_events(execution_session_id, event_type);
CREATE INDEX IF NOT EXISTS idx_trace_events_occurred_at ON trace_events(occurred_at);

CREATE TABLE IF NOT EXISTS agent_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_session_id INTEGER NOT NULL,
  claim_index INTEGER NOT NULL CHECK (claim_index > 0),
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN (
    'FILE_CREATED', 'FILE_MODIFIED', 'STRUCTURE_CREATED', 'DEPENDENCY_RULE',
    'COMMAND_SUCCEEDED', 'BUILD_PASSED', 'TEST_PASSED', 'TASK_COMPLETED'
  )),
  target TEXT NOT NULL,
  expected_result TEXT NOT NULL,
  verdict TEXT NULL CHECK (verdict IS NULL OR verdict IN ('VERIFIED', 'CONTRADICTED', 'UNSUPPORTED', 'UNVERIFIABLE')),
  verdict_reason_code TEXT NULL CHECK (verdict_reason_code IS NULL OR verdict_reason_code IN (
    'REQUIRED_EVIDENCE_CONFIRMED', 'CONTRADICTORY_EVIDENCE_FOUND',
    'MATCHING_EVIDENCE_NOT_FOUND', 'OBJECTIVE_RULE_NOT_DEFINED', 'EVIDENCE_IS_STALE',
    'EVIDENCE_IS_INVALID', 'AGGREGATE_REQUIREMENTS_NOT_MET'
  )),
  verdict_explanation TEXT NULL,
  evidence_event_ids TEXT NOT NULL CHECK (json_valid(evidence_event_ids) AND json_type(evidence_event_ids) = 'array'),
  extractor_model TEXT NOT NULL,
  extraction_prompt_version TEXT NOT NULL,
  verification_rule_version TEXT NOT NULL,
  verified_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (execution_session_id, claim_index),
  FOREIGN KEY (execution_session_id) REFERENCES execution_sessions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (
    (verdict IS NULL AND verdict_reason_code IS NULL AND verified_at IS NULL)
    OR (verdict IS NOT NULL AND verdict_reason_code IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_claims_verdict ON agent_claims(execution_session_id, verdict);
CREATE INDEX IF NOT EXISTS idx_agent_claims_type ON agent_claims(claim_type);
