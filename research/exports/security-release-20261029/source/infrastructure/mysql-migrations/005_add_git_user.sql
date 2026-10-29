SET @git_user_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'prompt_results'
    AND COLUMN_NAME = 'GitUser'
);

SET @add_git_user = IF(
  @git_user_exists = 0,
  'ALTER TABLE prompt_results ADD COLUMN `GitUser` VARCHAR(255) NOT NULL DEFAULT "NOT_AVAILABLE"',
  'SELECT 1'
);

PREPARE add_git_user_statement FROM @add_git_user;
EXECUTE add_git_user_statement;
DEALLOCATE PREPARE add_git_user_statement;

UPDATE prompt_results
SET `GitUser` = "NOT_AVAILABLE"
WHERE `GitUser` IS NULL;