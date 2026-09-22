-- Phase 2 adds verification storage beside the legacy prompt_results table.
-- prompt_results remains unchanged and may be linked after prompt finalization.

CREATE TABLE IF NOT EXISTS execution_sessions (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `prompt_id` VARCHAR(128) NOT NULL,
  `external_session_id` VARCHAR(255) NOT NULL,
  `run_id` VARCHAR(255) NOT NULL,
  `prompt_result_id` INT NULL,
  `project_name` VARCHAR(255) NULL,
  `project_path` TEXT NULL,
  `agent_name` VARCHAR(255) NOT NULL DEFAULT 'NOT_AVAILABLE',
  `model_name` VARCHAR(255) NOT NULL DEFAULT 'NOT_AVAILABLE',
  `execution_status` VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS',
  `extraction_status` VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
  `verification_status` VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
  `total_claims` INT UNSIGNED NOT NULL DEFAULT 0,
  `verified_claims` INT UNSIGNED NOT NULL DEFAULT 0,
  `contradicted_claims` INT UNSIGNED NOT NULL DEFAULT 0,
  `unsupported_claims` INT UNSIGNED NOT NULL DEFAULT 0,
  `unverifiable_claims` INT UNSIGNED NOT NULL DEFAULT 0,
  `scored_claims` INT UNSIGNED NOT NULL DEFAULT 0,
  `reliability_percent` DECIMAL(5,2) NULL,
  `coverage_percent` DECIMAL(5,2) NULL,
  `policy_version` VARCHAR(64) NOT NULL,
  `started_at` DATETIME(6) NOT NULL,
  `completed_at` DATETIME(6) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_execution_sessions_prompt_id` (`prompt_id`),
  UNIQUE KEY `uq_execution_sessions_prompt_result_id` (`prompt_result_id`),
  KEY `idx_execution_sessions_external_session` (`external_session_id`),
  KEY `idx_execution_sessions_run` (`run_id`),
  KEY `idx_execution_sessions_completed_at` (`completed_at`),
  CONSTRAINT `fk_execution_sessions_prompt_result`
    FOREIGN KEY (`prompt_result_id`) REFERENCES `prompt_results` (`id`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_execution_sessions_execution_status`
    CHECK (`execution_status` IN ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'INTERRUPTED')),
  CONSTRAINT `chk_execution_sessions_extraction_status`
    CHECK (`extraction_status` IN ('NOT_STARTED', 'PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT `chk_execution_sessions_verification_status`
    CHECK (`verification_status` IN ('NOT_STARTED', 'PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT `chk_execution_sessions_claim_totals`
    CHECK (`total_claims` = `verified_claims` + `contradicted_claims` + `unsupported_claims` + `unverifiable_claims`),
  CONSTRAINT `chk_execution_sessions_scored_claims`
    CHECK (`scored_claims` = `verified_claims` + `contradicted_claims` + `unsupported_claims`),
  CONSTRAINT `chk_execution_sessions_reliability`
    CHECK (`reliability_percent` IS NULL OR (`reliability_percent` >= 0 AND `reliability_percent` <= 100)),
  CONSTRAINT `chk_execution_sessions_coverage`
    CHECK (`coverage_percent` IS NULL OR (`coverage_percent` >= 0 AND `coverage_percent` <= 100))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trace_events (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `execution_session_id` BIGINT UNSIGNED NOT NULL,
  `source_event_id` VARCHAR(128) NOT NULL,
  `sequence_number` INT UNSIGNED NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `outcome` VARCHAR(16) NOT NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `target` TEXT NULL,
  `tool_name` VARCHAR(255) NULL,
  `file_path` TEXT NULL,
  `command_text` TEXT NULL,
  `working_directory` TEXT NULL,
  `exit_code` INT NULL,
  `test_passed` INT UNSIGNED NULL,
  `test_failed` INT UNSIGNED NULL,
  `test_skipped` INT UNSIGNED NULL,
  `file_existed_before` BOOLEAN NULL,
  `file_exists_after` BOOLEAN NULL,
  `file_hash_before` CHAR(64) NULL,
  `file_hash_after` CHAR(64) NULL,
  `output_hash` CHAR(64) NULL,
  `previous_event_hash` CHAR(64) NULL,
  `event_hash` CHAR(64) NOT NULL,
  `metadata_json` JSON NOT NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trace_events_source` (`execution_session_id`, `source_event_id`),
  UNIQUE KEY `uq_trace_events_sequence` (`execution_session_id`, `sequence_number`),
  KEY `idx_trace_events_type` (`execution_session_id`, `event_type`),
  KEY `idx_trace_events_occurred_at` (`occurred_at`),
  CONSTRAINT `fk_trace_events_execution_session`
    FOREIGN KEY (`execution_session_id`) REFERENCES `execution_sessions` (`id`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_trace_events_sequence`
    CHECK (`sequence_number` > 0),
  CONSTRAINT `chk_trace_events_type`
    CHECK (`event_type` IN (
      'PROMPT_SUBMITTED', 'AGENT_STARTED', 'MODEL_REQUESTED', 'RESOURCE_ACCESSED',
      'FILE_READ', 'FILE_CREATED', 'FILE_MODIFIED', 'FILE_DELETED', 'DIRECTORY_CREATED',
      'COMMAND_STARTED', 'COMMAND_COMPLETED', 'BUILD_COMPLETED', 'TEST_COMPLETED',
      'ARCHITECTURE_CHECK_COMPLETED', 'FINAL_RESPONSE_CAPTURED', 'AGENT_COMPLETED',
      'AGENT_FAILED', 'SESSION_COMPLETED'
    )),
  CONSTRAINT `chk_trace_events_outcome`
    CHECK (`outcome` IN ('RECORDED', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT `chk_trace_events_hash`
    CHECK (`event_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_trace_events_previous_hash`
    CHECK (`previous_event_hash` IS NULL OR `previous_event_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_trace_events_file_hash_before`
    CHECK (`file_hash_before` IS NULL OR `file_hash_before` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_trace_events_file_hash_after`
    CHECK (`file_hash_after` IS NULL OR `file_hash_after` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_trace_events_output_hash`
    CHECK (`output_hash` IS NULL OR `output_hash` REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_claims (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `execution_session_id` BIGINT UNSIGNED NOT NULL,
  `claim_index` INT UNSIGNED NOT NULL,
  `claim_text` TEXT NOT NULL,
  `claim_type` VARCHAR(64) NOT NULL,
  `target` TEXT NOT NULL,
  `expected_result` TEXT NOT NULL,
  `verdict` VARCHAR(32) NULL,
  `verdict_reason_code` VARCHAR(64) NULL,
  `verdict_explanation` TEXT NULL,
  `evidence_event_ids` JSON NOT NULL,
  `extractor_model` VARCHAR(255) NOT NULL,
  `extraction_prompt_version` VARCHAR(64) NOT NULL,
  `verification_rule_version` VARCHAR(64) NOT NULL,
  `verified_at` DATETIME(6) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_claims_position` (`execution_session_id`, `claim_index`),
  KEY `idx_agent_claims_verdict` (`execution_session_id`, `verdict`),
  KEY `idx_agent_claims_type` (`claim_type`),
  CONSTRAINT `fk_agent_claims_execution_session`
    FOREIGN KEY (`execution_session_id`) REFERENCES `execution_sessions` (`id`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_agent_claims_index`
    CHECK (`claim_index` > 0),
  CONSTRAINT `chk_agent_claims_type`
    CHECK (`claim_type` IN (
      'FILE_CREATED', 'FILE_MODIFIED', 'STRUCTURE_CREATED', 'DEPENDENCY_RULE',
      'COMMAND_SUCCEEDED', 'BUILD_PASSED', 'TEST_PASSED', 'TASK_COMPLETED'
    )),
  CONSTRAINT `chk_agent_claims_verdict`
    CHECK (`verdict` IS NULL OR `verdict` IN ('VERIFIED', 'CONTRADICTED', 'UNSUPPORTED', 'UNVERIFIABLE')),
  CONSTRAINT `chk_agent_claims_reason_code`
    CHECK (`verdict_reason_code` IS NULL OR `verdict_reason_code` IN (
      'REQUIRED_EVIDENCE_CONFIRMED', 'CONTRADICTORY_EVIDENCE_FOUND',
      'MATCHING_EVIDENCE_NOT_FOUND', 'OBJECTIVE_RULE_NOT_DEFINED', 'EVIDENCE_IS_STALE',
      'EVIDENCE_IS_INVALID', 'AGGREGATE_REQUIREMENTS_NOT_MET'
    )),
  CONSTRAINT `chk_agent_claims_decision_completeness`
    CHECK (
      (`verdict` IS NULL AND `verdict_reason_code` IS NULL AND `verified_at` IS NULL)
      OR
      (`verdict` IS NOT NULL AND `verdict_reason_code` IS NOT NULL AND `verified_at` IS NOT NULL)
    ),
  CONSTRAINT `chk_agent_claims_evidence_array`
    CHECK (JSON_TYPE(`evidence_event_ids`) = 'ARRAY')
) ENGINE=InnoDB;
