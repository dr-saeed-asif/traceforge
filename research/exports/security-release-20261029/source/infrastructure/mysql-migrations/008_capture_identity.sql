-- Existing rows retain unknown identity; never infer project ownership from relative paths.
SET @exists_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_results' AND COLUMN_NAME = 'PromptId');
SET @ddl = IF(@exists_column = 0, 'ALTER TABLE prompt_results ADD COLUMN `PromptId` VARCHAR(128) NULL', 'SELECT 1');
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @exists_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_results' AND COLUMN_NAME = 'SessionId');
SET @ddl = IF(@exists_column = 0, 'ALTER TABLE prompt_results ADD COLUMN `SessionId` VARCHAR(255) NULL', 'SELECT 1');
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @exists_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_results' AND COLUMN_NAME = 'RunId');
SET @ddl = IF(@exists_column = 0, 'ALTER TABLE prompt_results ADD COLUMN `RunId` VARCHAR(255) NULL', 'SELECT 1');
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @exists_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_results' AND COLUMN_NAME = 'ProjectName');
SET @ddl = IF(@exists_column = 0, 'ALTER TABLE prompt_results ADD COLUMN `ProjectName` VARCHAR(255) NULL', 'SELECT 1');
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @exists_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_results' AND COLUMN_NAME = 'ProjectPath');
SET @ddl = IF(@exists_column = 0, 'ALTER TABLE prompt_results ADD COLUMN `ProjectPath` TEXT NULL', 'SELECT 1');
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @exists_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_results' AND COLUMN_NAME = 'Status');
SET @ddl = IF(@exists_column = 0, 'ALTER TABLE prompt_results ADD COLUMN `Status` VARCHAR(32) NOT NULL DEFAULT ''UNKNOWN''', 'SELECT 1');
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @exists_index = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_results' AND INDEX_NAME = 'uq_prompt_results_prompt_id');
SET @ddl = IF(@exists_index = 0, 'CREATE UNIQUE INDEX uq_prompt_results_prompt_id ON prompt_results (PromptId)', 'SELECT 1');
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;
