-- Phase 5 adds the access path used by the newest-first verification lists.
-- The conditional DDL keeps the migration safe because this project reruns
-- migration files idempotently during local and container startup.
SET @exists_index = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'execution_sessions'
    AND INDEX_NAME = 'idx_execution_sessions_started_at'
);
SET @ddl = IF(
  @exists_index = 0,
  'CREATE INDEX idx_execution_sessions_started_at ON execution_sessions (started_at, id)',
  'SELECT 1'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;
