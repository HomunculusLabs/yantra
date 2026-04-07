import {
  isRequestJsonError,
  requestJson,
  type RequestJsonError,
} from "@/lib/api/request-json";
import type { InstalledPluginSummary, PluginCapability, PluginIssue } from "@/types/plugins";

export interface PluginSettingsResponse {
  pluginId: string;
  settings: Record<string, unknown>;
}

export async function listPlugins(): Promise<InstalledPluginSummary[]> {
  return requestJson<InstalledPluginSummary[]>("/api/plugins");
}

export async function patchPlugin(
  pluginId: string,
  payload:
    | { approveManifest: true }
    | { enabled: boolean }
    | { grantedCapabilities: PluginCapability[] }
    | { trust: "sandboxed" }
): Promise<InstalledPluginSummary> {
  return requestJson<InstalledPluginSummary>(`/api/plugins/${encodeURIComponent(pluginId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getPluginSettings(pluginId: string): Promise<PluginSettingsResponse> {
  return requestJson<PluginSettingsResponse>(
    `/api/plugins/${encodeURIComponent(pluginId)}/settings`
  );
}

export async function savePluginSettings(
  pluginId: string,
  settings: Record<string, unknown>
): Promise<PluginSettingsResponse> {
  return requestJson<PluginSettingsResponse>(
    `/api/plugins/${encodeURIComponent(pluginId)}/settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }
  );
}

export function getPluginValidationIssues(error: unknown): PluginIssue[] {
  if (!isRequestJsonError(error)) return [];
  const payload = error.payload as RequestJsonError["payload"];
  if (!payload || typeof payload !== "object" || !("details" in payload)) return [];
  if (!Array.isArray(payload.details)) return [];
  return payload.details.filter(
    (detail): detail is PluginIssue =>
      Boolean(
        detail &&
          typeof detail === "object" &&
          "code" in detail &&
          "message" in detail &&
          "severity" in detail
      )
  );
}
