CREATE TABLE opencode_activities (
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

CREATE INDEX opencode_activities_latest_idx ON opencode_activities(recorded_at DESC, activity_id DESC);
CREATE INDEX opencode_activities_run_sequence_idx ON opencode_activities(run_id, sequence);

CREATE FUNCTION project_opencode_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source->>'adapter' = 'opencode' THEN
    INSERT INTO opencode_activities(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
    VALUES(
      NEW.event_id,NEW.event_id,NEW.task_id,NEW.session_id,NEW.run_id,NEW.sequence,NEW.event_type,
      COALESCE(NEW.actor->>'name',NEW.actor->>'type','system'),NEW.source->>'provider',
      COALESCE(NEW.payload->>'model',NEW.actor->>'name'),
      COALESCE(NEW.payload->>'responseText',NEW.payload->>'content',NEW.payload->>'command',NEW.payload->>'toolName',NEW.payload->>'relativePath',NEW.payload->>'status',NEW.event_type),
      NEW.payload,NEW.occurred_at,NEW.recorded_at
    ) ON CONFLICT (event_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER provenance_events_project_opencode_activity
AFTER INSERT ON provenance_events FOR EACH ROW EXECUTE FUNCTION project_opencode_activity();

INSERT INTO opencode_activities(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
SELECT event_id,event_id,task_id,session_id,run_id,sequence,event_type,
  COALESCE(actor->>'name',actor->>'type','system'),source->>'provider',COALESCE(payload->>'model',actor->>'name'),
  COALESCE(payload->>'responseText',payload->>'content',payload->>'command',payload->>'toolName',payload->>'relativePath',payload->>'status',event_type),
  payload,occurred_at,recorded_at
FROM provenance_events WHERE source->>'adapter'='opencode'
ON CONFLICT (event_id) DO NOTHING;

COMMENT ON TABLE opencode_activities IS 'Read-optimized, append-only projection of redacted OpenCode provenance events.';
