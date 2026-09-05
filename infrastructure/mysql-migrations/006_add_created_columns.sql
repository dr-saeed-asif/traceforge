SET @created_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'prompt_results'
    AND COLUMN_NAME = 'created_at'
);

SET @created_by_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'prompt_results'
    AND COLUMN_NAME = 'created_by'
);

SET @add_columns = IF(
  @created_at_exists = 0 OR @created_by_exists = 0,
  IF(
    @created_at_exists = 0,
    IF(
      @created_by_exists = 0,
      'ALTER TABLE prompt_results ADD COLUMN `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN `created_by` VARCHAR(255) NOT NULL DEFAULT "NOT_AVAILABLE"',
      'ALTER TABLE prompt_results ADD COLUMN `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
    ),
    'SELECT 1'
  ),
  'SELECT 1'
);

PREPARE add_columns_statement FROM @add_columns;
EXECUTE add_columns_statement;
DEALLOCATE PREPARE add_columns_statement;

UPDATE prompt_results
SET `created_by` = "NOT_AVAILABLE"
WHERE `created_by` IS NULL;