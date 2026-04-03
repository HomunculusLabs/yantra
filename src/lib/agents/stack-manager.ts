import fs from "fs/promises";
import path from "path";
import { getCabinetRoots } from "@/lib/config/cabinet-roots";
import { readPersona } from "@/lib/agents/persona-manager";

export type AgentStackConfig = {
  vaultRoot?: string;
  agentName?: string;
  agentKey?: string;
  modeTag?: string;
  tagline?: string;
  asciiLogo?: string[];
  role?: { label?: string; value?: string };
  mission?: { label?: string; value?: string };
  workspace?: { label?: string; value?: string };
  paths?: {
    primary?: string;
    secondary?: string;
    tertiary?: string;
  };
  contextFiles?: string[];
  skills?: string[];
  skillsets?: string[];
  workflows?: Array<{ command: string; description: string }>;
  notes?: string[];
  commands?: Array<{ name: string; description: string; prompt: string }>;
  extraExtensions?: string[];
  [key: string]: unknown;
};

export type StackCatalogEntry = {
  label: string;
  path: string;
  source: string;
};

export type StackCatalog = {
  extensions: StackCatalogEntry[];
  skills: StackCatalogEntry[];
  skillsets: StackCatalogEntry[];
};

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function normalizeVaultRelativePath(
  input: unknown,
  vaultRoot = getCabinetRoots().vaultRoot
): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withoutDot = trimmed.replace(/^\.\//, "");
  if (path.isAbsolute(withoutDot)) {
    const resolved = path.resolve(withoutDot);
    const normalizedVaultRoot = path.resolve(vaultRoot);
    if (
      resolved !== normalizedVaultRoot &&
      !resolved.startsWith(`${normalizedVaultRoot}${path.sep}`)
    ) {
      return null;
    }
    return toPosix(path.relative(normalizedVaultRoot, resolved));
  }

  return withoutDot.split(path.sep).join("/");
}

function sanitizePathArray(values: unknown, prefixDot = false): string[] {
  if (!Array.isArray(values)) return [];
  const next = new Set<string>();
  for (const value of values) {
    const normalized = normalizeVaultRelativePath(value);
    if (!normalized) continue;
    next.add(prefixDot ? `./${normalized}` : normalized);
  }
  return Array.from(next);
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(
  rootRelative: string,
  matcher: (name: string) => boolean,
  formatter?: (relativeFromRoot: string, absolutePath: string) => StackCatalogEntry
): Promise<StackCatalogEntry[]> {
  const { vaultRoot } = getCabinetRoots();
  const rootAbsolute = path.join(vaultRoot, rootRelative);
  if (!(await exists(rootAbsolute))) return [];

  const found: StackCatalogEntry[] = [];

  async function walk(absDir: string) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".obsidian") continue;
      const absolutePath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!matcher(entry.name)) continue;
      const relativeFromRoot = toPosix(path.relative(rootAbsolute, absolutePath));
      found.push(
        formatter
          ? formatter(relativeFromRoot, absolutePath)
          : {
              label: relativeFromRoot.replace(/\/index\.[^.]+$/, ""),
              path: toPosix(path.relative(vaultRoot, absolutePath)),
              source: rootRelative,
            }
      );
    }
  }

  await walk(rootAbsolute);
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

