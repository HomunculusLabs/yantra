import { NextRequest, NextResponse } from "next/server";
import {
  CURRENT_PLUGIN_CAPABILITY_PHASE,
  getPluginCapabilityDefinition,
  isPluginCapability,
  isPluginCapabilityAvailable,
} from "@/lib/plugins/plugin-capabilities";
import { getInstalledPluginById } from "@/lib/plugins/plugin-manager";
import { savePluginStateRecord } from "@/lib/plugins/plugin-state-store";
import type { PluginCapability, PluginStateRecord, PluginTrust } from "@/types/plugins";

function hasBlockingPluginIssue(
  plugin: Awaited<ReturnType<typeof getInstalledPluginById>>
): boolean {
  return Boolean(plugin?.issues.some((issue) => issue.severity === "error"));
}

function isPluginTrust(value: unknown): value is PluginTrust {
  return value === "sandboxed" || value === "trusted-local";
}

function validateGrantedCapabilities(
  grantedCapabilities: unknown,
  state: PluginStateRecord,
  requestedCapabilities: PluginCapability[]
): { ok: true; grantedCapabilities: PluginCapability[] } | { ok: false; message: string; status?: number } {
  if (!Array.isArray(grantedCapabilities) || !grantedCapabilities.every((value) => typeof value === "string")) {
    return {
      ok: false,
      message: "grantedCapabilities must be an array of capability strings.",
    };
  }

  const normalized = [...new Set(grantedCapabilities.map((value) => value.trim()).filter(Boolean))];
  for (const capability of normalized) {
    if (!isPluginCapability(capability)) {
      return { ok: false, message: `Unknown plugin capability '${capability}'.` };
    }
    if (!requestedCapabilities.includes(capability)) {
      return {
        ok: false,
        message: `Capability '${capability}' was not requested by this plugin.`,
      };
    }
    if (!isPluginCapabilityAvailable(capability, CURRENT_PLUGIN_CAPABILITY_PHASE)) {
      return {
        ok: false,
        message: `Capability '${capability}' is not supported in ${CURRENT_PLUGIN_CAPABILITY_PHASE}.`,
        status: 409,
      };
    }
    const definition = getPluginCapabilityDefinition(capability);
    if (definition.requiresTrust === "trusted-local" && state.trust !== "trusted-local") {
      return {
        ok: false,
        message: `Capability '${capability}' requires trusted-local trust.`,
        status: 409,
      };
    }
  }

  return {
    ok: true,
    grantedCapabilities: normalized as PluginCapability[],
  };
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ pluginId: string }> }
) {
  const { pluginId } = await context.params;

  try {
    const plugin = await getInstalledPluginById(pluginId);
    if (!plugin) {
      return NextResponse.json({ error: `Plugin '${pluginId}' was not found.` }, { status: 404 });
    }
    if (!plugin.manifest) {
      return NextResponse.json({ error: `Plugin '${pluginId}' has an invalid manifest.` }, { status: 409 });
    }
    if (hasBlockingPluginIssue(plugin)) {
      return NextResponse.json(
        { error: `Plugin '${pluginId}' has blocking validation issues.` },
        { status: 409 }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const operations = ["enabled", "grantedCapabilities", "trust", "approveManifest"] as const;
    const allowedKeys = new Set<string>(operations);
    const unexpectedKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
    if (unexpectedKeys.length > 0) {
      return NextResponse.json(
        { error: `Unexpected plugin mutation keys: ${unexpectedKeys.join(", ")}.` },
        { status: 400 }
      );
    }
    const presentOperations = operations.filter((key) => key in body);
    if (presentOperations.length !== 1) {
      return NextResponse.json(
        { error: "Provide exactly one plugin mutation operation per request." },
        { status: 400 }
      );
    }

    let nextState: PluginStateRecord = { ...plugin.state };
    const requestedCapabilities = [
      ...plugin.manifest.requestedCapabilities.required,
      ...plugin.manifest.requestedCapabilities.optional,
    ];

    if ("trust" in body) {
      if (!isPluginTrust(body.trust)) {
        return NextResponse.json({ error: "trust must be 'sandboxed' or 'trusted-local'." }, { status: 400 });
      }
      if (
        body.trust === "sandboxed" &&
        nextState.grantedCapabilities.some(
          (capability) => getPluginCapabilityDefinition(capability).requiresTrust === "trusted-local"
        )
      ) {
        return NextResponse.json(
          { error: "Sandboxed plugins cannot keep trusted-only capability grants." },
          { status: 409 }
        );
      }
      nextState = { ...nextState, trust: body.trust };
    }

    if ("grantedCapabilities" in body) {
      const validation = validateGrantedCapabilities(
        body.grantedCapabilities,
        nextState,
        requestedCapabilities
      );
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.message },
          { status: validation.status ?? 400 }
        );
      }
      nextState = {
        ...nextState,
        grantedCapabilities: validation.grantedCapabilities,
      };
    }

    if ("approveManifest" in body) {
      if (body.approveManifest !== true) {
        return NextResponse.json(
          { error: "approveManifest must be true when provided." },
          { status: 400 }
        );
      }
      if (!plugin.manifestHash) {
        return NextResponse.json(
          { error: "Current manifest hash is unavailable for approval." },
          { status: 409 }
        );
      }
      nextState = {
        ...nextState,
        approvedManifestHash: plugin.manifestHash,
        grantedCapabilities: nextState.grantedCapabilities.filter((capability) =>
          requestedCapabilities.includes(capability)
        ),
      };
    }

    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
      }
      if (body.enabled) {
        if (!plugin.manifestHash || nextState.approvedManifestHash !== plugin.manifestHash) {
          return NextResponse.json(
            { error: "Plugin manifest must be approved before enabling." },
            { status: 409 }
          );
        }
        const missingRequiredCapabilities = plugin.manifest.requestedCapabilities.required.filter(
          (capability) => !nextState.grantedCapabilities.includes(capability)
        );
        if (missingRequiredCapabilities.length > 0) {
          return NextResponse.json(
            {
              error: `Plugin is missing required granted capabilities: ${missingRequiredCapabilities.join(", ")}.`,
            },
            { status: 409 }
          );
        }
        nextState = {
          ...nextState,
          enabled: true,
          lastEnabledAt: new Date().toISOString(),
          lastError: null,
        };
      } else {
        nextState = {
          ...nextState,
          enabled: false,
        };
      }
    }

    await savePluginStateRecord(pluginId, nextState);
    const refreshed = await getInstalledPluginById(pluginId);
    return NextResponse.json(refreshed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update plugin state";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
