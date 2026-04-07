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

      function sendRpcResponse(payload) {
        send({
          channel: 'yantra-plugin',
          type: 'host.rpc.response',
          channelId: boot.channelId,
          ...payload,
        });
      }

      function invalidParamsResponse(requestId, message) {
        sendRpcResponse({
          requestId,
          ok: false,
          error: {
            code: 'invalid_params',
            message,
          },
        });
      }

      async function readDaemonHealth() {
        const desktopBridge = window.yantraDesktop;
        if (!desktopBridge || typeof desktopBridge.getDaemonControlInfo !== 'function') {
          throw new Error('Desktop daemon info is unavailable in this runtime.');
        }

        const info = await desktopBridge.getDaemonControlInfo();
        if (!info.healthUrl) {
          return {
            available: Boolean(info.available),
            managed: Boolean(info.managed),
            ready: Boolean(info.ready),
            restarting: Boolean(info.restarting),
            restartingMode: info.restartingMode ?? null,
            reachable: false,
            health: null,
            error: 'Daemon health URL is unavailable.',
          };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        try {
          const response = await fetch(info.healthUrl, {
            signal: controller.signal,
            cache: 'no-store',
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload || payload.status !== 'ok') {
            throw new Error(
              payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
                ? payload.error
                : 'Daemon health check failed (' + response.status + ').'
            );
          }

          return {
            available: Boolean(info.available),
            managed: Boolean(info.managed),
            ready: Boolean(info.ready),
            restarting: Boolean(info.restarting),
            restartingMode: info.restartingMode ?? null,
            reachable: true,
            health: payload,
            error: null,
          };
        } catch (error) {
          return {
            available: Boolean(info.available),
            managed: Boolean(info.managed),
            ready: Boolean(info.ready),
            restarting: Boolean(info.restarting),
            restartingMode: info.restartingMode ?? null,
            reachable: false,
            health: null,
            error: error instanceof Error ? error.message : 'Daemon health check failed.',
          };
        } finally {
          clearTimeout(timeout);
        }
      }

      async function handleHostBridgeRequest(data) {
        const desktopBridge = window.yantraDesktop;
        if (data.method === 'desktop.selectDirectory') {
          if (!desktopBridge || typeof desktopBridge.selectDirectory !== 'function') {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'runtime_blocked',
                message: 'Desktop directory picker is unavailable in this runtime.',
              },
            });
            return true;
          }

          const params = data.params;
          if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
            invalidParamsResponse(data.requestId, 'desktop.selectDirectory requires an object when params are provided.');
            return true;
          }

          const options = {};
          if (params && 'title' in params) {
            if (typeof params.title !== 'string') {
              invalidParamsResponse(data.requestId, 'desktop.selectDirectory title must be a string when provided.');
              return true;
            }
            options.title = params.title;
          }
          if (params && 'defaultPath' in params) {
            if (typeof params.defaultPath !== 'string') {
              invalidParamsResponse(data.requestId, 'desktop.selectDirectory defaultPath must be a string when provided.');
              return true;
            }
            options.defaultPath = params.defaultPath;
          }

          try {
            const selectedPath = await desktopBridge.selectDirectory(options);
            sendRpcResponse({
              requestId: data.requestId,
              ok: true,
              result: selectedPath,
            });
          } catch (error) {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'internal_error',
                message: error instanceof Error ? error.message : 'Desktop directory picker failed.',
              },
            });
          }

          return true;
        }

        if (data.method === 'desktop.reloadKeybindings') {
          if (!desktopBridge || typeof desktopBridge.reloadKeybindings !== 'function') {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'runtime_blocked',
                message: 'Desktop keybinding reload is unavailable in this runtime.',
              },
            });
            return true;
          }

          if (data.params !== undefined) {
            invalidParamsResponse(
              data.requestId,
              'desktop.reloadKeybindings does not accept params.'
            );
            return true;
          }

          try {
            const result = await desktopBridge.reloadKeybindings();
            sendRpcResponse({
              requestId: data.requestId,
              ok: true,
              result,
            });
          } catch (error) {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'internal_error',
                message: error instanceof Error ? error.message : 'Desktop keybinding reload failed.',
              },
            });
          }

          return true;
        }

        if (data.method === 'daemon.health.read') {
          if (data.params !== undefined) {
            invalidParamsResponse(
              data.requestId,
              'daemon.health.read does not accept params.'
            );
            return true;
          }

          try {
            const result = await readDaemonHealth();
            sendRpcResponse({
              requestId: data.requestId,
              ok: true,
              result,
            });
          } catch (error) {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'internal_error',
                message: error instanceof Error ? error.message : 'Daemon health request failed.',
              },
            });
          }

          return true;
        }

        if (data.method === 'desktop.restartDaemon') {
          if (!desktopBridge || typeof desktopBridge.restartDaemon !== 'function') {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'runtime_blocked',
                message: 'Desktop daemon restart is unavailable in this runtime.',
              },
            });
            return true;
          }

          const params = data.params;
          if (!params || typeof params !== 'object' || Array.isArray(params)) {
            invalidParamsResponse(
              data.requestId,
              'desktop.restartDaemon requires an object with a mode field.'
            );
            return true;
          }
          if (!('mode' in params) || (params.mode !== 'soft' && params.mode !== 'force')) {
            invalidParamsResponse(
              data.requestId,
              'desktop.restartDaemon mode must be \"soft\" or \"force\".'
            );
            return true;
          }

          try {
            const result = await desktopBridge.restartDaemon(params.mode);
            sendRpcResponse({
              requestId: data.requestId,
              ok: true,
              result,
            });
          } catch (error) {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'internal_error',
                message: error instanceof Error ? error.message : 'Desktop daemon restart failed.',
              },
            });
          }

          return true;
        }

        if (data.method === 'daemon.session.read') {
          if (data.params !== undefined) {
            invalidParamsResponse(
              data.requestId,
              'daemon.session.read does not accept params.'
            );
            return true;
          }

          try {
            const response = await fetch('/api/daemon/sessions', {
              cache: 'no-store',
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(
                payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
                  ? payload.error
                  : 'Daemon session list failed (' + response.status + ').'
              );
            }

            sendRpcResponse({
              requestId: data.requestId,
              ok: true,
              result: payload,
            });
          } catch (error) {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'internal_error',
                message: error instanceof Error ? error.message : 'Daemon session list failed.',
              },
            });
          }

          return true;
        }

        if (data.method === 'daemon.session.create') {
          const params = data.params;
          if (!params || typeof params !== 'object' || Array.isArray(params)) {
            invalidParamsResponse(
              data.requestId,
              'daemon.session.create requires an object payload.'
            );
            return true;
          }

          const prompt =
            typeof params.prompt === 'string' ? params.prompt.trim() : '';
          if (!prompt) {
            invalidParamsResponse(
              data.requestId,
              'daemon.session.create requires a non-empty string prompt.'
            );
            return true;
          }

          const payload = {
            prompt,
            agentSlug:
              typeof params.agentSlug === 'string' && params.agentSlug.trim()
                ? params.agentSlug.trim()
                : 'general',
          };

          if ('sessionId' in params) {
            if (typeof params.sessionId !== 'string' || !params.sessionId.trim()) {
              invalidParamsResponse(
                data.requestId,
                'daemon.session.create sessionId must be a non-empty string when provided.'
              );
              return true;
            }
            payload.sessionId = params.sessionId.trim();
          }

          if ('cwd' in params) {
            if (typeof params.cwd !== 'string' || !params.cwd.trim()) {
              invalidParamsResponse(
                data.requestId,
                'daemon.session.create cwd must be a non-empty string when provided.'
              );
              return true;
            }
            payload.cwd = params.cwd.trim();
          }

          if ('timeoutSeconds' in params) {
            if (typeof params.timeoutSeconds !== 'number' || !Number.isFinite(params.timeoutSeconds)) {
              invalidParamsResponse(
                data.requestId,
                'daemon.session.create timeoutSeconds must be a finite number when provided.'
              );
              return true;
            }
            payload.timeoutSeconds = params.timeoutSeconds;
          }

          try {
            const response = await fetch('/api/daemon/sessions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(
                result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
                  ? result.error
                  : 'Daemon session create failed (' + response.status + ').'
              );
            }

            sendRpcResponse({
              requestId: data.requestId,
              ok: true,
              result,
            });
          } catch (error) {
            sendRpcResponse({
              requestId: data.requestId,
              ok: false,
              error: {
                code: 'internal_error',
                message: error instanceof Error ? error.message : 'Daemon session create failed.',
              },
            });
          }

          return true;
        }

        return false;
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
            sendRpcResponse({
              requestId: typeof data.requestId === 'string' ? data.requestId : 'invalid-request',
              ok: false,
              error: {
                code: 'invalid_request',
                message: 'Plugin RPC requests must include string requestId and method fields.',
              },
            });
            return;
          }

          const handledByHost = await handleHostBridgeRequest(data);
          if (handledByHost) {
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
              sendRpcResponse({
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
