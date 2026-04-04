import Database from "better-sqlite3";
import { getYantraRoots, ensureRuntimeRootExists } from "@/lib/config/yantra-roots";
import { configureDatabasePragmas, runPendingMigrations } from "@/lib/db/bootstrap";

const DB_PATH = getYantraRoots().databasePath;

let _db: Database.Database | null = null;

/**
 * Get the singleton database connection for use in Next.js API routes.
 * Initializes the database and runs pending migrations on first call.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  ensureRuntimeRootExists();

  _db = new Database(DB_PATH);
  configureDatabasePragmas(_db);
  runPendingMigrations(_db);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
