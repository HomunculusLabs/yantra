import http from "http";
import {
  getTokenFromAuthorizationHeader,
  isDaemonTokenValid,
} from "../src/lib/agents/daemon-auth";
import type { ResolvedLaunchSpec } from "../src/types/launchers";
import type { EventBusService } from "./event-bus";
import type { PtySessionService } from "./pty-session-service";
import type { ScheduleService } from "./schedule-service";
import type { WorkerService } from "./worker-service";

export interface DaemonHttpRoutesDeps {
  host: string;
  port: number;
  allowedBrowserOrigins: Set<string>;
  sessionService: PtySessionService;
  scheduleService: ScheduleService;
  workerService: WorkerService;
  eventBus: EventBusService;
  tmuxAvailable: boolean;
}

export function extractDaemonRequestToken(
  req: http.IncomingMessage,
  url: URL
): string | null {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  return getTokenFromAuthorizationHeader(authHeader) || url.searchParams.get("token");
}

function applyCors(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowedBrowserOrigins: Set<string>
): void {
  const origin = req.headers.origin;
  if (origin && allowedBrowserOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function rejectUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return JSON.parse(body);
}

export function createDaemonHttpHandler(
  deps: DaemonHttpRoutesDeps
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req, res) => {
    applyCors(req, res, deps.allowedBrowserOrigins);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "", `http://${deps.host}:${deps.port}`);
    if (url.pathname !== "/health" && !isDaemonTokenValid(extractDaemonRequestToken(req, url))) {
      rejectUnauthorized(res);
      return;
    }

    const outputMatch = url.pathname.match(/^\/session\/([^/]+)\/output$/);
    if (outputMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(outputMatch[1] || "");
      const output = await deps.sessionService.getSessionOutput(sessionId);
      if (!output) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(output));
      return;
    }

    if (url.pathname === "/sessions" && req.method === "POST") {
      try {
        const {
          id,
          args,
          prompt,
          cwd,
          launch,
          timeoutSeconds,
        } = await readJsonBody(req) as {
          id?: string;
          args?: string[];
          prompt?: string;
          cwd?: string;
          launch?: ResolvedLaunchSpec;
          timeoutSeconds?: number;
        };
        const sessionId = id || `session-${Date.now()}`;

        try {
          const result = deps.sessionService.createOrReuseSession({
            sessionId,
            args,
            prompt,
            cwd,
            launch,
            timeoutSeconds,
          });

          if (result.existing) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                sessionId,
                existing: true,
                launchTransport: result.handle.launchTransport,
                tmuxSessionName: result.handle.tmuxSessionName,
                tmuxAttachCommand: result.handle.tmuxAttachCommand,
              })
            );
            return;
          }

          console.log(`Session ${sessionId} started via HTTP (agent mode)`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result.handle));
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: errMsg }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
      return;
    }

    if (url.pathname === "/sessions" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(deps.sessionService.listSessions()));
      return;
    }

    if (url.pathname === "/reload-schedules" && req.method === "POST") {
      try {
        const result = await deps.scheduleService.reloadSchedules();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, jobs: result.jobs, heartbeats: result.heartbeats }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    if (url.pathname === "/health") {
      const counts = deps.scheduleService.getCounts();
      const workerHealth = deps.workerService.getHealthSnapshot();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "yantra-daemon",
          mode: process.env.YANTRA_APP_MODE || "source",
          ptySessions: deps.sessionService.getSessionCount(),
          scheduledJobs: counts.scheduledJobs,
          scheduledHeartbeats: counts.scheduledHeartbeats,
          absurdQueuePrefix: workerHealth.absurdQueuePrefix,
          absurdQueues: workerHealth.absurdQueues,
          absurdWorkerReady: workerHealth.absurdWorkerReady,
          tmuxAvailable: deps.tmuxAvailable,
          subscribers: deps.eventBus.getSubscriberCount(),
        })
      );
      return;
    }

    if (url.pathname === "/trigger" && req.method === "POST") {
      try {
        const body = await readJsonBody(req) as {
          agentSlug?: string;
          jobId?: string;
          prompt?: string;
          timeoutSeconds?: number;
        };

        if (body.prompt) {
          const sessionId = body.jobId || `manual-${Date.now()}`;
          deps.sessionService.createOrReuseSession({
            sessionId,
            prompt: body.prompt,
            timeoutSeconds: body.timeoutSeconds,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, sessionId, agentSlug: body.agentSlug || "manual" }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "prompt is required" }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  };
}
