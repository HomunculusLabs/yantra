import path from "path";
import {
  ensureDirectory,
  fileExists,
  listDirectory,
  readFileContent,
  writeFileContent,
} from "@/lib/storage/fs-operations";
import { getPersonaMemoryDir } from "./persona-paths";

export async function readMemory(slug: string, file: string): Promise<string> {
  const memoryDir = getPersonaMemoryDir(slug);
  await ensureDirectory(memoryDir);
  const filePath = path.join(memoryDir, file);
  if (!(await fileExists(filePath))) return "";
  return readFileContent(filePath);
}

export async function writeMemory(slug: string, file: string, content: string): Promise<void> {
  const memoryDir = getPersonaMemoryDir(slug);
  await ensureDirectory(memoryDir);
  await writeFileContent(path.join(memoryDir, file), content);
}

export async function listMemoryFiles(slug: string): Promise<string[]> {
  const memoryDir = getPersonaMemoryDir(slug);
  await ensureDirectory(memoryDir);
  const entries = await listDirectory(memoryDir);
  return entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name);
}
