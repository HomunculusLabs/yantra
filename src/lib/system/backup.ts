import fs from "fs/promises";
import path from "path";
import { getYantraAppPaths } from "@/lib/config/app-paths";
import { getYantraRoots } from "@/lib/config/yantra-roots";

function timestampToken(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function getBackupRoot(): string {
  return path.join(getYantraAppPaths().configRoot, "backups");
}

export async function createDataBackup(reason = "manual-backup"): Promise<string> {
  const { vaultRoot } = getYantraRoots();
  const destination = path.join(getBackupRoot(), `${timestampToken()}-${reason}`, "vault");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.cp(vaultRoot, destination, { recursive: true });
  return destination;
}
