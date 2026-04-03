import path from "path";
import matter from "gray-matter";
import type { PageData, FrontMatter } from "@/types";
import {
  fileTitleFromPath,
  resolveContentPath,
  sanitizeFilename,
  stripRuntimePrefix,
  isRuntimeVirtualPath,
} from "./path-utils";
import {
  readFileContent,
  writeFileContent,
  ensureDirectory,
  fileExists,
  deleteFileOrDir,
} from "./fs-operations";

function defaultFrontmatter(title: string): FrontMatter {
  const now = new Date().toISOString();
  return { title, created: now, modified: now, tags: [] };
}

function canonicalPagePath(virtualPath: string, kind: PageData["kind"]): string {
  if (kind === "directory-index") return virtualPath;
  if (virtualPath.endsWith(".md")) return virtualPath;
  if (kind === "markdown") return `${virtualPath}.md`;
  return virtualPath;
}

function pageTitleForPath(virtualPath: string): string {
  return fileTitleFromPath(
    isRuntimeVirtualPath(virtualPath) ? stripRuntimePrefix(virtualPath) : virtualPath
  );
}

type ResolvedPageTarget = {
  filePath: string;
  kind: PageData["kind"];
};

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [
    ".json",
    ".yaml",
    ".yml",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".sh",
    ".bash",
    ".zsh",
    ".py",
    ".txt",
    ".mdx",
    ".css",
    ".scss",
    ".html",
    ".xml",
    ".toml",
    ".ini",
    ".env",
    ".sql",
  ].includes(ext) || path.extname(filePath) === "";
}

async function resolvePageTarget(virtualPath: string): Promise<ResolvedPageTarget> {
  const resolved = resolveContentPath(virtualPath);
  const exactExists = await fileExists(resolved);

  if (exactExists) {
    const stat = await (await import("fs/promises")).stat(resolved);
    if (stat.isDirectory()) {
      const indexPath = path.join(resolved, "index.md");
      if (await fileExists(indexPath)) {
        return { filePath: indexPath, kind: "directory-index" };
      }
      throw new Error(`Page not found: ${virtualPath}`);
    }

    if (resolved.toLowerCase().endsWith(".md")) {
      return { filePath: resolved, kind: "markdown" };
    }
    if (resolved.toLowerCase().endsWith(".pdf")) {
      return { filePath: resolved, kind: "pdf" };
    }
    if (resolved.toLowerCase().endsWith(".csv")) {
      return { filePath: resolved, kind: "csv" };
    }
    if (isTextFile(resolved)) {
      return { filePath: resolved, kind: "text" };
    }
  }

  if (!path.extname(virtualPath)) {
    const legacyMdPath = `${resolved}.md`;
    if (await fileExists(legacyMdPath)) {
      return { filePath: legacyMdPath, kind: "markdown" };
    }
  }

  throw new Error(`Page not found: ${virtualPath}`);
}

export async function readPage(virtualPath: string): Promise<PageData> {
  const target = await resolvePageTarget(virtualPath);
  const filePath = target.filePath;

  const raw = await readFileContent(filePath);
  if (target.kind === "markdown" || target.kind === "directory-index") {
    const { data, content } = matter(raw);

    return {
      path: canonicalPagePath(virtualPath, target.kind),
      requestedPath: virtualPath,
      backingPath: filePath,
      kind: target.kind,
      editable: true,
      content: content.trim(),
      frontmatter: {
        title: data.title || pageTitleForPath(virtualPath),
        created: data.created || new Date().toISOString(),
        modified: data.modified || new Date().toISOString(),
        tags: data.tags || [],
        icon: data.icon,
        order: data.order,
      },
    };
  }

  return {
    path: virtualPath,
    requestedPath: virtualPath,
    backingPath: filePath,
    kind: target.kind,
    editable: target.kind === "text",
    content: raw,
    frontmatter: {
      title: pageTitleForPath(virtualPath),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      tags: [],
    },
  };
}

