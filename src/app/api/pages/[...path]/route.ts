import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  getFrontmatterTitle,
  parseMarkdownFrontmatter,
} from "@/lib/markdown/frontmatter";
import { resolveBundlePluginAssetByVirtualPath } from "@/lib/plugins/plugin-manager";
import { readFileContent } from "@/lib/storage/fs-operations";
import { deleteNode, moveNode, renameNode } from "@/lib/storage/node-io";
import { readPage, writePage, createPage } from "@/lib/storage/page-io";
import { fileTitleFromPath, isPluginVirtualPath } from "@/lib/storage/path-utils";
import {
  markGraphCacheDirty,
  syncGraphCacheAfterCreate,
  syncGraphCacheAfterDelete,
  syncGraphCacheAfterRenameOrMove,
  syncGraphCacheAfterWrite,
} from "@/lib/graph/build-graph";
import {
  markDataviewCacheDirty,
  syncDataviewCacheAfterCreate,
  syncDataviewCacheAfterDelete,
  syncDataviewCacheAfterRenameOrMove,
  syncDataviewCacheAfterWrite,
} from "@/lib/markdown/page-index";
import { autoCommit } from "@/lib/git/git-service";
import type { PageData } from "@/types";

type RouteParams = { params: Promise<{ path: string[] }> };

function mutationStatusFromMessage(message: string) {
  if (message.includes("not found")) return 404;
  if (message.includes("already exists")) return 409;
  if (
    message.includes("Cannot modify") ||
    message.includes("Cannot move") ||
    message.includes("Target is not a directory")
  ) {
    return 400;
  }
  return 500;
}

async function runMutationSideEffects(...effects: Array<Promise<unknown>>) {
  const results = await Promise.allSettled(effects);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Page side effect failed:", result.reason);
    }
  }
}

function inferPluginBundlePageKind(virtualPath: string): PageData["kind"] {
  const extension = path.extname(virtualPath).toLowerCase();
  if (extension === ".md") return "markdown";
  if (extension === ".csv") return "csv";
  if (extension === ".pdf") return "pdf";
  return "text";
}

async function readPluginBundlePage(virtualPath: string): Promise<PageData> {
  const resolved = await resolveBundlePluginAssetByVirtualPath({ virtualPath });
  if (!resolved.ok) {
    throw Object.assign(new Error(resolved.message), { status: resolved.status });
  }

  const raw = await readFileContent(resolved.absolutePath);
  const kind = inferPluginBundlePageKind(virtualPath);
  if (kind === "markdown") {
    const { frontmatter, content } = parseMarkdownFrontmatter(raw);
    return {
      path: virtualPath,
      requestedPath: virtualPath,
      backingPath: resolved.absolutePath,
      kind,
      editable: false,
      content,
      frontmatter,
    };
  }

  return {
    path: virtualPath,
    requestedPath: virtualPath,
    backingPath: resolved.absolutePath,
    kind,
    editable: false,
    content: raw,
    frontmatter: {
      title: fileTitleFromPath(virtualPath),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      tags: [],
    },
  };
}

function isReadOnlyPluginBundlePath(virtualPath: string): boolean {
  return isPluginVirtualPath(virtualPath);
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    const page = isReadOnlyPluginBundlePath(virtualPath)
      ? await readPluginBundlePage(virtualPath)
      : await readPage(virtualPath);
    return NextResponse.json(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      typeof (error as { status?: unknown })?.status === "number"
        ? ((error as { status: number }).status as number)
        : message.includes("not found")
          ? 404
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    if (isReadOnlyPluginBundlePath(virtualPath)) {
      return NextResponse.json(
        { error: "Plugin bundle assets are read-only." },
        { status: 403 }
      );
    }
    const body = await req.json();
    const previousPage = await readPage(virtualPath).catch(() => null);
    await writePage(virtualPath, body.content, body.frontmatter);
    const page = await readPage(virtualPath);
    await runMutationSideEffects(
      syncGraphCacheAfterWrite(page.path, {
        previousTitle: previousPage
          ? getFrontmatterTitle(previousPage.frontmatter, previousPage.path)
          : null,
      }),
      syncDataviewCacheAfterWrite(page.path),
    );
    autoCommit(page.path, "Update");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    if (isReadOnlyPluginBundlePath(virtualPath)) {
      return NextResponse.json(
        { error: "Plugin bundle assets are read-only." },
        { status: 403 }
      );
    }
    const body = await req.json();
    const newPath = await createPage(virtualPath, body.title);
    markGraphCacheDirty();
    markDataviewCacheDirty();
    void runMutationSideEffects(
      syncGraphCacheAfterCreate(newPath),
      syncDataviewCacheAfterCreate(newPath),
    );
    autoCommit(newPath, "Add");
    return NextResponse.json({ ok: true, newPath }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    if (isReadOnlyPluginBundlePath(virtualPath)) {
      return NextResponse.json(
        { error: "Plugin bundle assets are read-only." },
        { status: 403 }
      );
    }
    const body = await req.json();
    const previousPage = await readPage(virtualPath).catch(() => null);
    if (body.rename) {
      const newPath = await renameNode(virtualPath, body.rename);
      const renamedPage = await readPage(newPath).catch(() => null);
      await runMutationSideEffects(
        syncGraphCacheAfterRenameOrMove(
          previousPage?.path ?? virtualPath,
          renamedPage?.path ?? newPath
        ),
        syncDataviewCacheAfterRenameOrMove(
          previousPage?.path ?? virtualPath,
          renamedPage?.path ?? newPath
        ),
      );
      autoCommit(newPath, "Update");
      return NextResponse.json({ ok: true, newPath });
    }
    const newPath = await moveNode(virtualPath, body.toParent || "");
    const movedPage = await readPage(newPath).catch(() => null);
    await runMutationSideEffects(
      syncGraphCacheAfterRenameOrMove(
        previousPage?.path ?? virtualPath,
        movedPage?.path ?? newPath
      ),
      syncDataviewCacheAfterRenameOrMove(
        previousPage?.path ?? virtualPath,
        movedPage?.path ?? newPath
      ),
    );
    autoCommit(newPath, "Update");
    return NextResponse.json({ ok: true, newPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: mutationStatusFromMessage(message) });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    if (isReadOnlyPluginBundlePath(virtualPath)) {
      return NextResponse.json(
        { error: "Plugin bundle assets are read-only." },
        { status: 403 }
      );
    }
    const previousPage = await readPage(virtualPath).catch(() => null);
    await deleteNode(virtualPath);
    await runMutationSideEffects(
      syncGraphCacheAfterDelete(previousPage?.path ?? virtualPath),
      syncDataviewCacheAfterDelete(previousPage?.path ?? virtualPath),
    );
    autoCommit(virtualPath, "Delete");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: mutationStatusFromMessage(message) });
  }
}
