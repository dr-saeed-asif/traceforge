SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS tool_invocations;
DROP TABLE IF EXISTS test_executions;
DROP TABLE IF EXISTS command_executions;
DROP TABLE IF EXISTS file_changes;
DROP TABLE IF EXISTS prompt_projection_state;
DROP TABLE IF EXISTS opencode_activities;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS ingress_receipts;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS artifact_manifest_entries;
DROP TABLE IF EXISTS prompts;
DROP TABLE IF EXISTS model_invocations;
DROP TABLE IF EXISTS run_git_commits;
DROP TABLE IF EXISTS integration_run_contexts;
DROP TABLE IF EXISTS anchor_receipts;
DROP TABLE IF EXISTS integrity_records;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS encrypted_artifact_blobs;
DROP TABLE IF EXISTS provenance_events;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS artifact_manifests;
DROP TABLE IF EXISTS git_commits;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS prompt_results;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS prompt_results (
  `PromptQuery` LONGTEXT NOT NULL,
  `AgentName` VARCHAR(255) NOT NULL,
  `ModelName` VARCHAR(255) NOT NULL,
  `Result` LONGTEXT NOT NULL,
  `Resources` JSON NOT NULL
) ENGINE=InnoDB;
