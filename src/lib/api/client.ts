import type { TreeNode, PageData, FrontMatter } from "@/types";

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

export async function fetchPage(
  path: string,
  options?: { signal?: AbortSignal }
): Promise<PageData> {
  const res = await fetch(`/api/pages/${encodePath(path)}`, {
    signal: options?.signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch page: ${path}`);
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
