import path from "path";
import matter from "gray-matter";
import {
  ensureDirectory,
  listDirectory,
  readFileContent,
  writeFileContent,
} from "@/lib/storage/fs-operations";
import { getPersonaInboxDir } from "./persona-paths";

export async function sendMessage(from: string, to: string, message: string): Promise<void> {
  const inboxDir = getPersonaInboxDir(to);
  await ensureDirectory(inboxDir);
  const timestamp = new Date().toISOString();
  const filename = `${timestamp.replace(/[:.]/g, "-")}_from_${from}.md`;
  const content = `---\nfrom: ${from}\nto: ${to}\ntimestamp: ${timestamp}\n---\n\n${message}\n`;
  await writeFileContent(path.join(inboxDir, filename), content);
}

export async function readInbox(slug: string): Promise<Array<{ from: string; timestamp: string; message: string; filename: string }>> {
  const inboxDir = getPersonaInboxDir(slug);
  await ensureDirectory(inboxDir);
  const entries = await listDirectory(inboxDir);
  const messages: Array<{ from: string; timestamp: string; message: string; filename: string }> = [];

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    const raw = await readFileContent(path.join(inboxDir, entry.name));
    const { data, content } = matter(raw);
    messages.push({
      from: (data.from as string) || "unknown",
      timestamp: (data.timestamp as string) || "",
      message: content.trim(),
      filename: entry.name,
    });
  }

  return messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function clearInbox(slug: string): Promise<void> {
  const inboxDir = getPersonaInboxDir(slug);
  const fs = await import("fs/promises");
  const entries = await listDirectory(inboxDir).catch(() => []);
  for (const entry of entries) {
    if (entry.name.endsWith(".md")) {
      await fs.unlink(path.join(inboxDir, entry.name)).catch(() => {});
    }
  }
}
