CREATE TABLE integration_run_contexts (
  adapter VARCHAR(255) NOT NULL,
  external_session_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(255) NOT NULL REFERENCES tasks(task_id),
  session_id VARCHAR(255) NOT NULL REFERENCES sessions(session_id),
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (adapter, external_session_id),
  UNIQUE (task_id), UNIQUE (session_id), UNIQUE (run_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX integration_run_contexts_run_id_idx ON integration_run_contexts(run_id);
