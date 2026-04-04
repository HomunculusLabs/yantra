import path from "path";
import matter from "gray-matter";
import type { TreeNode } from "@/types";
import {
  DATA_DIR,
  virtualPathFromFs,
  isHiddenEntry,
  isMarkdownFile,
} from "./path-utils";
import { listDirectory, readFileContent, fileExists } from "./fs-operations";
import { getYantraRoots } from "@/lib/config/yantra-roots";

const TEXT_EXTENSIONS = new Set([
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
  ".csv",
]);

function isLikelyTextFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return !ext && !name.startsWith(".");
}

async function readFrontmatter(
  filePath: string
): Promise<Record<string, unknown>> {
  try {
    const raw = await readFileContent(filePath);
    const { data } = matter(raw);
    return data;
  } catch {
    return {};
  }
}

async function buildTreeRecursive(dirPath: string): Promise<TreeNode[]> {
  const entries = await listDirectory(dirPath);
  const nodes: TreeNode[] = [];
  const { runtimeRoot } = getYantraRoots();

  for (const entry of entries) {
    if (isHiddenEntry(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    if (runtimeRoot.startsWith(`${DATA_DIR}${path.sep}`) && fullPath === runtimeRoot) {
      continue;
    }
    const vPath = virtualPathFromFs(fullPath);

    if (entry.isDirectory) {
      const indexMd = path.join(fullPath, "index.md");
      const indexHtml = path.join(fullPath, "index.html");
      const hasIndexMd = await fileExists(indexMd);
      const hasIndexHtml = await fileExists(indexHtml);

      const repoYaml = path.join(fullPath, ".repo.yaml");
      const hasRepo = await fileExists(repoYaml);

      // Website or App: has index.html but no index.md
      if (hasIndexHtml && !hasIndexMd) {
        const appMarker = path.join(fullPath, ".app");
        const isApp = await fileExists(appMarker);
        nodes.push({
          name: entry.name,
          path: vPath,
          type: isApp ? "app" : "website",
          hasRepo: hasRepo || undefined,
          frontmatter: {
            title: entry.name,
          },
        });
        continue;
      }

      const fm = hasIndexMd ? await readFrontmatter(indexMd) : {};
      const children = await buildTreeRecursive(fullPath);

      nodes.push({
        name: entry.name,
        path: vPath,
        type: "directory",
        hasRepo: hasRepo || undefined,
        frontmatter: {
          title: (fm.title as string) || entry.name,
          icon: fm.icon as string | undefined,
          order: fm.order as number | undefined,
        },
        children,
      });
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      nodes.push({
        name: entry.name,
        path: vPath,
        type: "pdf",
        frontmatter: {
          title: entry.name.replace(/\.pdf$/i, ""),
        },
      });
    } else if (entry.name.toLowerCase().endsWith(".csv")) {
      nodes.push({
        name: entry.name,
        path: vPath,
        type: "csv",
        frontmatter: {
          title: entry.name.replace(/\.csv$/i, ""),
        },
      });
    } else if (isMarkdownFile(entry.name) && entry.name !== "index.md") {
      const fm = await readFrontmatter(fullPath);
      nodes.push({
        name: entry.name,
        path: vPath,
        type: "file",
        frontmatter: {
          title: (fm.title as string) || entry.name.replace(/\.md$/, ""),
          icon: fm.icon as string | undefined,
          order: fm.order as number | undefined,
        },
      });
    } else if (isLikelyTextFile(entry.name)) {
      nodes.push({
        name: entry.name,
        path: vPath,
        type: "text",
        frontmatter: {
          title: entry.name,
        },
      });
    }
  }

  // Sort by order field, then alphabetically
  nodes.sort((a, b) => {
    const orderA = a.frontmatter?.order ?? 999;
    const orderB = b.frontmatter?.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    const nameA = a.frontmatter?.title || a.name;
    const nameB = b.frontmatter?.title || b.name;
    return nameA.localeCompare(nameB);
  });

  return nodes;
}

export async function buildTree(): Promise<TreeNode[]> {
  return buildTreeRecursive(DATA_DIR);
}
