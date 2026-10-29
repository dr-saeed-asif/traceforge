SET @generated_code_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'prompt_results'
    AND COLUMN_NAME = 'GeneratedCode'
);

SET @add_generated_code = IF(
  @generated_code_exists = 0,
  'ALTER TABLE prompt_results ADD COLUMN `GeneratedCode` JSON NULL',
  'SELECT 1'
);

PREPARE add_generated_code_statement FROM @add_generated_code;
EXECUTE add_generated_code_statement;
DEALLOCATE PREPARE add_generated_code_statement;

UPDATE prompt_results
SET `GeneratedCode` = JSON_ARRAY()
WHERE `GeneratedCode` IS NULL;

ALTER TABLE prompt_results
MODIFY COLUMN `GeneratedCode` JSON NOT NULL;
