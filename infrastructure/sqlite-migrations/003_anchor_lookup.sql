CREATE TABLE anchor_session_lookup (
  session_id INTEGER PRIMARY KEY REFERENCES execution_sessions(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE
);
CREATE TABLE anchor_claim_lookup (
  session_id INTEGER NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  claim_index INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE,
  PRIMARY KEY (session_id, claim_index)
);
CREATE TABLE anchor_lookup_dirty (
  session_id INTEGER PRIMARY KEY REFERENCES execution_sessions(id) ON DELETE CASCADE
);
INSERT INTO anchor_lookup_dirty SELECT id FROM execution_sessions;
CREATE TRIGGER anchor_lookup_session_insert AFTER INSERT ON execution_sessions BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (NEW.id);
END;
CREATE TRIGGER anchor_lookup_session_update AFTER UPDATE ON execution_sessions BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (NEW.id);
END;
CREATE TRIGGER anchor_lookup_claim_insert AFTER INSERT ON agent_claims BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (NEW.execution_session_id);
END;
CREATE TRIGGER anchor_lookup_claim_update AFTER UPDATE ON agent_claims BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (NEW.execution_session_id);
END;
CREATE TRIGGER anchor_lookup_claim_delete AFTER DELETE ON agent_claims BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (OLD.execution_session_id);
END;
CREATE TRIGGER anchor_lookup_event_insert AFTER INSERT ON trace_events BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (NEW.execution_session_id);
END;
