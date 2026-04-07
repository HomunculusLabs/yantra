import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getSupportedPluginBridgeMethods } from "@/lib/plugins/plugin-bridge";
import { resolveHostedPluginView } from "@/lib/plugins/plugin-manager";

type RouteParams = {
  params: Promise<{
    entryKey: string;
    viewId: string;
  }>;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderErrorDocument(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #09090b;
        color: #e4e4e7;
        font: 14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
      }
      .panel {
        max-width: 560px;
        padding: 20px;
        border: 1px solid rgba(244, 63, 94, 0.3);
        border-radius: 12px;
        background: rgba(244, 63, 94, 0.08);
      }
      h1 { margin: 0 0 8px; font-size: 16px; }
      p { margin: 0; color: #f1f5f9; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </body>
</html>`;
}

function getHostDocumentCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "frame-src 'self'",
    "img-src 'none'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

function encodeAssetPath(relativePath: string): string {
  return relativePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { entryKey: entryToken, viewId } = await params;
  const resolved = await resolveHostedPluginView({ entryToken, viewId });

  if (!resolved.ok) {
    return new NextResponse(
      renderErrorDocument("Plugin view unavailable", resolved.message),
      {
        status: resolved.status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": getHostDocumentCsp(),
        },
      }
    );
  }

  const channelId = randomUUID();
  const pluginAssetUrl = `/api/plugins/runtime/${encodeURIComponent(entryToken)}/assets/${encodeAssetPath(resolved.view.entry)}`;
  const bridgeUrl = `/api/plugins/runtime/${encodeURIComponent(entryToken)}/bridge/${encodeURIComponent(viewId)}`;
  const supportedMethods = getSupportedPluginBridgeMethods(resolved.plugin);
  const bootPayload = JSON.stringify({
    channel: "yantra-plugin",
    protocolVersion: 1,
    channelId,
    plugin: {
      id: resolved.plugin.manifest.id,
      name: resolved.plugin.manifest.name,
      version: resolved.plugin.manifest.version,
    },
    view: {
      id: resolved.view.id,
      title: resolved.view.title,
    },
    grantedCapabilities: resolved.plugin.state.grantedCapabilities,
    supportedMethods,
    pluginAssetUrl,
    bridgeUrl,
  });

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(resolved.plugin.manifest.name)} · ${escapeHtml(resolved.view.title)}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #09090b;
      }
      #runtime-frame {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <iframe id="runtime-frame" title=${JSON.stringify(resolved.view.title)} sandbox="allow-scripts"></iframe>
    <script>
      const boot = ${bootPayload};
      const runtimeFrame = document.getElementById('runtime-frame');
      let hasInitialized = false;

      function send(message) {
        if (!runtimeFrame || !runtimeFrame.contentWindow) return;
        runtimeFrame.contentWindow.postMessage(message, '*');
      }

      window.addEventListener('message', (event) => {
        if (!runtimeFrame || event.source !== runtimeFrame.contentWindow) {
          return;
        }

        const data = event.data;
        if (!data || typeof data !== 'object' || data.channel !== 'yantra-plugin') {
          return;
        }

        if (data.type === 'plugin.ready') {
          hasInitialized = true;
          send({
            channel: 'yantra-plugin',
            type: 'host.init',
            channelId: boot.channelId,
            protocolVersion: boot.protocolVersion,
            plugin: boot.plugin,
            view: boot.view,
            grantedCapabilities: boot.grantedCapabilities,
            supportedMethods: boot.supportedMethods,
          });
          return;
        }

        if (data.type === 'plugin.rpc.request') {
          if (!hasInitialized || data.channelId !== boot.channelId) {
            return;
          }
          if (typeof data.requestId !== 'string' || typeof data.method !== 'string') {
            send({
              channel: 'yantra-plugin',
              type: 'host.rpc.response',
              channelId: boot.channelId,
              requestId: typeof data.requestId === 'string' ? data.requestId : 'invalid-request',
              ok: false,
              error: {
                code: 'invalid_request',
                message: 'Plugin RPC requests must include string requestId and method fields.',
              },
            });
            return;
          }

          fetch(boot.bridgeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Yantra-Plugin-Bridge': '1',
            },
            body: JSON.stringify({
              requestId: data.requestId,
              method: data.method,
              params: data.params,
            }),
          })
            .then(async (response) => {
              const payload = await response.json();
              if (!payload || typeof payload !== 'object' || payload.requestId !== data.requestId || typeof payload.ok !== 'boolean') {
                throw new Error('Invalid plugin bridge response.');
              }

              send({
                channel: 'yantra-plugin',
                type: 'host.rpc.response',
                channelId: boot.channelId,
                ...payload,
              });
            })
            .catch(() => {
              send({
                channel: 'yantra-plugin',
                type: 'host.rpc.response',
                channelId: boot.channelId,
                requestId: data.requestId,
                ok: false,
                error: {
                  code: 'internal_error',
                  message: 'Plugin host bridge request failed.',
                },
              });
            });
        }
      });

      runtimeFrame.src = boot.pluginAssetUrl;
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": getHostDocumentCsp(),
    },
  });
}
