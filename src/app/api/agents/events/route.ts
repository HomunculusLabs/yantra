import { NextResponse } from "next/server";
import { listPersonas } from "@/lib/agents/persona-manager";
import { getGoalState } from "@/lib/agents/goal-manager";
import {
  buildRespondingAgentPayload,
  detectSlackActivity,
} from "@/lib/agents/slack-monitor";
import { getRunningConversationCounts } from "@/lib/agents/conversation-store";
import { getTreeVersion } from "@/lib/storage/tree-version";

/**
 * GET /api/agents/events — Server-Sent Events for real-time Mission Control updates.
 * Pushes agent status, goal progress, and new Slack messages every 3 seconds.
 */
export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Track last known state for diffing
      let lastSlackCursor: Record<string, string | null> = {};
      let lastDataVersion = await getTreeVersion();

      const tick = async () => {
        if (closed) return;

        try {
          // Gather current state
          const personas = await listPersonas();
          const registered = personas
            .filter((persona) => persona.active && !!persona.heartbeat)
            .map((persona) => persona.slug);
          const runningCounts = await getRunningConversationCounts();

          // Agent statuses
          const agentStatuses = personas.map((p) => ({
            slug: p.slug,
            active: p.active,
            scheduled: registered.includes(p.slug),
            running: (runningCounts[p.slug] || 0) > 0,
            runningCount: runningCounts[p.slug] || 0,
            lastHeartbeat: p.lastHeartbeat,
            nextHeartbeat: p.nextHeartbeat,
          }));

          send("agent_status", agentStatuses);

          // Goal progress (only for agents with goals)
          const goalUpdates: { slug: string; goals: Record<string, { current: number; target: number }> }[] = [];
          for (const p of personas) {
            if (p.goals && p.goals.length > 0) {
              const state = await getGoalState(p.slug);
              const goals: Record<string, { current: number; target: number }> = {};
              for (const g of p.goals) {
                const s = state[g.metric];
                goals[g.metric] = {
                  current: s?.current ?? g.current ?? 0,
                  target: g.target,
                };
              }
              goalUpdates.push({ slug: p.slug, goals });
            }
          }
          if (goalUpdates.length > 0) {
            send("goal_update", goalUpdates);
          }

          // New Slack messages (check for new messages per channel)
          const channels = ["general", "marketing", "engineering", "operations", "alerts"];
          const slackActivity = await detectSlackActivity(channels, lastSlackCursor);
          lastSlackCursor = slackActivity.nextCursor;
          for (const event of slackActivity.events) {
            send("slack_activity", event);
          }

          // Pulse metrics summary
          const allGoals = personas.flatMap((p) => p.goals || []);
          const goalsOnTrack = allGoals.filter((g) => {
            if (g.target === 0) return true;
            return (g.current ?? 0) / g.target >= 0.4;
          }).length;

          // Responding agents (typing indicator for Slack)
          send("agent_responding", buildRespondingAgentPayload(personas));

          send("pulse", {
            totalAgents: personas.length,
            activeAgents: personas.filter((p) => p.active).length,
            scheduledAgents: registered.length,
            runningPlays: Object.values(runningCounts).reduce((sum, count) => sum + count, 0),
            goalsOnTrack,
            totalGoals: allGoals.length,
          });

          // Tree change detection — notify client to reload sidebar
          const currentDataVersion = await getTreeVersion();
          if (currentDataVersion !== lastDataVersion) {
            lastDataVersion = currentDataVersion;
            send("tree_changed", {});
          }
        } catch {
          // Ignore errors in SSE tick
        }
      };

      // Initial tick
      await tick();

      // Poll every 3 seconds
      const interval = setInterval(tick, 3000);

      // Cleanup when client disconnects
      const cleanup = () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Auto-close after 5 minutes to prevent zombie connections
      setTimeout(cleanup, 5 * 60 * 1000);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
