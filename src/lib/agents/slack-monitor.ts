import type { AgentPersona } from "@/types/personas";
import { getLatestMessage } from "@/lib/agents/slack-manager";

const STALE_RESPONSE_MS = 180_000;
const respondingAgents = new Map<string, { channel: string; since: number }>();

function cleanupRespondingAgents(now = Date.now()) {
  for (const [slug, info] of respondingAgents) {
    if (now - info.since > STALE_RESPONSE_MS) {
      respondingAgents.delete(slug);
    }
  }
}

export function markAgentResponding(slug: string, channel: string): void {
  respondingAgents.set(slug, { channel, since: Date.now() });
}

export function clearAgentResponding(slug: string): void {
  respondingAgents.delete(slug);
}

export function listRespondingAgents(): Map<string, { channel: string; since: number }> {
  cleanupRespondingAgents();
  return new Map(respondingAgents);
}

export function buildRespondingAgentPayload(
  personas: AgentPersona[],
  responding = listRespondingAgents()
): Array<{ slug: string; channel: string; emoji: string; name: string }> {
  return [...responding.entries()].map(([slug, info]) => {
    const persona = personas.find((candidate) => candidate.slug === slug);
    return {
      slug,
      channel: info.channel,
      emoji: persona?.emoji || "",
      name: persona?.name || slug,
    };
  });
}

export async function detectSlackActivity(
  channels: string[],
  previousCursor: Record<string, string | null>
): Promise<{
  nextCursor: Record<string, string | null>;
  events: Array<{
    channel: string;
    hasHumanMention?: boolean;
    agentName?: string;
    agentEmoji?: string;
    preview?: string;
  }>;
}> {
  const latestMessages = await Promise.all(
    channels.map(async (channel) => {
      try {
        const latest = await getLatestMessage(channel);
        return { channel, latest };
      } catch {
        return { channel, latest: null };
      }
    })
  );

  const nextCursor: Record<string, string | null> = { ...previousCursor };
  const events: Array<{
    channel: string;
    hasHumanMention?: boolean;
    agentName?: string;
    agentEmoji?: string;
    preview?: string;
  }> = [];

  for (const { channel, latest } of latestMessages) {
    const signature = latest ? `${latest.id}:${latest.timestamp}` : null;
    const hadPrevious = Object.prototype.hasOwnProperty.call(previousCursor, channel);
    const previousSignature = previousCursor[channel] ?? null;
    nextCursor[channel] = signature;

    if (!hadPrevious || previousSignature === signature || !latest) {
      continue;
    }

    events.push({
      channel,
      hasHumanMention:
        latest.content.includes("@human") || latest.mentions.includes("human"),
      agentName: latest.displayName || latest.agent,
      agentEmoji: latest.emoji,
      preview: latest.content.slice(0, 120),
    });
  }

  return { nextCursor, events };
}
