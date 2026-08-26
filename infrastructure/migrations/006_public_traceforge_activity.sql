CREATE TABLE public._traceforge (
  activity_id text PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  task_id text NOT NULL,
  session_id text NOT NULL,
  run_id text NOT NULL,
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

CREATE INDEX public_traceforge_latest_activity_idx ON public._traceforge(recorded_at DESC, activity_id DESC);

CREATE FUNCTION mirror_public_traceforge_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public._traceforge(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
  VALUES(NEW.activity_id,NEW.event_id,NEW.task_id,NEW.session_id,NEW.run_id,NEW.sequence,NEW.activity_type,NEW.actor_name,NEW.provider,NEW.model,NEW.summary,NEW.payload_redacted,NEW.occurred_at,NEW.recorded_at)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER traceforge_mirror_public_activity
AFTER INSERT ON _traceforge FOR EACH ROW EXECUTE FUNCTION mirror_public_traceforge_activity();

INSERT INTO public._traceforge SELECT * FROM _traceforge ON CONFLICT (event_id) DO NOTHING;
COMMENT ON TABLE public._traceforge IS 'Public pgAdmin-visible mirror of the TraceForge live OpenCode activity feed.';
