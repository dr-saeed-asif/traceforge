ALTER TABLE anchor_claim_lookup ADD COLUMN legacy_manifest_hash TEXT;
CREATE INDEX anchor_claim_lookup_legacy_hash ON anchor_claim_lookup(legacy_manifest_hash);
-- Rebuild cached schema-1 entries and populate both commitment versions.
INSERT OR IGNORE INTO anchor_lookup_dirty SELECT id FROM execution_sessions;
CREATE TRIGGER anchor_lookup_event_update AFTER UPDATE ON trace_events BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (NEW.execution_session_id);
END;
CREATE TRIGGER anchor_lookup_event_delete AFTER DELETE ON trace_events BEGIN
  INSERT OR IGNORE INTO anchor_lookup_dirty VALUES (OLD.execution_session_id);
END;
