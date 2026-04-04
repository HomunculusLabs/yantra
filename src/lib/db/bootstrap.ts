import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { getYantraAppPaths } from "@/lib/config/app-paths";

export function configureDatabasePragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

export function runPendingMigrations(db: Database.Database): void {
  const migrationsDir = getYantraAppPaths().migrationsDir;
  const hasVersionTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get();

  let currentVersion = 0;
  if (hasVersionTable) {
    const row = db
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version: number | null } | undefined;
    currentVersion = row?.version ?? 0;
  }

  if (!fs.existsSync(migrationsDir)) {
    console.warn(`Migrations directory not found: ${migrationsDir}`);
    return;
  }

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    const versionMatch = fileName.match(/^(\d+)/);
    if (!versionMatch) continue;

    const version = parseInt(versionMatch[1], 10);
    if (version <= currentVersion) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf-8");
    console.log(`Running migration ${fileName}...`);
    db.exec(sql);
    console.log(`Migration ${fileName} applied.`);
  }
}
