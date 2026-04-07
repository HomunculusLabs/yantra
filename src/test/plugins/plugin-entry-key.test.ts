import { describe, expect, test } from "bun:test";
import {
  getPluginCatalogEntryKey,
  getPluginCatalogEntryToken,
} from "@/lib/plugins/plugin-entry-key";
import type { InstalledPluginSummary } from "@/types/plugins";

function makePluginSummary(overrides?: Partial<InstalledPluginSummary>): InstalledPluginSummary {
  return {
    manifest: {
      id: "sample-plugin",
      name: "Sample Plugin",
      version: "1.0.0",
      apiVersion: 1,
      kind: "ui-sandbox",
      requestedCapabilities: {
        required: [],
        optional: [],
      },
      views: [{ id: "main", title: "Main", slot: "workspace", entry: "index.html" }],
    },
    manifestHash: "hash",
    source: {
      kind: "local-install",
      rootPath: "/tmp/config/plugins",
      pluginPath: "/tmp/config/plugins/sample-plugin",
      readonly: false,
    },
    status: "enabled",
    state: {
      enabled: true,
      trust: "sandboxed",
      grantedCapabilities: [],
      settings: {},
      approvedManifestHash: "hash",
      lastError: null,
      lastEnabledAt: null,
    },
    issues: [],
    ...overrides,
  };
}

describe("plugin entry key helpers", () => {
  test("are deterministic for the same plugin tuple", () => {
    const plugin = makePluginSummary();

    const keyA = getPluginCatalogEntryKey(plugin);
    const keyB = getPluginCatalogEntryKey(plugin);
    const tokenA = getPluginCatalogEntryToken(keyA);
    const tokenB = getPluginCatalogEntryToken(keyB);

    expect(keyA).toBe(keyB);
    expect(tokenA).toBe(tokenB);
  });

  test("different sources produce different keys and tokens even with the same manifest id", () => {
    const local = makePluginSummary();
    const vault = makePluginSummary({
      source: {
        kind: "vault-dev",
        rootPath: "/tmp/vault/.plugins",
        pluginPath: "/tmp/vault/.plugins/sample-plugin",
        readonly: false,
      },
    });

    const localKey = getPluginCatalogEntryKey(local);
    const vaultKey = getPluginCatalogEntryKey(vault);

    expect(localKey === vaultKey).toBe(false);
    expect(getPluginCatalogEntryToken(localKey) === getPluginCatalogEntryToken(vaultKey)).toBe(
      false
    );
  });

  test("tokens are route-safe opaque identifiers", () => {
    const token = getPluginCatalogEntryToken(
      getPluginCatalogEntryKey(makePluginSummary())
    );

    expect(/^pek_[a-f0-9]+$/.test(token)).toBe(true);
    expect(token.includes("/")).toBe(false);
    expect(token.includes("\\")).toBe(false);
    expect(token.includes(":")).toBe(false);
    expect(token.includes("/tmp/")).toBe(false);
  });
});
