import { listPersonas } from "@/lib/agents/persona-manager";
import { buildRuntimeSettingsSummary } from "@/lib/agents/runtime-summary";
import {
  listAgentStackCatalog,
  readAgentStack,
  writeAgentStack,
} from "@/lib/agents/stack-manager";
import { autoCommit } from "@/lib/git/git-service";
import {
  buildKnowledgeGraph,
  markGraphCacheDirty,
  syncGraphCacheAfterCreate,
  syncGraphCacheAfterDelete,
  syncGraphCacheAfterWrite,
} from "@/lib/graph/build-graph";
import { getFrontmatterTitle } from "@/lib/markdown/frontmatter";
import { syncDataviewCacheAfterCreate, syncDataviewCacheAfterDelete, syncDataviewCacheAfterWrite, markDataviewCacheDirty } from "@/lib/markdown/page-index";
import {
  getPluginCapabilityDefinition,
  isPluginCapabilityAvailable,
} from "@/lib/plugins/plugin-capabilities";
import {
  mergePluginSettingsWithDefaults,
  resolveHostedPluginView,
  validatePluginSettingsPayload,
} from "@/lib/plugins/plugin-manager";
import { savePluginStateRecord } from "@/lib/plugins/plugin-state-store";
import { deleteNode } from "@/lib/storage/node-io";
import { createPage, readPage, writePage } from "@/lib/storage/page-io";
import { isRuntimeVirtualPath } from "@/lib/storage/path-utils";
import { buildTree } from "@/lib/storage/tree-builder";
import type { FrontMatter, GraphData, PageData, TreeNode } from "@/types";
import type { RuntimeSettingsSummary } from "@/types/settings";
import type { InstalledPluginSummary, PluginCapability, PluginTrust } from "@/types/plugins";
import type {
  PluginBridgeErrorCode,
  PluginBridgeMethod,
  PluginBridgeRequest,
  PluginBridgeResponse,
} from "@/types/plugin-bridge";

type HostedPlugin = InstalledPluginSummary & {
  manifest: NonNullable<InstalledPluginSummary["manifest"]>;
};

export interface PluginBridgeTreeNode {
  path: string;
  title: string;
  type: TreeNode["type"];
  canOpen: boolean;
  children?: PluginBridgeTreeNode[];
}

type BridgeHandler = (input: {
  plugin: HostedPlugin;
  params: unknown;
}) => Promise<unknown>;

type BridgeMethodCapabilityDefinition = {
  capability: PluginCapability;
};

class PluginBridgeDispatchError extends Error {
  code: PluginBridgeErrorCode;
  details?: unknown;

  constructor(code: PluginBridgeErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const pluginBridgeDependencies = {
  listPersonas,
  buildKnowledgeGraph,
  buildRuntimeSettingsSummary,
  listAgentStackCatalog,
  readAgentStack,
  writeAgentStack,
  mergePluginSettingsWithDefaults,
  resolveHostedPluginView,
  validatePluginSettingsPayload,
  savePluginStateRecord,
  createPage,
  readPage,
  writePage,
  deleteNode,
  buildTree,
  autoCommit,
  getFrontmatterTitle,
  markGraphCacheDirty,
  syncGraphCacheAfterCreate,
  syncGraphCacheAfterDelete,
  syncGraphCacheAfterWrite,
  markDataviewCacheDirty,
  syncDataviewCacheAfterCreate,
  syncDataviewCacheAfterDelete,
  syncDataviewCacheAfterWrite,
};

function createBridgeErrorResponse(
  requestId: string,
  code: PluginBridgeErrorCode,
  message: string,
  details?: unknown
): PluginBridgeResponse {
  return {
    requestId,
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPluginBridgeMethod(value: string): value is PluginBridgeMethod {
  return value in PLUGIN_BRIDGE_METHOD_CAPABILITIES;
}

function trustSatisfiesRequirement(
  currentTrust: PluginTrust,
  requiredTrust: PluginTrust
): boolean {
  return currentTrust === requiredTrust || currentTrust === "trusted-local";
}

function pluginRequestsCapability(
  plugin: HostedPlugin,
  capability: PluginCapability
): boolean {
  return (
    plugin.manifest.requestedCapabilities.required.includes(capability) ||
    plugin.manifest.requestedCapabilities.optional.includes(capability)
  );
}

function pluginCanCallCapability(
  plugin: HostedPlugin,
  capability: PluginCapability
): boolean {
  if (!pluginRequestsCapability(plugin, capability)) {
    return false;
  }
  if (!plugin.state.grantedCapabilities.includes(capability)) {
    return false;
  }
  if (!isPluginCapabilityAvailable(capability)) {
    return false;
  }
  const definition = getPluginCapabilityDefinition(capability);
  return trustSatisfiesRequirement(plugin.state.trust, definition.requiresTrust);
}

function mapTreeNode(node: TreeNode): PluginBridgeTreeNode {
  return {
    path: node.path,
    title: node.frontmatter?.title || node.name,
    type: node.type,
    canOpen: node.canOpen,
    ...(node.children?.length
      ? {
          children: node.children.map((child) => mapTreeNode(child)),
        }
      : {}),
  };
}

async function runMutationSideEffects(...effects: Array<Promise<unknown>>) {
  const results = await Promise.allSettled(effects);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Plugin bridge page side effect failed:", result.reason);
    }
  }
}

function parsePagePath(value: unknown, method: string): string {
  if (typeof value !== "string") {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      `${method} requires a string path.`
    );
  }

  const nextPath = value.trim();
  if (!nextPath) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      `${method} path must be a non-empty string.`
    );
  }
  if (nextPath.includes("\u0000") || nextPath.startsWith("/")) {
    throw new PluginBridgeDispatchError("invalid_params", `${method} path is invalid.`);
  }
  if (isRuntimeVirtualPath(nextPath)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      `${method} cannot access runtime-prefixed paths in phase 1.`
    );
  }

  return nextPath;
}

function parseOptionalParentPath(value: unknown, method: string): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return parsePagePath(value, method);
}

function parseGraphReadParams(params: unknown): {
  centerPath: string | null;
  depth: number;
} {
  if (params === undefined) {
    return { centerPath: null, depth: 1 };
  }
  if (!isRecord(params)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "graph.read requires an object when params are provided."
    );
  }

  const centerPath =
    typeof params.path === "string" && params.path.trim()
      ? parsePagePath(params.path, "graph.read")
      : null;
  const depthValue = params.depth;
  if (depthValue !== undefined && (typeof depthValue !== "number" || !Number.isFinite(depthValue))) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "graph.read depth must be a finite number when provided."
    );
  }

  return {
    centerPath,
    depth:
      typeof depthValue === "number"
        ? Math.max(1, Math.min(3, Math.trunc(depthValue)))
        : 1,
  };
}

function parsePageReadParams(params: unknown): { path: string } {
  if (!isRecord(params) || typeof params.path !== "string") {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.read requires a params object with a string path."
    );
  }

  return { path: parsePagePath(params.path, "page.read") };
}

function parsePageCreateParams(params: unknown): { parentPath: string; title: string } {
  if (!isRecord(params) || typeof params.title !== "string") {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.create requires a params object with a string title."
    );
  }

  const title = params.title.trim();
  if (!title) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.create title must be a non-empty string."
    );
  }

  return {
    parentPath: parseOptionalParentPath(params.parentPath, "page.create"),
    title,
  };
}

function parsePageWriteParams(params: unknown): {
  path: string;
  content: string;
  frontmatter: Partial<FrontMatter>;
} {
  if (!isRecord(params) || typeof params.path !== "string" || typeof params.content !== "string") {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.write requires a params object with string path and content fields."
    );
  }
  if (params.frontmatter !== undefined && !isRecord(params.frontmatter)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.write frontmatter must be an object when provided."
    );
  }

  return {
    path: parsePagePath(params.path, "page.write"),
    content: params.content,
    frontmatter: (params.frontmatter ?? {}) as Partial<FrontMatter>,
  };
}

function parsePageDeleteParams(params: unknown): { path: string } {
  if (!isRecord(params) || typeof params.path !== "string") {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.delete requires a params object with a string path."
    );
  }

  return { path: parsePagePath(params.path, "page.delete") };
}

function parseAgentSlug(value: unknown, method: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      `${method} requires a non-empty string slug.`
    );
  }
  return value.trim();
}

function parseAgentStackReadParams(params: unknown): { slug: string } {
  if (!isRecord(params)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "agent.stack.read requires a params object with a string slug."
    );
  }

  return { slug: parseAgentSlug(params.slug, "agent.stack.read") };
}

function parseAgentStackWriteParams(params: unknown): {
  slug: string;
  stack: Record<string, unknown>;
} {
  if (!isRecord(params) || !isRecord(params.stack)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "agent.stack.write requires a params object with slug and stack fields."
    );
  }

  return {
    slug: parseAgentSlug(params.slug, "agent.stack.write"),
    stack: params.stack,
  };
}

function parseSettingsWriteParams(params: unknown): Record<string, unknown> {
  if (!isRecord(params) || !("settings" in params)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "plugin.settings.write requires a params object with settings."
    );
  }
  if (!isRecord(params.settings)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "plugin.settings.write settings must be an object."
    );
  }
  return params.settings;
}

const HOST_LOCAL_PLUGIN_BRIDGE_METHODS: Record<
  Extract<PluginBridgeMethod, "desktop.selectDirectory">,
  BridgeMethodCapabilityDefinition
> = {
  "desktop.selectDirectory": {
    capability: "desktop.selectDirectory",
  },
};

const PLUGIN_BRIDGE_METHODS: Record<
  PluginBridgeMethod,
  {
    capability: PluginCapability;
    handler: BridgeHandler;
  }
> = {
  "tree.read": {
    capability: "tree.read",
    handler: async () => {
      const tree = await pluginBridgeDependencies.buildTree();
      return tree.map((node) => mapTreeNode(node));
    },
  },
  "graph.read": {
    capability: "graph.read",
    handler: async ({ params }): Promise<GraphData> => {
      const { centerPath, depth } = parseGraphReadParams(params);
      return pluginBridgeDependencies.buildKnowledgeGraph({
        centerPath,
        depth,
      });
    },
  },
  "page.read": {
    capability: "page.read",
    handler: async ({ params }): Promise<PageData> => {
      const { path } = parsePageReadParams(params);
      try {
        return await pluginBridgeDependencies.readPage(path);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to read page.";
        if (message.toLowerCase().includes("not found")) {
          throw new PluginBridgeDispatchError("not_found", message);
        }
        throw error;
      }
    },
  },
  "page.create": {
    capability: "page.create",
    handler: async ({ params }) => {
      const { parentPath, title } = parsePageCreateParams(params);
      const newPath = await pluginBridgeDependencies.createPage(parentPath, title);
      pluginBridgeDependencies.markGraphCacheDirty();
      pluginBridgeDependencies.markDataviewCacheDirty();
      void runMutationSideEffects(
        pluginBridgeDependencies.syncGraphCacheAfterCreate(newPath),
        pluginBridgeDependencies.syncDataviewCacheAfterCreate(newPath)
      );
      pluginBridgeDependencies.autoCommit(newPath, "Add");
      return { newPath };
    },
  },
  "page.write": {
    capability: "page.write",
    handler: async ({ params }) => {
      const { path, content, frontmatter } = parsePageWriteParams(params);
      const previousPage = await pluginBridgeDependencies.readPage(path).catch(() => null);
      await pluginBridgeDependencies.writePage(path, content, frontmatter);
      const page = await pluginBridgeDependencies.readPage(path);
      await runMutationSideEffects(
        pluginBridgeDependencies.syncGraphCacheAfterWrite(page.path, {
          previousTitle: previousPage
            ? pluginBridgeDependencies.getFrontmatterTitle(
                previousPage.frontmatter,
                previousPage.path
              )
            : null,
        }),
        pluginBridgeDependencies.syncDataviewCacheAfterWrite(page.path)
      );
      pluginBridgeDependencies.autoCommit(page.path, "Update");
      return { saved: true };
    },
  },
  "page.delete": {
    capability: "page.delete",
    handler: async ({ params }) => {
      const { path } = parsePageDeleteParams(params);
      const previousPage = await pluginBridgeDependencies.readPage(path).catch(() => null);
      await pluginBridgeDependencies.deleteNode(path);
      await runMutationSideEffects(
        pluginBridgeDependencies.syncGraphCacheAfterDelete(previousPage?.path ?? path),
        pluginBridgeDependencies.syncDataviewCacheAfterDelete(previousPage?.path ?? path)
      );
      pluginBridgeDependencies.autoCommit(path, "Delete");
      return { deleted: true };
    },
  },
  "agents.read": {
    capability: "agents.read",
    handler: async () => {
      return pluginBridgeDependencies.listPersonas();
    },
  },
  "agent.stack.read": {
    capability: "agent.stack.read",
    handler: async ({ params }) => {
      const { slug } = parseAgentStackReadParams(params);
      const [stackData, catalog] = await Promise.all([
        pluginBridgeDependencies.readAgentStack(slug),
        pluginBridgeDependencies.listAgentStackCatalog(),
      ]);
      return {
        stackPath: stackData.stackPath,
        stack: stackData.stack,
        catalog,
      };
    },
  },
  "agent.stack.write": {
    capability: "agent.stack.write",
    handler: async ({ params }) => {
      const { slug, stack } = parseAgentStackWriteParams(params);
      return pluginBridgeDependencies.writeAgentStack(slug, stack);
    },
  },
  "plugin.settings.read": {
    capability: "plugin.settings.read",
    handler: async ({ plugin }) => {
      return pluginBridgeDependencies.mergePluginSettingsWithDefaults(
        plugin.manifest,
        plugin.state.settings
      );
    },
  },
  "plugin.settings.write": {
    capability: "plugin.settings.write",
    handler: async ({ plugin, params }) => {
      const settingsInput = parseSettingsWriteParams(params);
      const { settings, issues } = pluginBridgeDependencies.validatePluginSettingsPayload(
        plugin.manifest,
        settingsInput
      );
      if (issues.length > 0) {
        throw new PluginBridgeDispatchError(
          "invalid_params",
          "Plugin settings payload failed validation.",
          issues
        );
      }

      await pluginBridgeDependencies.savePluginStateRecord(plugin.manifest.id, {
        ...plugin.state,
        settings,
      });
      return { saved: true };
    },
  },
  "runtime.summary.read": {
    capability: "runtime.summary.read",
    handler: async (): Promise<RuntimeSettingsSummary> => {
      return pluginBridgeDependencies.buildRuntimeSettingsSummary();
    },
  },
  "desktop.selectDirectory": {
    capability: "desktop.selectDirectory",
    handler: async () => {
      throw new PluginBridgeDispatchError(
        "runtime_blocked",
        "Plugin bridge method 'desktop.selectDirectory' must be called through the host runtime."
      );
    },
  },
};

