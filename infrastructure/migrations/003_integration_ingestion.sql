CREATE TABLE integration_run_contexts (
  adapter text NOT NULL,
  external_session_id text NOT NULL,
  task_id text NOT NULL REFERENCES tasks(task_id),
  session_id text NOT NULL REFERENCES sessions(session_id),
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (adapter, external_session_id),
  UNIQUE (task_id), UNIQUE (session_id), UNIQUE (run_id)
);
CREATE INDEX integration_run_contexts_run_id_idx ON integration_run_contexts(run_id);
