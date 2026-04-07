import { beforeEach, describe, expect, mock, test } from "bun:test";

let getLauncherRegistryReadResponseImpl: () => Promise<unknown> = async () => ({
  registry: { version: 1, defaultLauncherId: "claude-code", launchers: {} },
  availableLaunchers: [],
  overlayIssues: [],
});
let validateLauncherRegistryConfigImpl: (input: unknown) => {
  config: unknown;
  issues: Array<{ path: string; message: string }>;
} = (input) => ({ config: input, issues: [] });
const saveLauncherRegistryCalls: unknown[] = [];
const validateLauncherRegistryConfigCalls: unknown[] = [];

mock.module("@/lib/agents/launcher-manager", () => ({
  getLauncherRegistryReadResponse: async () => getLauncherRegistryReadResponseImpl(),
  validateLauncherRegistryConfig: (input: unknown) => {
    validateLauncherRegistryConfigCalls.push(input);
    return validateLauncherRegistryConfigImpl(input);
  },
  saveLauncherRegistry: async (config: unknown) => {
    saveLauncherRegistryCalls.push(config);
  },
}));

const { GET, PUT } = await import("@/app/api/agents/config/launchers/route");

beforeEach(() => {
  getLauncherRegistryReadResponseImpl = async () => ({
    registry: { version: 1, defaultLauncherId: "claude-code", launchers: {} },
    availableLaunchers: [],
    overlayIssues: [],
  });
  validateLauncherRegistryConfigImpl = (input) => ({ config: input, issues: [] });
  saveLauncherRegistryCalls.length = 0;
  validateLauncherRegistryConfigCalls.length = 0;
});

describe("/api/agents/config/launchers phase 4", () => {
  test("GET returns the base registry plus effective catalog metadata", async () => {
    getLauncherRegistryReadResponseImpl = async () => ({
      registry: { version: 1, defaultLauncherId: "claude-code", launchers: {} },
      availableLaunchers: [
        {
          id: "@plugin/acme-tools/opus",
          label: "Acme Opus",
          readOnly: true,
          source: {
            kind: "plugin",
            pluginId: "acme-tools",
            pluginName: "Acme Tools",
            localId: "opus",
          },
        },
      ],
      overlayIssues: [
        {
          pluginId: "broken-tools",
          pluginName: "Broken Tools",
          message: "Launcher overlay version must be 1.",
        },
      ],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      registry: { version: 1, defaultLauncherId: "claude-code", launchers: {} },
      availableLaunchers: [
        {
          id: "@plugin/acme-tools/opus",
          label: "Acme Opus",
          readOnly: true,
          source: {
            kind: "plugin",
            pluginId: "acme-tools",
            pluginName: "Acme Tools",
            localId: "opus",
          },
        },
      ],
      overlayIssues: [
        {
          pluginId: "broken-tools",
          pluginName: "Broken Tools",
          message: "Launcher overlay version must be 1.",
        },
      ],
    });
  });

  test("PUT unwraps nested registry payloads before validation and save", async () => {
    const payload = {
      registry: {
        version: 1,
        defaultLauncherId: "claude-code",
        launchers: {
          custom: {
            id: "custom",
            label: "Custom",
            command: "custom",
            args: [],
          },
        },
      },
    };

    const response = await PUT(
      new Request("http://localhost/api/agents/config/launchers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(validateLauncherRegistryConfigCalls).toEqual([payload.registry]);
    expect(saveLauncherRegistryCalls).toEqual([payload.registry]);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("PUT preserves validation failures for plugin-owned launcher ids", async () => {
    validateLauncherRegistryConfigImpl = () => ({
      config: { version: 1, defaultLauncherId: "claude-code", launchers: {} },
      issues: [
        {
          path: "launchers.@plugin/acme-tools/opus",
          message:
            "Plugin-contributed launcher ids are read-only and cannot be saved into the owned launcher registry.",
        },
      ],
    });

    const response = await PUT(
      new Request("http://localhost/api/agents/config/launchers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          defaultLauncherId: "claude-code",
          launchers: {
            "@plugin/acme-tools/opus": {
              id: "@plugin/acme-tools/opus",
              label: "Acme Opus",
              command: "acme",
              args: ["chat"],
            },
          },
        }),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(saveLauncherRegistryCalls).toEqual([]);
    expect(await response.json()).toEqual({
      error: "Launcher registry validation failed.",
      details: [
        {
          path: "launchers.@plugin/acme-tools/opus",
          message:
            "Plugin-contributed launcher ids are read-only and cannot be saved into the owned launcher registry.",
        },
      ],
    });
  });
});