const PLUGIN_BRIDGE_METHOD_CAPABILITIES: Record<
  PluginBridgeMethod,
  BridgeMethodCapabilityDefinition
> = {
  ...Object.fromEntries(
    Object.entries(PLUGIN_BRIDGE_METHODS).map(([method, definition]) => [
      method,
      { capability: definition.capability },
    ])
  ),
  ...HOST_LOCAL_PLUGIN_BRIDGE_METHODS,
} as Record<PluginBridgeMethod, BridgeMethodCapabilityDefinition>;

export function getSupportedPluginBridgeMethods(
  plugin: HostedPlugin
): PluginBridgeMethod[] {
  return (Object.entries(PLUGIN_BRIDGE_METHOD_CAPABILITIES) as Array<
    [PluginBridgeMethod, (typeof PLUGIN_BRIDGE_METHOD_CAPABILITIES)[PluginBridgeMethod]]
  >)
    .filter(([, definition]) => pluginCanCallCapability(plugin, definition.capability))
    .map(([method]) => method);
}

function validateBridgeRequest(input: unknown): PluginBridgeRequest {
  if (!isRecord(input)) {
    throw new PluginBridgeDispatchError(
      "invalid_request",
      "Plugin bridge request must be an object."
    );
  }
  if (typeof input.requestId !== "string" || !input.requestId.trim()) {
    throw new PluginBridgeDispatchError(
      "invalid_request",
      "Plugin bridge requestId must be a non-empty string."
    );
  }
  if (typeof input.method !== "string" || !input.method.trim()) {
    throw new PluginBridgeDispatchError(
      "invalid_request",
      "Plugin bridge method must be a non-empty string."
    );
  }

  return {
    requestId: input.requestId,
    method: input.method,
    ...("params" in input ? { params: input.params } : {}),
  };
}

export async function dispatchPluginBridgeRequest(input: {
  entryToken: string;
  viewId: string;
  request: unknown;
}): Promise<PluginBridgeResponse> {
  let request: PluginBridgeRequest;
  try {
    request = validateBridgeRequest(input.request);
  } catch (error) {
    if (error instanceof PluginBridgeDispatchError) {
      return createBridgeErrorResponse(
        "invalid-request",
        error.code,
        error.message,
        error.details
      );
    }
    throw error;
  }

  try {
    const resolved = await pluginBridgeDependencies.resolveHostedPluginView({
      entryToken: input.entryToken,
      viewId: input.viewId,
    });

    if (!resolved.ok) {
      return createBridgeErrorResponse(
        request.requestId,
        resolved.status === 404 ? "not_found" : "runtime_blocked",
        resolved.message
      );
    }

    const method = request.method;
    if (!isPluginBridgeMethod(method)) {
      return createBridgeErrorResponse(
        request.requestId,
        "unknown_method",
        `Plugin bridge method '${method}' is not supported.`
      );
    }

    const supportedMethods = new Set(getSupportedPluginBridgeMethods(resolved.plugin));
    if (!supportedMethods.has(method)) {
      return createBridgeErrorResponse(
        request.requestId,
        "capability_not_granted",
        `Plugin bridge method '${method}' is not available for this plugin.`
      );
    }

    const result = await PLUGIN_BRIDGE_METHODS[method].handler({
      plugin: resolved.plugin,
      params: request.params,
    });
    return {
      requestId: request.requestId,
      ok: true,
      result,
    };
  } catch (error) {
    if (error instanceof PluginBridgeDispatchError) {
      return createBridgeErrorResponse(
        request.requestId,
        error.code,
        error.message,
        error.details
      );
    }

    return createBridgeErrorResponse(
      request.requestId,
      "internal_error",
      error instanceof Error ? error.message : "Plugin bridge request failed."
    );
  }
}
