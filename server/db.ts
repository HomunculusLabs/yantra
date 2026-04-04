import Database from "better-sqlite3";
import { ensureRuntimeRootExists, getYantraRoots } from "../src/lib/config/yantra-roots";
import { configureDatabasePragmas, runPendingMigrations } from "../src/lib/db/bootstrap";

const DB_PATH = getYantraRoots().databasePath;

let _db: Database.Database | null = null;

/**
 * Get the singleton database connection.
 * Initializes the database and runs pending migrations on first call.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  ensureRuntimeRootExists();

  _db = new Database(DB_PATH);
  configureDatabasePragmas(_db);
  runPendingMigrations(_db);

  return _db;
}

/**
 * Close the database connection. Call on process shutdown.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
