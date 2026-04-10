import fs from "fs/promises";
import path from "path";
import { getYantraAppPaths } from "@/lib/config/app-paths";
import type { UpdateStatus } from "@/types/system";

const DEFAULT_STATUS: UpdateStatus = {
  state: "idle",
};

function getUpdateStatusPath(): string {
  return path.join(getYantraAppPaths().configRoot, "update-status.json");
}

export async function readUpdateStatus(): Promise<UpdateStatus> {
  try {
    const raw = await fs.readFile(getUpdateStatusPath(), "utf-8");
    return { ...DEFAULT_STATUS, ...(JSON.parse(raw) as UpdateStatus) };
  } catch {
    return DEFAULT_STATUS;
  }
}

export async function writeUpdateStatus(status: UpdateStatus): Promise<void> {
  const targetPath = getUpdateStatusPath();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(status, null, 2), "utf-8");
}
