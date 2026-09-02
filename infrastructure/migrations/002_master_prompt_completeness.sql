CREATE TABLE projects (
  project_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(1000) NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 1000),
  repository TEXT,
  created_at DATETIME(6) NOT NULL,
  created_by VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE tasks ADD COLUMN project_id VARCHAR(255) REFERENCES projects(project_id);
CREATE INDEX tasks_project_id_idx ON tasks(project_id);

CREATE TABLE agents (
  agent_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  adapter_name VARCHAR(255) NOT NULL,
  version VARCHAR(255),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE test_executions (
  test_execution_id VARCHAR(255) PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  started_event_id VARCHAR(255) REFERENCES provenance_events(event_id),
  completed_event_id VARCHAR(255) REFERENCES provenance_events(event_id),
  command_redacted TEXT NOT NULL,
  framework VARCHAR(255),
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6),
  passed INT CHECK (passed >= 0),
  failed INT CHECK (failed >= 0),
  skipped INT CHECK (skipped >= 0),
  exit_code INT,
  output_reference TEXT,
  CHECK (completed_at IS NULL OR completed_at >= started_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX test_executions_run_id_idx ON test_executions(run_id);
