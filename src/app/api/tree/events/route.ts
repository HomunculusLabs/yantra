import { NextResponse } from "next/server";
import { getTreeCacheSignal } from "@/lib/storage/tree-cache";

export const dynamic = "force-dynamic";

const TREE_EVENT_POLL_MS = 3000;
const TREE_EVENT_MAX_AGE_MS = 5 * 60 * 1000;

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: () => void = () => {
    closed = true;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const sendComment = (comment: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${comment}\n\n`));
        } catch {
          cleanup();
        }
      };

      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      let lastTreeVersion = await getTreeCacheSignal();
      send("tree_changed", { version: lastTreeVersion, initial: true });
      let polling = false;

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const currentTreeVersion = await getTreeCacheSignal();
          if (currentTreeVersion !== lastTreeVersion) {
            lastTreeVersion = currentTreeVersion;
            send("tree_changed", { version: currentTreeVersion });
          }
        } catch {
          // Ignore transient SSE polling errors.
        } finally {
          polling = false;
        }
      };

      const interval = setInterval(() => {
        void poll();
      }, TREE_EVENT_POLL_MS);
      const keepAliveInterval = setInterval(() => {
        sendComment("keep-alive");
      }, 30000);
      const maxAgeTimeout = setTimeout(() => {
        cleanup();
      }, TREE_EVENT_MAX_AGE_MS);
      let cleanedUp = false;

      cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        closed = true;
        clearInterval(interval);
        clearInterval(keepAliveInterval);
        clearTimeout(maxAgeTimeout);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
    },
    cancel() {
      cleanup();
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
