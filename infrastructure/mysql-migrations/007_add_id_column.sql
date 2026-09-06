SET @id_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'prompt_results'
    AND COLUMN_NAME = 'id'
);

SET @add_id_column = IF(
  @id_column_exists = 0,
  'ALTER TABLE prompt_results ADD COLUMN `id` INT NOT NULL FIRST',
  'SELECT 1'
);

PREPARE add_id_column_statement FROM @add_id_column;
EXECUTE add_id_column_statement;
DEALLOCATE PREPARE add_id_column_statement;

UPDATE prompt_results
SET `id` = 0
WHERE `id` IS NULL;

ALTER TABLE prompt_results MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY;