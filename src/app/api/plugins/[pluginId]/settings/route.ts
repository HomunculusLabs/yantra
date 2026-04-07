import { NextRequest, NextResponse } from "next/server";
import {
  getInstalledPluginById,
  mergePluginSettingsWithDefaults,
  validatePluginSettingsPayload,
} from "@/lib/plugins/plugin-manager";
import { savePluginStateRecord } from "@/lib/plugins/plugin-state-store";

function hasBlockingPluginIssue(
  plugin: Awaited<ReturnType<typeof getInstalledPluginById>>
): boolean {
  return Boolean(plugin?.issues.some((issue) => issue.severity === "error"));
}

export async function GET(
  _req: NextRequest,
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

    return NextResponse.json({
      pluginId,
      settings: mergePluginSettingsWithDefaults(plugin.manifest, plugin.state.settings),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read plugin settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
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

    const body = await req.json();
    const validation = validatePluginSettingsPayload(plugin.manifest, body);
    if (validation.issues.length > 0) {
      return NextResponse.json(
        { error: "Plugin settings payload is invalid.", details: validation.issues },
        { status: 400 }
      );
    }

    await savePluginStateRecord(pluginId, {
      ...plugin.state,
      settings: validation.settings,
    });

    const refreshed = await getInstalledPluginById(pluginId);
    if (!refreshed?.manifest) {
      return NextResponse.json({ error: `Plugin '${pluginId}' could not be reloaded.` }, { status: 500 });
    }

    return NextResponse.json({
      pluginId,
      settings: mergePluginSettingsWithDefaults(refreshed.manifest, refreshed.state.settings),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save plugin settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
