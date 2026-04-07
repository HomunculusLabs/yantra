import type { TreeNode, PageData, FrontMatter, GraphData, CacheStatusData } from "@/types";

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export async function fetchTree(): Promise<TreeNode[]> {
  const res = await fetch("/api/tree");
  if (!res.ok) throw new Error("Failed to fetch tree");
  return res.json();
}

export async function fetchAbsolutePath(path: string): Promise<string> {
  const res = await fetch(`/api/tree/path/${encodePath(path)}`);
  if (!res.ok) throw new Error(`Failed to resolve path: ${path}`);
  const data = await res.json();
  return data.absolutePath;
}

export async function fetchPage(
  path: string,
  options?: { signal?: AbortSignal }
): Promise<PageData> {
  const res = await fetch(`/api/pages/${encodePath(path)}`, {
    signal: options?.signal,
  });
  if (!res.ok) {
    let message = `Failed to fetch page: ${path}`;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === "string" && data.error.trim()) {
        message = data.error;
      }
    } catch {
      // fall back to the generic message when the response body is not JSON
    }
    throw new Error(message);
  }
  return res.json();
}

export async function savePage(
  path: string,
  content: string,
  frontmatter: Partial<FrontMatter>
): Promise<void> {
  const res = await fetch(`/api/pages/${encodePath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, frontmatter }),
  });
  if (!res.ok) throw new Error(`Failed to save page: ${path}`);
}

export async function renderMarkdown(
  markdown: string,
  pagePath?: string
): Promise<string> {
  const res = await fetch("/api/ai/render-md", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, pagePath }),
  });
  if (!res.ok) throw new Error("Failed to render markdown");
  const data = await res.json();
  return data.html || "";
}

export async function fetchGraph(options?: {
  path?: string | null;
  depth?: number;
  signal?: AbortSignal;
}): Promise<GraphData> {
  const params = new URLSearchParams();
  if (options?.path) params.set("path", options.path);
  if (options?.depth !== undefined) params.set("depth", String(options.depth));

  const query = params.toString();
  const res = await fetch(query ? `/api/graph?${query}` : "/api/graph", {
    signal: options?.signal,
  });
  if (!res.ok) throw new Error("Failed to fetch graph");
  return res.json();
}

export async function fetchCacheStatus(
  options?: { signal?: AbortSignal }
): Promise<CacheStatusData> {
  const res = await fetch("/api/cache-status", {
    signal: options?.signal,
  });
  if (!res.ok) throw new Error("Failed to fetch cache status");
  return res.json();
}

export async function rebuildCaches(
  target: "graph" | "dataview" | "render" | "all" = "all"
): Promise<CacheStatusData> {
  const res = await fetch("/api/cache-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw new Error(`Failed to rebuild ${target} cache`);
  const data = await res.json();
  return data.status;
}

export async function createPageApi(
  parentPath: string,
  title: string
): Promise<string> {
  const encodedParent = encodePath(parentPath);
  const url = encodedParent ? `/api/pages/${encodedParent}` : "/api/pages";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to create page: ${parentPath}`);
  const data = await res.json();
  return data.newPath;
}

export async function deletePageApi(path: string): Promise<void> {
  const res = await fetch(`/api/pages/${encodePath(path)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete page: ${path}`);
}

export async function movePageApi(
  fromPath: string,
  toParent: string
): Promise<string> {
  const res = await fetch(`/api/pages/${encodePath(fromPath)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toParent }),
  });
  if (!res.ok) throw new Error(`Failed to move page: ${fromPath}`);
  const data = await res.json();
  return data.newPath;
}

export async function renamePageApi(
  fromPath: string,
  newName: string
): Promise<string> {
  const res = await fetch(`/api/pages/${encodePath(fromPath)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rename: newName }),
  });
  if (!res.ok) throw new Error(`Failed to rename page: ${fromPath}`);
  const data = await res.json();
  return data.newPath;
}
