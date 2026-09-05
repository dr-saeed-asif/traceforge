CREATE TABLE IF NOT EXISTS prompt_results (
  `PromptQuery` LONGTEXT NOT NULL,
  `AgentName` VARCHAR(255) NOT NULL,
  `ModelName` VARCHAR(255) NOT NULL,
  `Result` LONGTEXT NOT NULL,
  `Resources` JSON NOT NULL,
  `FilePaths` JSON NOT NULL,
  `GeneratedCode` JSON NOT NULL
) ENGINE=InnoDB;
