import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import {
  resolveContentPath,
  sanitizeFilename,
  isRuntimeVirtualPath,
  toRuntimeVirtualPath,
  RUNTIME_VIRTUAL_PREFIX,
} from "./path-utils";
import {
  deleteFileOrDir,
  ensureDirectory,
  fileExists,
  readFileContent,
  writeFileContent,
} from "./fs-operations";

type NodeKind = "file" | "directory";

type ResolvedNodeTarget = {
  absolutePath: string;
  kind: NodeKind;
  virtualLeafName: string;
  prefersExtensionlessMarkdownPath: boolean;
};

function assertNotRootNode(virtualPath: string) {
  if (!virtualPath || virtualPath === RUNTIME_VIRTUAL_PREFIX) {
    throw new Error("Cannot modify the root folder");
  }
}

function joinVirtualPath(parentPath: string, leafName: string, preferRuntimeRoot: boolean) {
  if (parentPath) return `${parentPath}/${leafName}`;
  return preferRuntimeRoot ? toRuntimeVirtualPath(leafName) : leafName;
}

function stripDuplicateExtension(name: string, extension: string) {
  if (!extension) return name;
  return name.toLowerCase().endsWith(extension.toLowerCase())
    ? name.slice(0, -extension.length)
    : name;
}

function toVirtualLeafName(
  baseName: string,
  extension: string,
  prefersExtensionlessMarkdownPath: boolean
) {
  if (prefersExtensionlessMarkdownPath && extension.toLowerCase() === ".md") {
    return baseName;
  }
  return extension ? `${baseName}${extension}` : baseName;
}

function isNestedTarget(fromAbsolutePath: string, toAbsolutePath: string) {
  const relative = path.relative(fromAbsolutePath, toAbsolutePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function maybeUpdateMarkdownTitle(targetPath: string, title: string) {
  if (!(await fileExists(targetPath)) || !targetPath.toLowerCase().endsWith(".md")) {
    return;
  }

  const raw = await readFileContent(targetPath);
  const { data, content } = matter(raw);
  data.title = title;
  data.modified = new Date().toISOString();
  const output = matter.stringify(
    content,
    Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
  );
  await writeFileContent(targetPath, output);
}

export async function resolveNodeTarget(virtualPath: string): Promise<ResolvedNodeTarget> {
  const absolutePath = resolveContentPath(virtualPath);
  if (await fileExists(absolutePath)) {
    const stats = await fs.stat(absolutePath);
    return {
      absolutePath,
      kind: stats.isDirectory() ? "directory" : "file",
      virtualLeafName: path.basename(virtualPath) || path.basename(absolutePath),
      prefersExtensionlessMarkdownPath: false,
    };
  }

  if (!path.extname(virtualPath)) {
    const legacyMarkdownPath = `${absolutePath}.md`;
    if (await fileExists(legacyMarkdownPath)) {
      return {
        absolutePath: legacyMarkdownPath,
        kind: "file",
        virtualLeafName: path.basename(virtualPath),
        prefersExtensionlessMarkdownPath: true,
      };
    }
  }

  throw new Error(`Path not found: ${virtualPath}`);
}

async function resolveDestinationDirectory(fromPath: string, toParentPath: string) {
  if (!toParentPath) {
    const destinationPath = resolveContentPath(
      isRuntimeVirtualPath(fromPath) ? RUNTIME_VIRTUAL_PREFIX : ""
    );
    await ensureDirectory(destinationPath);
    return destinationPath;
  }

  const targetParent = await resolveNodeTarget(toParentPath);
  if (targetParent.kind !== "directory") {
    throw new Error(`Target is not a directory: ${toParentPath}`);
  }

  return targetParent.absolutePath;
}

export async function deleteNode(virtualPath: string): Promise<void> {
  assertNotRootNode(virtualPath);
  const target = await resolveNodeTarget(virtualPath);
  await deleteFileOrDir(target.absolutePath);
}

export async function moveNode(
  fromPath: string,
  toParentPath: string
): Promise<string> {
  assertNotRootNode(fromPath);
  const target = await resolveNodeTarget(fromPath);
  const destinationDirectory = await resolveDestinationDirectory(fromPath, toParentPath);
  const leafName = path.basename(target.absolutePath);
  const destinationPath = path.join(destinationDirectory, leafName);

  if (destinationPath === target.absolutePath) {
    return fromPath;
  }

  if (target.kind === "directory" && isNestedTarget(target.absolutePath, destinationPath)) {
    throw new Error("Cannot move a folder into itself");
  }

  if (await fileExists(destinationPath)) {
    throw new Error(`Destination already exists: ${leafName}`);
  }

  await fs.rename(target.absolutePath, destinationPath);
  return joinVirtualPath(toParentPath, target.virtualLeafName, isRuntimeVirtualPath(fromPath));
}

export async function renameNode(
  virtualPath: string,
  newName: string
): Promise<string> {
  assertNotRootNode(virtualPath);
  const target = await resolveNodeTarget(virtualPath);
  const parentAbsolutePath = path.dirname(target.absolutePath);
  const currentExtension = target.kind === "file" ? path.extname(target.absolutePath) : "";
  const sanitizedName =
    sanitizeFilename(newName) ||
    stripDuplicateExtension(target.virtualLeafName, currentExtension) ||
    path.basename(target.absolutePath, currentExtension);
  const nextBaseName = stripDuplicateExtension(sanitizedName, currentExtension);
  const nextLeafName = currentExtension ? `${nextBaseName}${currentExtension}` : nextBaseName;
  const nextVirtualLeafName = toVirtualLeafName(
    nextBaseName,
    currentExtension,
    target.prefersExtensionlessMarkdownPath
  );
  const nextAbsolutePath = path.join(parentAbsolutePath, nextLeafName);

  if (nextAbsolutePath === target.absolutePath) {
    return virtualPath;
  }

  if (await fileExists(nextAbsolutePath)) {
    throw new Error(`Destination already exists: ${nextLeafName}`);
  }

  await fs.rename(target.absolutePath, nextAbsolutePath);

  if (target.kind === "directory") {
    await maybeUpdateMarkdownTitle(path.join(nextAbsolutePath, "index.md"), nextBaseName);
  } else {
    await maybeUpdateMarkdownTitle(nextAbsolutePath, nextBaseName);
  }

  const parentVirtualPath = virtualPath.split("/").slice(0, -1).join("/");
  return joinVirtualPath(
    parentVirtualPath,
    nextVirtualLeafName,
    isRuntimeVirtualPath(virtualPath)
  );
}
