SET @file_paths_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'prompt_results'
    AND COLUMN_NAME = 'FilePaths'
);

SET @add_file_paths = IF(
  @file_paths_exists = 0,
  'ALTER TABLE prompt_results ADD COLUMN `FilePaths` JSON NULL',
  'SELECT 1'
);

PREPARE add_file_paths_statement FROM @add_file_paths;
EXECUTE add_file_paths_statement;
DEALLOCATE PREPARE add_file_paths_statement;

UPDATE prompt_results
SET `FilePaths` = JSON_ARRAY()
WHERE `FilePaths` IS NULL;

ALTER TABLE prompt_results
MODIFY COLUMN `FilePaths` JSON NOT NULL;
