"use client";

import { useEffect, useRef, useState } from "react";

interface WebTerminalProps {
  sessionId?: string;
  prompt?: string;
  displayPrompt?: string;
  reconnect?: boolean;  // If true, connect without sending prompt (session already exists on server)
  onClose: () => void;
}

interface DaemonAuthPayload {
  token: string;
}

function replacePastedTextNotice(output: string, displayPrompt?: string): string {
  if (!displayPrompt) return output;
  return output.replace(/\[Pasted text #\d+(?: \+\d+ lines)?\]/g, displayPrompt);
}

function getTerminalTheme(isDark: boolean) {
  return isDark
    ? {
        background: "#231c16",
        foreground: "#f1e7d7",
        cursor: "#e0c28f",
        cursorAccent: "#231c16",
        selectionBackground: "#c8a97744",
        selectionForeground: "#fff7eb",
        black: "#3a3026",
        red: "#f28b82",
        green: "#a7d28d",
        yellow: "#e8c07d",
        blue: "#98b8e8",
        magenta: "#c7a4dd",
        cyan: "#8fc5c0",
        white: "#f1e7d7",
        brightBlack: "#8b7660",
        brightRed: "#ffb4ab",
        brightGreen: "#c6e6b5",
        brightYellow: "#f3d7a5",
        brightBlue: "#c1d7f5",
        brightMagenta: "#dec4ef",
        brightCyan: "#b7e1dc",
        brightWhite: "#fffaf3",
      }
    : {
        background: "#f6efe2",
        foreground: "#4f3d2b",
        cursor: "#8a623d",
        cursorAccent: "#f6efe2",
        selectionBackground: "#d8c4a180",
        selectionForeground: "#3f3021",
        black: "#5d4b38",
        red: "#b85c4c",
        green: "#5e7f4f",
        yellow: "#9a6e2c",
        blue: "#5a79a5",
        magenta: "#8260a6",
        cyan: "#4f7f7a",
        white: "#f6efe2",
        brightBlack: "#8d7a66",
        brightRed: "#cf7a69",
        brightGreen: "#7e9f69",
        brightYellow: "#bb8d46",
        brightBlue: "#7a98c3",
        brightMagenta: "#9f7fbe",
        brightCyan: "#6e9e99",
        brightWhite: "#fffaf2",
      };
}

export function WebTerminal({
  sessionId,
  prompt,
  displayPrompt,
  reconnect,
  onClose,
}: WebTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let ws: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let disposed = false;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      const { Unicode11Addon } = await import("@xterm/addon-unicode11");

      // Import CSS
      await import("@xterm/xterm/css/xterm.css");

      if (disposed) return;

      const applyTerminalTheme = () => {
        if (!terminal) return;
        terminal.options.theme = getTerminalTheme(
          document.documentElement.classList.contains("dark")
        );
      };

      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily:
          "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.2,
        letterSpacing: 0,
        theme: getTerminalTheme(document.documentElement.classList.contains("dark")),
        scrollback: 10000,
        allowProposedApi: true,
        convertEol: false,
        altClickMovesCursor: true,
        drawBoldTextInBrightColors: true,
        minimumContrastRatio: 1,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      fitAddonRef.current = fitAddon;

      // Enable clickable links in output
      terminal.loadAddon(new WebLinksAddon());

      // Enable Unicode 11 for better emoji/icon rendering
      const unicode11Addon = new Unicode11Addon();
      terminal.loadAddon(unicode11Addon);
      terminal.unicode.activeVersion = "11";

      xtermRef.current = terminal;

      if (termRef.current) {
        terminal.open(termRef.current);

        // Initial fit after a tick (ensures DOM is ready)
        requestAnimationFrame(() => {
          if (!disposed) {
            fitAddon.fit();
            connectWebSocket();
          }
        });

        // Handle resize
        resizeObserver = new ResizeObserver(() => {
          if (!disposed) {
            requestAnimationFrame(() => {
              if (!disposed) {
                fitAddon.fit();
                if (ws?.readyState === WebSocket.OPEN && terminal) {
                  ws.send(
                    JSON.stringify({
                      type: "resize",
                      cols: terminal.cols,
                      rows: terminal.rows,
                    })
                  );
                }
              }
            });
          }
        });
        resizeObserver.observe(termRef.current);
      }

      themeObserver = new MutationObserver(() => {
        if (!disposed) {
          applyTerminalTheme();
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-custom-theme"],
      });

      function connectWebSocket() {
        if (disposed || !terminal) return;

        void (async () => {
          const id = sessionId || `session-${Date.now()}`;

          try {
            const authResponse = await fetch("/api/daemon/auth");
            if (!authResponse.ok) {
              throw new Error(`Auth failed (${authResponse.status})`);
            }

            const auth = (await authResponse.json()) as DaemonAuthPayload;
            const params = new URLSearchParams({ id, token: auth.token });
            if (prompt && !reconnect) params.set("prompt", prompt);

            const isLocalDev =
              (window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1") &&
              window.location.port === "3000";
            const protocol = isLocalDev
              ? "ws"
              : window.location.protocol === "https:"
                ? "wss"
                : "ws";
            const host = isLocalDev ? "127.0.0.1:3001" : window.location.host;
            const wsUrl = `${protocol}://${host}/api/daemon/pty?${params.toString()}`;

            ws = new WebSocket(wsUrl);
            wsRef.current = ws;
            ws.binaryType = "arraybuffer";

            ws.onopen = () => {
              if (disposed) return;
              setError(null);
              if (terminal) {
                ws?.send(
                  JSON.stringify({
                    type: "resize",
                    cols: terminal.cols,
                    rows: terminal.rows,
                  })
                );
              }
            };

            ws.onmessage = (event) => {
              if (disposed || !terminal) return;
              if (event.data instanceof ArrayBuffer) {
                terminal.write(new Uint8Array(event.data));
              } else {
                terminal.write(replacePastedTextNotice(event.data, displayPrompt));
              }
            };

            ws.onerror = () => {
              if (disposed) return;
              setError("Connection failed. Is the daemon running?");
              terminal?.write(
                "\r\n\x1b[31mConnection error.\x1b[0m Run \x1b[33mnpm run dev:all\x1b[0m to start Cabinet locally.\r\n"
              );
            };

            ws.onclose = () => {
              if (disposed) return;
              terminal?.write("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
              onClose?.();
            };
          } catch {
            setError("Connection failed. Is the daemon running?");
            terminal?.write(
              "\r\n\x1b[31mConnection error.\x1b[0m Run \x1b[33mnpm run dev:all\x1b[0m to start Cabinet locally.\r\n"
            );
          }
        })();

        terminal.onData((data) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });
      }
    };

    init();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      ws?.close();
      terminal?.dispose();
      wsRef.current = null;
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, prompt, displayPrompt, reconnect, onClose]);

  return (
    <div className="h-full w-full relative overflow-hidden bg-card/80">
      {error && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 bg-destructive/90 text-destructive-foreground text-xs rounded-md">
          {error}
        </div>
      )}
      <div
        ref={termRef}
        className="h-full w-full overflow-hidden"
        style={{ padding: "4px 8px" }}
      />
    </div>
  );
}
