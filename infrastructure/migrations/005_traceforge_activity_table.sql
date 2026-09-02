CREATE TABLE _traceforge (
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
CREATE INDEX traceforge_latest_activity_idx ON _traceforge(recorded_at DESC, activity_id DESC);

CREATE TRIGGER opencode_activities_mirror_traceforge
AFTER INSERT ON opencode_activities FOR EACH ROW
INSERT INTO _traceforge(activity_id,event_id,task_id,session_id,run_id,sequence,activity_type,actor_name,provider,model,summary,payload_redacted,occurred_at,recorded_at)
VALUES(NEW.activity_id,NEW.event_id,NEW.task_id,NEW.session_id,NEW.run_id,NEW.sequence,NEW.activity_type,NEW.actor_name,NEW.provider,NEW.model,NEW.summary,NEW.payload_redacted,NEW.occurred_at,NEW.recorded_at)
ON DUPLICATE KEY UPDATE event_id=VALUES(event_id);

INSERT INTO _traceforge
SELECT * FROM opencode_activities
ON DUPLICATE KEY UPDATE event_id=VALUES(event_id);
ALTER TABLE _traceforge COMMENT = 'Live read-optimized OpenCode activity feed requested for TraceForge.';
