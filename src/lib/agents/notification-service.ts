import path from "path";
import fs from "fs/promises";
import { getCabinetRoots } from "@/lib/config/cabinet-roots";

const CONFIG_FILE = path.join(
  getCabinetRoots().runtimeConfigRoot,
  "integrations.json"
);

interface NotificationConfig {
  notifications: {
    browser_push: boolean;
    telegram: { enabled: boolean; bot_token: string; chat_id: string };
    slack_webhook: { enabled: boolean; url: string };
    email: { enabled: boolean; frequency: string; to: string };
    nextcloud_talk?: {
      enabled: boolean;
      server_url: string;
      username: string;
      app_password: string;
      default_room_token: string;
    };
  };
}

async function loadConfig(): Promise<NotificationConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Send a notification to configured channels.
 */
export async function sendNotification(opts: {
  title: string;
  message: string;
  agentName?: string;
  agentEmoji?: string;
  channel?: string;
  severity?: "info" | "warning" | "critical";
}): Promise<{ sent: string[] }> {
  const config = await loadConfig();
  if (!config) return { sent: [] };

  const sent: string[] = [];
  const { title, message, agentName, agentEmoji, severity } = opts;
  const requestedChannel = opts.channel || "default";
  const shouldSend = (channel: string) =>
    requestedChannel === "default" || requestedChannel === channel;

  // Telegram
  if (config.notifications.telegram?.enabled && shouldSend("telegram")) {
    const { bot_token, chat_id } = config.notifications.telegram;
    if (bot_token && chat_id) {
      try {
        const icon = severity === "critical" ? "\u{1F6A8}" : severity === "warning" ? "\u{26A0}\u{FE0F}" : "\u{1F4E2}";
        const text = [
          `${icon} *${title}*`,
          agentEmoji && agentName ? `${agentEmoji} ${agentName}` : "",
          message,
        ].filter(Boolean).join("\n");

        const res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id,
            text,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          }),
        });
        if (res.ok) sent.push("telegram");
      } catch { /* ignore telegram errors */ }
    }
  }

  // Slack webhook
  if (config.notifications.slack_webhook?.enabled && shouldSend("slack_webhook")) {
    const { url } = config.notifications.slack_webhook;
    if (url) {
      try {
        const icon = severity === "critical" ? ":rotating_light:" : severity === "warning" ? ":warning:" : ":loudspeaker:";
        const text = [
          `${icon} *${title}*`,
          agentEmoji && agentName ? `${agentEmoji} ${agentName}` : "",
          message,
        ].filter(Boolean).join("\n");

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.ok) sent.push("slack_webhook");
      } catch { /* ignore slack errors */ }
    }
  }

  const nextcloud = config.notifications.nextcloud_talk;
  const nextcloudRequested =
    requestedChannel === "nextcloud" || requestedChannel.startsWith("nextcloud:");
  if (nextcloud?.enabled && (requestedChannel === "default" || nextcloudRequested)) {
    const roomToken = requestedChannel.startsWith("nextcloud:")
      ? requestedChannel.slice("nextcloud:".length)
      : nextcloud.default_room_token;

    if (
      nextcloud.server_url &&
      nextcloud.username &&
      nextcloud.app_password &&
      roomToken
    ) {
      try {
        const icon = severity === "critical" ? "🚨" : severity === "warning" ? "⚠️" : "📣";
        const text = [
          `${icon} ${title}`,
          agentEmoji && agentName ? `${agentEmoji} ${agentName}` : "",
          message,
        ].filter(Boolean).join("\n");

        const base = nextcloud.server_url.replace(/\/+$/, "");
        const res = await fetch(
          `${base}/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(roomToken)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
              "OCS-APIRequest": "true",
              Authorization: `Basic ${Buffer.from(
                `${nextcloud.username}:${nextcloud.app_password}`
              ).toString("base64")}`,
            },
            body: new URLSearchParams({ message: text }).toString(),
          }
        );
        if (res.ok) {
          sent.push("nextcloud");
        } else {
          const errorText = await res.text().catch(() => "");
          console.error("Nextcloud Talk notification failed:", res.status, errorText);
        }
      } catch {
        /* ignore nextcloud errors */
      }
    }
  }

  return { sent };
}

/**
 * Check if a Slack message should trigger external notifications.
 * Returns true for #alerts messages and @human mentions.
 */
export function shouldNotify(channel: string, content: string, mentions?: string[]): boolean {
  if (channel === "alerts") return true;
  if (mentions?.includes("human")) return true;
  if (content.includes("@human")) return true;
  return false;
}
