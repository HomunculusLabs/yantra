import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ensureRuntimeRootExists, getYantraRoots } from "@/lib/config/yantra-roots";

const DAEMON_RUNTIME_DIR = getYantraRoots().runtimeDaemonRoot;
const DAEMON_TOKEN_PATH = path.join(DAEMON_RUNTIME_DIR, "daemon-token");

let cachedToken: string | null = null;

export function getDaemonUrl(): string {
  return process.env.YANTRA_DAEMON_URL || "http://127.0.0.1:3001";
}

function toWebSocketOrigin(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}

function sameOriginWebSocketUrl(
  protocol: "http" | "https",
  host: string,
  pathName: string
): string {
  const wsProtocol = protocol === "https" ? "wss" : "ws";
  return `${wsProtocol}://${host}${pathName}`;
}

export function getPublicDaemonEndpoints(input?: {
  requestOrigin?: string;
  requestHost?: string;
  requestProtocol?: "http" | "https";
}): {
  ptyWebSocketUrl: string;
  eventsWebSocketUrl: string;
} {
  const publicOrigin = process.env.YANTRA_DAEMON_PUBLIC_ORIGIN?.trim();
  const host = input?.requestHost?.trim() || "";
  const protocol = input?.requestProtocol || "http";

  if (publicOrigin) {
    const base = toWebSocketOrigin(publicOrigin);
    return {
      ptyWebSocketUrl: `${base}/api/daemon/pty`,
      eventsWebSocketUrl: `${base}/api/daemon/events`,
    };
  }

  const isLocalNextHost =
    host === "localhost:3000" || host === "127.0.0.1:3000";

  if (isLocalNextHost) {
    const daemonUrl = new URL(getDaemonUrl());
    const base = toWebSocketOrigin(daemonUrl.toString());
    return {
      ptyWebSocketUrl: `${base}/api/daemon/pty`,
      eventsWebSocketUrl: `${base}/api/daemon/events`,
    };
  }

  return {
    ptyWebSocketUrl: sameOriginWebSocketUrl(protocol, host, "/api/daemon/pty"),
    eventsWebSocketUrl: sameOriginWebSocketUrl(protocol, host, "/api/daemon/events"),
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function getOrCreateDaemonTokenSync(): string {
  if (cachedToken) {
    return cachedToken;
  }

  const envToken = process.env.YANTRA_DAEMON_TOKEN?.trim();
  if (envToken) {
    cachedToken = envToken;
    return envToken;
  }

  ensureRuntimeRootExists();
  fs.mkdirSync(DAEMON_RUNTIME_DIR, { recursive: true });

  if (fs.existsSync(DAEMON_TOKEN_PATH)) {
    const existing = fs.readFileSync(DAEMON_TOKEN_PATH, "utf8").trim();
    if (existing) {
      cachedToken = existing;
      return existing;
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  try {
    const fd = fs.openSync(DAEMON_TOKEN_PATH, "wx", 0o600);
    fs.writeFileSync(fd, `${token}\n`, { encoding: "utf8" });
    fs.closeSync(fd);
    cachedToken = token;
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }

    const existing = fs.readFileSync(DAEMON_TOKEN_PATH, "utf8").trim();
    if (!existing) {
      throw new Error("Daemon token file exists but is empty.");
    }
    cachedToken = existing;
    return existing;
  }
}

export async function getOrCreateDaemonToken(): Promise<string> {
  return getOrCreateDaemonTokenSync();
}

export function getTokenFromAuthorizationHeader(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function isDaemonTokenValid(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  return safeEqual(candidate, getOrCreateDaemonTokenSync());
}