export async function writePage(
  virtualPath: string,
  content: string,
  frontmatter: Partial<FrontMatter>
): Promise<void> {
  let filePath: string;
  let kind: PageData["kind"];
  try {
    const target = await resolvePageTarget(virtualPath);
    filePath = target.filePath;
    kind = target.kind;
  } catch {
    const resolved = resolveContentPath(virtualPath);
    filePath = resolved.toLowerCase().endsWith(".md") ? resolved : `${resolved}.md`;
    kind = "markdown";
  }

  if (kind === "text") {
    await ensureDirectory(path.dirname(filePath));
    await writeFileContent(filePath, content);
    return;
  }

  // Strip undefined values — js-yaml cannot serialize them
  const fm = Object.fromEntries(
    Object.entries({ ...frontmatter, modified: new Date().toISOString() })
      .filter(([, v]) => v !== undefined)
  );
  const output = matter.stringify(content, fm);
  await ensureDirectory(path.dirname(filePath));
  await writeFileContent(filePath, output);
}

export async function createPage(
  virtualPath: string,
  title: string
): Promise<string> {
  const parentDir = resolveContentPath(virtualPath);
  const safeName = sanitizeFilename(title) || "Untitled";
  const filename = safeName.toLowerCase().endsWith(".md") ? safeName : `${safeName}.md`;
  const filePath = path.join(parentDir, filename);

  if (await fileExists(filePath)) {
    throw new Error(`Page already exists: ${virtualPath}/${filename}`);
  }

  await ensureDirectory(parentDir);
  const fm = defaultFrontmatter(title);
  const output = matter.stringify(`\n# ${title}\n`, fm);
  await writeFileContent(filePath, output);
  return virtualPath ? `${virtualPath}/${filename}` : filename;
}

export async function deletePage(virtualPath: string): Promise<void> {
  const target = await resolvePageTarget(virtualPath);
  const deleteTarget =
    target.kind === "directory-index" ? path.dirname(target.filePath) : target.filePath;
  await deleteFileOrDir(deleteTarget);
}

export async function movePage(
  fromPath: string,
  toParentPath: string
): Promise<string> {
  const target = await resolvePageTarget(fromPath);
  const fromResolved =
    target.kind === "directory-index" ? path.dirname(target.filePath) : target.filePath;
  const name = path.basename(fromResolved);
  const toDir = toParentPath
    ? resolveContentPath(toParentPath)
    : resolveContentPath("");
  const toResolved = path.join(toDir, name);

  if (fromResolved === toResolved) return fromPath;
  if (toResolved.startsWith(fromResolved + "/")) {
    throw new Error("Cannot move a page into itself");
  }

  await ensureDirectory(toDir);
  const fs = await import("fs/promises");
  await fs.rename(fromResolved, toResolved);

  return toParentPath ? `${toParentPath}/${name}` : name;
}

export async function renamePage(
  virtualPath: string,
  newName: string
): Promise<string> {
  const target = await resolvePageTarget(virtualPath);
  const fromResolved =
    target.kind === "directory-index" ? path.dirname(target.filePath) : target.filePath;
  const parentDir = path.dirname(fromResolved);
  const ext =
    target.kind === "directory-index" ? "" : path.extname(fromResolved);
  const baseName = sanitizeFilename(newName) || pageTitleForPath(virtualPath);
  const toResolved = path.join(parentDir, ext ? `${baseName}${ext}` : baseName);

  if (fromResolved === toResolved) return virtualPath;

  const fs = await import("fs/promises");
  await fs.rename(fromResolved, toResolved);

  // Update frontmatter title
  const markdownTarget =
    target.kind === "directory-index" ? path.join(toResolved, "index.md") : toResolved;
  if (
    (target.kind === "directory-index" || target.kind === "markdown") &&
    await fileExists(markdownTarget)
  ) {
    const raw = await readFileContent(markdownTarget);
    const { data, content } = matter(raw);
    data.title = newName;
    data.modified = new Date().toISOString();
    const fm = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    );
    const output = matter.stringify(content, fm);
    await writeFileContent(markdownTarget, output);
  }

  const parentVirtual = virtualPath.split("/").slice(0, -1).join("/");
  const newLeaf = ext ? `${baseName}${ext}` : baseName;
  return parentVirtual ? `${parentVirtual}/${newLeaf}` : newLeaf;
}
