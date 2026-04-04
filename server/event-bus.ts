import { WebSocket } from "ws";

interface EventSubscriber {
  ws: WebSocket;
  channels: Set<string>;
}

export interface EventBusService {
  handleConnection(ws: WebSocket): void;
  broadcast(channel: string, data: Record<string, unknown>): void;
  getSubscriberCount(): number;
}

export function createEventBusService(): EventBusService {
  const subscribers: EventSubscriber[] = [];

  return {
    handleConnection(ws) {
      const subscriber: EventSubscriber = { ws, channels: new Set(["*"]) };
      subscribers.push(subscriber);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.subscribe) {
            subscriber.channels.add(msg.subscribe);
          }
          if (msg.unsubscribe) {
            subscriber.channels.delete(msg.unsubscribe);
          }
        } catch {
          // ignore
        }
      });

      ws.on("close", () => {
        const idx = subscribers.indexOf(subscriber);
        if (idx >= 0) subscribers.splice(idx, 1);
      });
    },

    broadcast(channel, data) {
      const message = JSON.stringify({ channel, ...data });
      for (const sub of subscribers) {
        if ((sub.channels.has(channel) || sub.channels.has("*")) && sub.ws.readyState === WebSocket.OPEN) {
          sub.ws.send(message);
        }
      }
    },

    getSubscriberCount() {
      return subscribers.length;
    },
  };
}
