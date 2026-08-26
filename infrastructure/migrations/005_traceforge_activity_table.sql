CREATE TABLE _traceforge (
  activity_id text PRIMARY KEY,
  event_id text NOT NULL UNIQUE REFERENCES provenance_events(event_id),
  task_id text NOT NULL REFERENCES tasks(task_id),
  session_id text NOT NULL REFERENCES sessions(session_id),
  run_id text NOT NULL REFERENCES agent_runs(run_id),
  sequence bigint NOT NULL,
  activity_type text NOT NULL,
  actor_name text NOT NULL,
  provider text,
  model text,
  summary text NOT NULL,
  payload_redacted jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (run_id, sequence)
);
CREATE INDEX traceforge_latest_activity_idx ON _traceforge(recorded_at DESC, activity_id DESC);
CREATE FUNCTION mirror_traceforge_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _traceforge(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
  VALUES(NEW.activity_id,NEW.event_id,NEW.task_id,NEW.session_id,NEW.run_id,NEW.sequence,NEW.activity_type,NEW.actor_name,NEW.provider,NEW.model,NEW.summary,NEW.payload_redacted,NEW.occurred_at,NEW.recorded_at)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER opencode_activities_mirror_traceforge AFTER INSERT ON opencode_activities FOR EACH ROW EXECUTE FUNCTION mirror_traceforge_activity();
INSERT INTO _traceforge SELECT * FROM opencode_activities ON CONFLICT (event_id) DO NOTHING;
COMMENT ON TABLE _traceforge IS 'Live read-optimized OpenCode activity feed requested for TraceForge.';
