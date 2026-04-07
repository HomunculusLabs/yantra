import { resolveBundlePluginAsset } from "@/lib/plugins/plugin-manager";
import {
  isPluginVirtualPath,
  parsePluginVirtualPath,
  resolveContentPath,
} from "@/lib/storage/path-utils";

export type ResolvedVirtualContent =
  | {
      ok: true;
      scope: "vault" | "runtime" | "plugin";
      virtualPath: string;
      absolutePath: string;
      writable: boolean;
      pluginId?: string;
    }
  | {
      ok: false;
      status: 400 | 404 | 409;
      message: string;
    };

export async function resolveVirtualContentPath(input: {
  virtualPath: string;
  access: "read" | "write";
}): Promise<ResolvedVirtualContent> {
  if (isPluginVirtualPath(input.virtualPath)) {
    const parsed = parsePluginVirtualPath(input.virtualPath);
    if (!parsed) {
      return { ok: false, status: 400, message: "Plugin virtual path is invalid." };
    }
    if (input.access === "write") {
      return { ok: false, status: 409, message: "Plugin-backed paths are read-only." };
    }

    const resolved = await resolveBundlePluginAsset(parsed);
    if (!resolved.ok) {
      return resolved;
    }

    return {
      ok: true,
      scope: "plugin",
      virtualPath: input.virtualPath,
      absolutePath: resolved.absolutePath,
      writable: false,
      pluginId: parsed.pluginId,
    };
  }

  try {
    return {
      ok: true,
      scope: input.virtualPath.startsWith("@runtime/") || input.virtualPath === "@runtime" ? "runtime" : "vault",
      virtualPath: input.virtualPath,
      absolutePath: resolveContentPath(input.virtualPath),
      writable: true,
    };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      message: error instanceof Error ? error.message : "Virtual path is invalid.",
    };
  }
}
