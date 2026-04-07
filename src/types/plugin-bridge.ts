import type { PluginCapability } from "@/types/plugins";

export type PluginBridgeMethod =
  | "tree.read"
  | "page.read"
  | "page.create"
  | "page.write"
  | "page.delete"
  | "agents.read"
  | "agent.stack.read"
  | "agent.stack.write"
  | "plugin.settings.read"
  | "plugin.settings.write"
  | "runtime.summary.read";

export type PluginBridgeErrorCode =
  | "invalid_request"
  | "unknown_method"
  | "capability_not_granted"
  | "invalid_params"
  | "not_found"
  | "runtime_blocked"
  | "internal_error";

export interface PluginBridgeRequest {
  requestId: string;
  method: PluginBridgeMethod | string;
  params?: unknown;
}

export type PluginBridgeResponse =
  | {
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      requestId: string;
      ok: false;
      error: {
        code: PluginBridgeErrorCode;
        message: string;
        details?: unknown;
      };
    };

export interface PluginReadyMessage {
  channel: "yantra-plugin";
  type: "plugin.ready";
}

export interface PluginRpcRequestMessage {
  channel: "yantra-plugin";
  type: "plugin.rpc.request";
  channelId: string;
  requestId: string;
  method: PluginBridgeMethod | string;
  params?: unknown;
}

export interface HostInitMessage {
  channel: "yantra-plugin";
  type: "host.init";
  channelId: string;
  protocolVersion: 1;
  plugin: {
    id: string;
    name: string;
    version: string;
  };
  view: {
    id: string;
    title: string;
  };
  grantedCapabilities: PluginCapability[];
  supportedMethods: PluginBridgeMethod[];
}

export type HostRpcResponseMessage = {
  channel: "yantra-plugin";
  type: "host.rpc.response";
  channelId: string;
} & PluginBridgeResponse;

export type PluginRuntimeMessage =
  | PluginReadyMessage
  | PluginRpcRequestMessage
  | HostInitMessage
  | HostRpcResponseMessage;
