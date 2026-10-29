import { openSqliteDatabase } from "./infrastructure/sqlite/sqlite-database.js";
import { applySqliteMigrations } from "./infrastructure/sqlite/sqlite-migrator.js";

const databasePath = process.env.TRACEFORGE_DATABASE_PATH?.trim() || "./data/traceforge.sqlite";
const database = openSqliteDatabase(databasePath);
try {
  await applySqliteMigrations(database);
  process.stdout.write(`TraceForge SQLite database is ready at ${databasePath}\n`);
} finally {
  database.close();
}
