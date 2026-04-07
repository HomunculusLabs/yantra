import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  getYantraRoots,
  getYantraStorageRoutes,
  getYantraRootsConfigPath,
  readYantraRootsConfig,
  resolveConfiguredVaultPath,
  saveYantraRootsConfig,
} from "@/lib/config/yantra-roots";

const IGNORED_INDEX_ENTRIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".DS_Store",
]);

async function summarizeStorageRoute(
  route: { path: string; recursive: boolean },
  vaultRoot: string
) {
  const resolvedPath = resolveConfiguredVaultPath(route.path, vaultRoot);
  let stats;
  try {
    stats = await fsp.stat(resolvedPath);
  } catch {
    return {
      ...route,
      resolvedPath,
      exists: false,
      indexedFileCount: 0,
      sampleFiles: [],
    };
  }

  if (!stats.isDirectory()) {
    return {
      ...route,
      resolvedPath,
      exists: false,
      indexedFileCount: 0,
      sampleFiles: [],
    };
  }

  let indexedFileCount = 0;
  const sampleFiles: string[] = [];

  async function walk(absDir: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (IGNORED_INDEX_ENTRIES.has(entry.name)) continue;
      const fullPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (route.recursive) {
          await walk(fullPath);
        }
        continue;
      }

      indexedFileCount += 1;
      if (sampleFiles.length < 5) {
        sampleFiles.push(path.relative(resolvedPath, fullPath).split(path.sep).join("/"));
      }
    }
  }

  await walk(resolvedPath);

  return {
    ...route,
    resolvedPath,
    exists: true,
    indexedFileCount,
    sampleFiles,
  };
}

async function buildPayload() {
  const config = readYantraRootsConfig();
  const effective = getYantraRoots();
  const configuredVaultRoot = config.vaultRoot || effective.vaultRoot;
  const configuredRuntimeRoot = config.runtimeRoot || effective.runtimeRoot;
  const storageRoutes = getYantraStorageRoutes(config, configuredVaultRoot);
  const summarizedRoutes = Object.fromEntries(
    await Promise.all(
      Object.entries(storageRoutes).map(async ([key, route]) => [
        key,
        await summarizeStorageRoute(route, configuredVaultRoot),
      ])
    )
  );

  return {
    vaultRoot: configuredVaultRoot,
    runtimeRoot: configuredRuntimeRoot,
    storageRoutes: summarizedRoutes,
    effectiveRoots: {
      vaultRoot: effective.vaultRoot,
      runtimeRoot: effective.runtimeRoot,
    },
    configPath: getYantraRootsConfigPath(),
    checks: {
      vaultExists: fs.existsSync(configuredVaultRoot),
      runtimeExists: fs.existsSync(configuredRuntimeRoot),
    },
    restartRequired: true,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await buildPayload());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read roots config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      vaultRoot?: string;
      runtimeRoot?: string;
      storageRoutes?: {
        agents?: { path?: string; recursive?: boolean };
        skills?: { path?: string; recursive?: boolean };
        extensions?: { path?: string; recursive?: boolean };
        plugins?: { path?: string; recursive?: boolean };
        mcp?: { path?: string; recursive?: boolean };
        todo?: { path?: string; recursive?: boolean };
        tasks?: { path?: string; recursive?: boolean };
      };
    };

    await saveYantraRootsConfig({
      vaultRoot: body.vaultRoot,
      runtimeRoot: body.runtimeRoot,
      storageRoutes: body.storageRoutes,
    });

    return NextResponse.json(await buildPayload());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save roots config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
