CREATE TABLE opencode_activities (
  activity_id VARCHAR(255) PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL UNIQUE REFERENCES provenance_events(event_id),
  task_id VARCHAR(255) NOT NULL REFERENCES tasks(task_id),
  session_id VARCHAR(255) NOT NULL REFERENCES sessions(session_id),
  run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id),
  sequence BIGINT NOT NULL,
  activity_type VARCHAR(64) NOT NULL,
  actor_name VARCHAR(255) NOT NULL,
  provider VARCHAR(255),
  model VARCHAR(255),
  summary TEXT NOT NULL,
  payload_redacted JSON NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  recorded_at DATETIME(6) NOT NULL,
  UNIQUE (run_id, sequence)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX opencode_activities_latest_idx ON opencode_activities(recorded_at DESC, activity_id DESC);
CREATE INDEX opencode_activities_run_sequence_idx ON opencode_activities(run_id, sequence);

CREATE TRIGGER provenance_events_project_opencode_activity
AFTER INSERT ON provenance_events FOR EACH ROW
INSERT INTO opencode_activities(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
SELECT NEW.event_id,NEW.event_id,NEW.task_id,NEW.session_id,NEW.run_id,NEW.sequence,NEW.event_type,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.actor,'$.name')),JSON_UNQUOTE(JSON_EXTRACT(NEW.actor,'$.type')),'system'),
  JSON_UNQUOTE(JSON_EXTRACT(NEW.source,'$.provider')),
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.model')),JSON_UNQUOTE(JSON_EXTRACT(NEW.actor,'$.name'))),
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.responseText')),JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.content')),JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.command')),JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.toolName')),JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.relativePath')),JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.status')),NEW.event_type),
  NEW.payload,NEW.occurred_at,NEW.recorded_at
WHERE JSON_UNQUOTE(JSON_EXTRACT(NEW.source,'$.adapter')) = 'opencode'
ON DUPLICATE KEY UPDATE event_id=VALUES(event_id);

INSERT INTO opencode_activities(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
SELECT event_id,event_id,task_id,session_id,run_id,sequence,event_type,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(actor,'$.name')),JSON_UNQUOTE(JSON_EXTRACT(actor,'$.type')),'system'),
  JSON_UNQUOTE(JSON_EXTRACT(source,'$.provider')),COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.model')),JSON_UNQUOTE(JSON_EXTRACT(actor,'$.name'))),
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.responseText')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.content')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.command')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.toolName')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.relativePath')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.status')),event_type),
  payload,occurred_at,recorded_at
FROM provenance_events WHERE JSON_UNQUOTE(JSON_EXTRACT(source,'$.adapter'))='opencode'
ON DUPLICATE KEY UPDATE event_id=VALUES(event_id);

ALTER TABLE opencode_activities COMMENT = 'Read-optimized, append-only projection of redacted OpenCode provenance events.';
