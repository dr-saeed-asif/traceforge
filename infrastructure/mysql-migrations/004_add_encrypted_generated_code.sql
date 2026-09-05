SET @encrypted_generated_code_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'prompt_results'
    AND COLUMN_NAME = 'EncryptedGeneratedCode'
);

SET @add_encrypted_generated_code = IF(
  @encrypted_generated_code_exists = 0,
  'ALTER TABLE prompt_results ADD COLUMN `EncryptedGeneratedCode` JSON NULL',
  'SELECT 1'
);

PREPARE add_encrypted_generated_code_statement FROM @add_encrypted_generated_code;
EXECUTE add_encrypted_generated_code_statement;
DEALLOCATE PREPARE add_encrypted_generated_code_statement;

UPDATE prompt_results
SET `EncryptedGeneratedCode` = JSON_OBJECT()
WHERE `EncryptedGeneratedCode` IS NULL;

ALTER TABLE prompt_results
MODIFY COLUMN `EncryptedGeneratedCode` JSON NOT NULL;
