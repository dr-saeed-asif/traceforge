CREATE TABLE public.opencode_activities (
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

CREATE INDEX public_opencode_activities_latest_idx
ON public.opencode_activities(recorded_at DESC, activity_id DESC);

CREATE FUNCTION mirror_public_opencode_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.opencode_activities(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
  VALUES(NEW.activity_id,NEW.event_id,NEW.task_id,NEW.session_id,NEW.run_id,NEW.sequence,NEW.activity_type,NEW.actor_name,NEW.provider,NEW.model,NEW.summary,NEW.payload_redacted,NEW.occurred_at,NEW.recorded_at)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER opencode_activities_mirror_public
AFTER INSERT ON opencode_activities
FOR EACH ROW EXECUTE FUNCTION mirror_public_opencode_activity();

INSERT INTO public.opencode_activities
SELECT * FROM opencode_activities
ON CONFLICT (event_id) DO NOTHING;

COMMENT ON TABLE public.opencode_activities IS 'Public pgAdmin-visible mirror of live OpenCode activities.';
