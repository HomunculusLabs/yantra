import path from "path";
import {
  getYantraRoots,
  isWithinRuntimeRoot,
  resolveVaultPath,
  resolveRuntimePath,
  toVaultRelative,
  toRuntimeRelative,
} from "@/lib/config/yantra-roots";

export const DATA_DIR = getYantraRoots().vaultRoot;
export const RUNTIME_DIR = getYantraRoots().runtimeRoot;
export const RUNTIME_VIRTUAL_PREFIX = "@runtime";

const EXCLUDED_ENTRIES = new Set([
  ".git",
  ".dot314-git",
  ".Trashes",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".DS_Store",
]);

export function resolveContentPath(virtualPath: string): string {
  if (isRuntimeVirtualPath(virtualPath)) {
    return resolveRuntimePath(stripRuntimePrefix(virtualPath));
  }
  return resolveVaultPath(virtualPath);
}

export function virtualPathFromFs(fsPath: string): string {
  const { runtimeRoot, vaultRoot } = getYantraRoots();
  if (runtimeRoot !== vaultRoot && isWithinRuntimeRoot(fsPath)) {
    return toRuntimeVirtualPath(toRuntimeRelative(fsPath));
  }
  return toVaultRelative(fsPath);
}

export function isRuntimeVirtualPath(virtualPath: string): boolean {
  return (
    virtualPath === RUNTIME_VIRTUAL_PREFIX ||
    virtualPath.startsWith(`${RUNTIME_VIRTUAL_PREFIX}/`)
  );
}

export function stripRuntimePrefix(virtualPath: string): string {
  if (!isRuntimeVirtualPath(virtualPath)) return virtualPath;
  return virtualPath
    .slice(RUNTIME_VIRTUAL_PREFIX.length)
    .replace(/^\/+/, "");
}

export function toRuntimeVirtualPath(runtimePath: string): string {
  const normalized = runtimePath.replace(/^\/+/, "");
  return normalized ? `${RUNTIME_VIRTUAL_PREFIX}/${normalized}` : RUNTIME_VIRTUAL_PREFIX;
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

export function isHiddenEntry(name: string): boolean {
  return EXCLUDED_ENTRIES.has(name);
}

export function splitVirtualPath(virtualPath: string): string[] {
  return virtualPath.split("/").filter(Boolean).map(encodeURIComponent);
}

export function fileTitleFromPath(virtualPath: string): string {
  return path.basename(virtualPath).replace(/\.[^.]+$/, "");
}
