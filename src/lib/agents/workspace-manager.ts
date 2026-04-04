import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import {
  getYantraRoots,
  resolveVaultPath,
} from "@/lib/config/yantra-roots";
import {
  fileExists,
  listDirectory,
  readFileContent,
} from "@/lib/storage/fs-operations";
import { virtualPathFromFs } from "@/lib/storage/path-utils";
import type { AgentPersona } from "@/types/personas";

export interface WorkspaceFileSummary {
  path: string;
  name: string;
  modified: string;
}

export interface GalleryItem {
  name: string;
  type: "app" | "report" | "data" | "code" | "file";
  agent: string;
  agentEmoji: string;
  agentSlug: string;
  department: string;
  path: string;
  modified: string;
  size?: number;
  preview?: string;
}

const DATA_EXTENSIONS = new Set([".csv", ".json", ".yaml", ".yml"]);
const CODE_EXTENSIONS = new Set([".py", ".js", ".ts", ".sh"]);

function formatDisplayName(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function isObjectWithOutputDir(
  persona: AgentPersona
): persona is AgentPersona & { output_dir?: string } {
  return "output_dir" in persona;
}

function getPersonaOutputDir(persona: AgentPersona): string | null {
  if (!isObjectWithOutputDir(persona)) return null;
  return typeof persona.output_dir === "string" && persona.output_dir.trim()
    ? persona.output_dir
    : null;
}

function resolveOutputDir(outputDir: string): string | null {
  const normalized = outputDir.replace(/^\/data\//, "");
  try {
    return resolveVaultPath(normalized);
  } catch {
    return null;
  }
}

async function safeStat(target: string) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function readMarkdownMeta(
  fullPath: string,
  fallbackName: string
): Promise<{ name: string; preview?: string }> {
  try {
    const raw = await readFileContent(fullPath);
    const { data, content } = matter(raw);
    const preview = content
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
      .slice(0, 2)
      .join(" ")
      .slice(0, 120);

    return {
      name:
        typeof data.title === "string" && data.title.trim()
          ? data.title
          : fallbackName,
      ...(preview ? { preview } : {}),
    };
  } catch {
    return { name: fallbackName };
  }
}

async function walkFiles(dir: string): Promise<WorkspaceFileSummary[]> {
  const entries = await listDirectory(dir);
  const results: WorkspaceFileSummary[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === ".gitkeep") continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory) {
      results.push(...(await walkFiles(fullPath)));
      continue;
    }

    const stat = await safeStat(fullPath);
    if (!stat) continue;

    results.push({
      path: virtualPathFromFs(fullPath),
      name: entry.name,
      modified: stat.mtime.toISOString(),
    });
  }

  return results;
}

async function scanGalleryWorkspace(
  dir: string,
  persona: AgentPersona
): Promise<GalleryItem[]> {
  const entries = await listDirectory(dir);
  const items: GalleryItem[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === ".gitkeep") continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory) {
      const [hasHtml, hasApp, hasIndexMd] = await Promise.all([
        fileExists(path.join(fullPath, "index.html")),
        fileExists(path.join(fullPath, ".app")),
        fileExists(path.join(fullPath, "index.md")),
      ]);

      if (hasHtml) {
        const stat = await safeStat(fullPath);
        if (!stat) continue;

        items.push({
          name: formatDisplayName(entry.name),
          type: "app",
          agent: persona.name,
          agentEmoji: persona.emoji || "",
          agentSlug: persona.slug,
          department: persona.department || "general",
          path: virtualPathFromFs(fullPath),
          modified: stat.mtime.toISOString(),
          preview: hasApp ? "Full-screen interactive app" : "Embedded web app",
        });
        continue;
      }

      if (hasIndexMd) {
        const reportPath = path.join(fullPath, "index.md");
        const stat = await safeStat(reportPath);
        if (!stat) continue;

        const meta = await readMarkdownMeta(reportPath, formatDisplayName(entry.name));
        items.push({
          name: meta.name,
          type: "report",
          agent: persona.name,
          agentEmoji: persona.emoji || "",
          agentSlug: persona.slug,
          department: persona.department || "general",
          path: virtualPathFromFs(fullPath),
          modified: stat.mtime.toISOString(),
          preview: meta.preview || "Report",
        });
        continue;
      }

      items.push(...(await scanGalleryWorkspace(fullPath, persona)));
      continue;
    }

    const stat = await safeStat(fullPath);
    if (!stat || stat.size < 10) continue;

    const ext = path.extname(entry.name).toLowerCase();
    let type: GalleryItem["type"] = "file";
    if (ext === ".md") type = "report";
    else if (DATA_EXTENSIONS.has(ext)) type = "data";
    else if (CODE_EXTENSIONS.has(ext)) type = "code";
    else if (ext === ".html") type = "app";

    let name = entry.name;
    let preview: string | undefined;
    if (type === "report" && ext === ".md") {
      const meta = await readMarkdownMeta(fullPath, entry.name);
      name = meta.name;
      preview = meta.preview;
    }

    items.push({
      name,
      type,
      agent: persona.name,
      agentEmoji: persona.emoji || "",
      agentSlug: persona.slug,
      department: persona.department || "general",
      path: virtualPathFromFs(fullPath),
      modified: stat.mtime.toISOString(),
      size: stat.size,
      ...(preview ? { preview } : {}),
    });
  }

  return items;
}

export async function listPersonaWorkspaceFiles(persona: AgentPersona): Promise<{
  files: WorkspaceFileSummary[];
  outputDir: string | null;
}> {
  const roots = getYantraRoots();
  const allFiles = new Map<string, WorkspaceFileSummary>();
  const workspaceDir = path.join(roots.runtimeAgentsRoot, persona.slug, "workspace");
  const outputDir = getPersonaOutputDir(persona);

  const addFiles = (files: WorkspaceFileSummary[]) => {
    for (const file of files) {
      const existing = allFiles.get(file.path);
      if (!existing || existing.modified < file.modified) {
        allFiles.set(file.path, file);
      }
    }
  };

  addFiles(await walkFiles(workspaceDir));

  if (outputDir) {
    const resolvedOutputDir = resolveOutputDir(outputDir);
    if (resolvedOutputDir) {
      addFiles(await walkFiles(resolvedOutputDir));
    }
  }

  const files = [...allFiles.values()].sort(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
  );

  return {
    files,
    outputDir,
  };
}

export async function listGalleryItemsForPersonas(
  personas: AgentPersona[]
): Promise<GalleryItem[]> {
  const { runtimeAgentsRoot } = getYantraRoots();
  const allItems: GalleryItem[] = [];

  for (const persona of personas) {
    if (persona.slug === "editor") continue;
    const workspaceDir = path.join(runtimeAgentsRoot, persona.slug, "workspace");
    allItems.push(...(await scanGalleryWorkspace(workspaceDir, persona)));
  }

  allItems.sort(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
  );

  return allItems;
}
