import { buildRuntimeSettingsSummary } from "@/lib/agents/runtime-summary";
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
import { readPage } from "@/lib/storage/page-io";
import { isRuntimeVirtualPath } from "@/lib/storage/path-utils";
import { buildTree } from "@/lib/storage/tree-builder";
import type { TreeNode, PageData } from "@/types";
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
  buildRuntimeSettingsSummary,
  mergePluginSettingsWithDefaults,
  resolveHostedPluginView,
  validatePluginSettingsPayload,
  savePluginStateRecord,
  readPage,
  buildTree,
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
  return value in PLUGIN_BRIDGE_METHODS;
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

function parsePageReadParams(params: unknown): { path: string } {
  if (!isRecord(params) || typeof params.path !== "string") {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.read requires a params object with a string path."
    );
  }

  const nextPath = params.path.trim();
  if (!nextPath) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.read path must be a non-empty string."
    );
  }
  if (nextPath.includes("\u0000") || nextPath.startsWith("/")) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.read path is invalid."
    );
  }
  if (isRuntimeVirtualPath(nextPath)) {
    throw new PluginBridgeDispatchError(
      "invalid_params",
      "page.read cannot access runtime-prefixed paths in phase 1."
    );
  }

  return { path: nextPath };
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
};

export function getSupportedPluginBridgeMethods(
  plugin: HostedPlugin
): PluginBridgeMethod[] {
  return (Object.entries(PLUGIN_BRIDGE_METHODS) as Array<
    [PluginBridgeMethod, (typeof PLUGIN_BRIDGE_METHODS)[PluginBridgeMethod]]
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
