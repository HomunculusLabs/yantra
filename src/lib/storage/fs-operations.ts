import fs from "fs/promises";
import { ensureVaultRootExists } from "@/lib/config/cabinet-roots";

export async function readFileContent(absPath: string): Promise<string> {
  return fs.readFile(absPath, "utf-8");
}

export async function writeFileContent(
  absPath: string,
  content: string
): Promise<void> {
  await fs.writeFile(absPath, content, "utf-8");
}

export async function deleteFileOrDir(absPath: string): Promise<void> {
  await fs.rm(absPath, { recursive: true, force: true });
}

export async function listDirectory(
  absPath: string
): Promise<{ name: string; isDirectory: boolean }[]> {
  try {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "EACCES" || code === "EPERM" || code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function ensureDirectory(absPath: string): Promise<void> {
  await fs.mkdir(absPath, { recursive: true });
}

export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDataDir(): Promise<void> {
  ensureVaultRootExists();
}