export async function listAgentStackCatalog(): Promise<StackCatalog> {
  const { vaultRoot } = getCabinetRoots();

  const extensions = [
    ...(await walkFiles(
      "60-69 Agents/64 - Extensions/64.30 - Runtime Files",
      (name) => /^index\.(ts|js|mjs|cjs)$/.test(name),
      (relativeFromRoot, absolutePath) => {
        const vaultRelative = toPosix(path.relative(vaultRoot, absolutePath));
        const folderLabel =
          toPosix(path.dirname(relativeFromRoot)).replace(/\/$/, "") || relativeFromRoot;
        return {
          label: folderLabel,
          path: `./${vaultRelative}`,
          source: "64.30 - Runtime Files",
        };
      }
    )),
    ...(await walkFiles(
      ".pi/extensions",
      (name) => /^index\.(ts|js|mjs|cjs)$/.test(name),
      (relativeFromRoot, absolutePath) => {
        const vaultRelative = toPosix(path.relative(vaultRoot, absolutePath));
        const folderLabel =
          toPosix(path.dirname(relativeFromRoot)).replace(/\/$/, "") || relativeFromRoot;
        return {
          label: folderLabel,
          path: `./${vaultRelative}`,
          source: ".pi/extensions",
        };
      }
    )),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const skills = [
    ...(await walkFiles(
      ".pi/skills",
      (name) => name === "SKILL.md",
      (relativeFromRoot, absolutePath) => {
        const vaultRelative = toPosix(path.relative(vaultRoot, absolutePath));
        const label = toPosix(path.dirname(relativeFromRoot));
        return {
          label,
          path: vaultRelative,
          source: ".pi/skills",
        };
      }
    )),
    ...(await walkFiles(
      "60-69 Agents/62 - Skills/62.30 - Live Skills",
      (name) => name.toLowerCase().endsWith(".md"),
      (relativeFromRoot, absolutePath) => ({
        label: relativeFromRoot.replace(/\.md$/i, ""),
        path: toPosix(path.relative(vaultRoot, absolutePath)),
        source: "62.30 - Live Skills",
      })
    )),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const skillsets = await walkFiles(
    "60-69 Agents/62 - Skills/62.40 - Skillsets",
    (name) => name.toLowerCase().endsWith(".md"),
    (relativeFromRoot, absolutePath) => ({
      label: relativeFromRoot.replace(/\.md$/i, ""),
      path: toPosix(path.relative(vaultRoot, absolutePath)),
      source: "62.40 - Skillsets",
    })
  );

  return { extensions, skills, skillsets };
}

export async function readAgentStack(slug: string): Promise<{
  stackPath: string | null;
  stack: AgentStackConfig | null;
}> {
  const persona = await readPersona(slug);
  if (!persona) {
    return { stackPath: null, stack: null };
  }

  const stackPath = normalizeVaultRelativePath(persona.launcher?.vars?.stackFile);
  if (!stackPath) {
    return { stackPath: null, stack: null };
  }

  const { vaultRoot } = getCabinetRoots();
  const absolutePath = path.join(vaultRoot, stackPath);
  if (!(await exists(absolutePath))) {
    return { stackPath, stack: null };
  }

  const raw = await fs.readFile(absolutePath, "utf-8");
  return {
    stackPath,
    stack: JSON.parse(raw) as AgentStackConfig,
  };
}

export async function writeAgentStack(
  slug: string,
  updates: Partial<AgentStackConfig>
): Promise<{ stackPath: string; stack: AgentStackConfig }> {
  const current = await readAgentStack(slug);
  if (!current.stackPath || !current.stack) {
    throw new Error(`Stack not found for agent: ${slug}`);
  }

  const next: AgentStackConfig = {
    ...current.stack,
    ...updates,
    vaultRoot: getCabinetRoots().vaultRoot,
    paths: {
      ...(current.stack.paths || {}),
      ...(updates.paths || {}),
    },
    contextFiles:
      updates.contextFiles !== undefined
        ? sanitizePathArray(updates.contextFiles, false)
        : current.stack.contextFiles || [],
    skills:
      updates.skills !== undefined
        ? sanitizePathArray(updates.skills, false)
        : current.stack.skills || [],
    skillsets:
      updates.skillsets !== undefined
        ? sanitizePathArray(updates.skillsets, false)
        : current.stack.skillsets || [],
    extraExtensions:
      updates.extraExtensions !== undefined
        ? sanitizePathArray(updates.extraExtensions, true)
        : current.stack.extraExtensions || [],
  };

  next.paths = {
    primary: normalizeVaultRelativePath(next.paths?.primary) || "",
    secondary: normalizeVaultRelativePath(next.paths?.secondary) || "",
    tertiary: normalizeVaultRelativePath(next.paths?.tertiary) || "",
  };

  const { vaultRoot } = getCabinetRoots();
  const absolutePath = path.join(vaultRoot, current.stackPath);
  await fs.writeFile(absolutePath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");

  return {
    stackPath: current.stackPath,
    stack: next,
  };
}
