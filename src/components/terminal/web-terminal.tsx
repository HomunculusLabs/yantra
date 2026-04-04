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
  ptyWebSocketUrl: string;
  eventsWebSocketUrl?: string;
}

function replacePastedTextNotice(output: string, displayPrompt?: string) {
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
  const onCloseRef = useRef(onClose);
  const displayPromptRef = useRef(displayPrompt);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    displayPromptRef.current = displayPrompt;
  }, [displayPrompt]);

  useEffect(() => {
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let ws: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let disposed = false;
    let initialFitFrame: number | null = null;
    let resizeFrame: number | null = null;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      const { Unicode11Addon } = await import("@xterm/addon-unicode11");

      await import("@xterm/xterm/css/xterm.css");

      if (disposed) return;

      const safeFit = () => {
        const container = termRef.current;
        if (
          disposed ||
          !terminal ||
          !fitAddonRef.current ||
          !container ||
          !container.isConnected ||
          container.clientWidth < 2 ||
          container.clientHeight < 2
        ) {
          return false;
        }

        try {
          fitAddonRef.current.fit();
          return true;
        } catch {
          return false;
        }
      };

      const applyTerminalTheme = () => {
        if (!terminal) return;
        terminal.options.theme = getTerminalTheme(
          document.documentElement.classList.contains("dark")
        );
      };

      const sendResize = () => {
        if (!terminal || ws?.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          })
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
      terminal.loadAddon(new WebLinksAddon());

      const unicode11Addon = new Unicode11Addon();
      terminal.loadAddon(unicode11Addon);
      terminal.unicode.activeVersion = "11";

      xtermRef.current = terminal;

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

            const wsUrl = `${auth.ptyWebSocketUrl}?${params.toString()}`;

            ws = new WebSocket(wsUrl);
            wsRef.current = ws;
            ws.binaryType = "arraybuffer";

            ws.onopen = () => {
              if (disposed) return;
              setError(null);
              safeFit();
              sendResize();
            };

            ws.onmessage = (event) => {
              if (disposed || !terminal) return;
              if (event.data instanceof ArrayBuffer) {
                terminal.write(new Uint8Array(event.data));
              } else {
                terminal.write(
                  replacePastedTextNotice(event.data, displayPromptRef.current)
                );
              }
            };

            ws.onerror = () => {
              if (disposed) return;
              setError("Connection failed. Is the daemon running?");
              terminal?.write(
                "\r\n\x1b[31mConnection error.\x1b[0m Start Yantra with \x1b[33mbun run dev\x1b[0m or restart the desktop app.\r\n"
              );
            };

            ws.onclose = () => {
              if (disposed) return;
              terminal?.write("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
              onCloseRef.current?.();
            };
          } catch {
            if (disposed) return;
            setError("Connection failed. Is the daemon running?");
            terminal?.write(
              "\r\n\x1b[31mConnection error.\x1b[0m Start Yantra with \x1b[33mbun run dev\x1b[0m or restart the desktop app.\r\n"
            );
          }
        })();

        terminal.onData((data) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });
      }

      if (termRef.current) {
        terminal.open(termRef.current);
        initialFitFrame = window.requestAnimationFrame(() => {
          if (disposed) return;
          safeFit();
          connectWebSocket();
        });

        resizeObserver = new ResizeObserver(() => {
          if (disposed) return;
          if (resizeFrame !== null) {
            window.cancelAnimationFrame(resizeFrame);
          }
          resizeFrame = window.requestAnimationFrame(() => {
            resizeFrame = null;
            if (safeFit()) {
              sendResize();
            }
          });
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
    };

    init();

    return () => {
      disposed = true;
      if (initialFitFrame !== null) {
        window.cancelAnimationFrame(initialFitFrame);
      }
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      ws?.close();
      terminal?.dispose();
      wsRef.current = null;
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, prompt, reconnect]);

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
