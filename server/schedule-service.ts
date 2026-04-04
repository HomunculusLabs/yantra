import fs from "fs";
import path from "path";
import cron from "node-cron";
import yaml from "js-yaml";
import matter from "gray-matter";
import { getAbsurdQueueName, spawnJobTask } from "../src/lib/jobs/absurd";

interface JobConfig {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  prompt: string;
  timeout?: number;
  agentSlug: string;
}

export interface ScheduleReloadResult {
  jobs: number;
  heartbeats: number;
  agentSlugs: string[];
}

export interface ScheduleService {
  listKnownAgentSlugs(): string[];
  reloadSchedules(): Promise<ScheduleReloadResult>;
  queueReload(): void;
  getCounts(): { scheduledJobs: number; scheduledHeartbeats: number };
  stop(): void;
}

interface CreateScheduleServiceOptions {
  agentsDir: string;
  onAgentSlugsChanged: (agentSlugs: string[]) => Promise<void>;
  heartbeatBaseUrl?: string;
}

export function createScheduleService(
  options: CreateScheduleServiceOptions
): ScheduleService {
  const scheduledJobs = new Map<string, ReturnType<typeof cron.schedule>>();
  const scheduledHeartbeats = new Map<string, ReturnType<typeof cron.schedule>>();
  let scheduleReloadTimer: NodeJS.Timeout | null = null;

  async function putJson(url: string, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
  }

  function stopScheduledTasks(): void {
    for (const [, task] of scheduledJobs) task.stop();
    for (const [, task] of scheduledHeartbeats) task.stop();
    scheduledJobs.clear();
    scheduledHeartbeats.clear();
  }

  function scheduleJob(job: JobConfig): void {
    const key = `${job.agentSlug}/${job.id}`;

    if (!cron.validate(job.schedule)) {
      console.warn(`Invalid cron schedule for job ${key}: ${job.schedule}`);
      return;
    }

    const task = cron.schedule(job.schedule, () => {
      console.log(`Triggering scheduled job ${key}`);
      const scheduledFireTime = new Date().toISOString();
      void spawnJobTask({
        agentSlug: job.agentSlug,
        jobId: job.id,
        source: "scheduler",
        idempotencyKey: `job:${job.agentSlug}:${job.id}:${scheduledFireTime}`,
      })
        .then((spawned) => {
          console.log(
            `Enqueued scheduled job ${key} on Absurd queue ${getAbsurdQueueName(job.agentSlug)} ` +
            `as task ${spawned.taskID}${spawned.created ? "" : " (deduped)"}`
          );
        })
        .catch((error) => {
          console.error(`Failed to enqueue scheduled job ${key}:`, error);
        });
    });

    scheduledJobs.set(key, task);
    console.log(`  Scheduled job: ${key} (${job.schedule})`);
  }

  function scheduleHeartbeat(slug: string, cronExpr: string): void {
    if (!cron.validate(cronExpr)) {
      console.warn(`Invalid heartbeat schedule for ${slug}: ${cronExpr}`);
      return;
    }

    const task = cron.schedule(cronExpr, () => {
      console.log(`Triggering heartbeat ${slug}`);
      void putJson(`${options.heartbeatBaseUrl || "http://localhost:3000"}/api/agents/personas/${slug}`, {
        action: "run",
        source: "scheduler",
      }).catch((error) => {
        console.error(`Failed to trigger heartbeat ${slug}:`, error);
      });
    });

    scheduledHeartbeats.set(slug, task);
    console.log(`  Scheduled heartbeat: ${slug} (${cronExpr})`);
  }

  return {
    listKnownAgentSlugs() {
      if (!fs.existsSync(options.agentsDir)) return [];

      return fs
        .readdirSync(options.agentsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
    },

    async reloadSchedules() {
      stopScheduledTasks();

      if (!fs.existsSync(options.agentsDir)) {
        await options.onAgentSlugsChanged([]);
        return { jobs: 0, heartbeats: 0, agentSlugs: [] };
      }

      const entries = fs.readdirSync(options.agentsDir, { withFileTypes: true });
      let jobCount = 0;
      let heartbeatCount = 0;
      const agentSlugs: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

        agentSlugs.push(entry.name);

        const personaPath = path.join(options.agentsDir, entry.name, "persona.md");
        if (fs.existsSync(personaPath)) {
          try {
            const rawPersona = fs.readFileSync(personaPath, "utf-8");
            const { data } = matter(rawPersona);
            const active = data.active !== false;
            const heartbeat = typeof data.heartbeat === "string" ? data.heartbeat : "";
            if (active && heartbeat) {
              scheduleHeartbeat(entry.name, heartbeat);
              heartbeatCount++;
            }
          } catch {
            // Skip malformed personas.
          }
        }

        const jobsDir = path.join(options.agentsDir, entry.name, "jobs");
        if (!fs.existsSync(jobsDir)) continue;

        const jobFiles = fs.readdirSync(jobsDir);
        for (const jobFile of jobFiles) {
          if (!jobFile.endsWith(".yaml")) continue;

          try {
            const raw = fs.readFileSync(path.join(jobsDir, jobFile), "utf-8");
            const config = yaml.load(raw) as JobConfig;
            if (config && config.id && config.enabled && config.schedule) {
              config.agentSlug = entry.name;
              scheduleJob(config);
              jobCount++;
            }
          } catch {
            // Skip malformed jobs.
          }
        }
      }

      console.log(`Scheduled ${jobCount} jobs and ${heartbeatCount} heartbeats.`);
      await options.onAgentSlugsChanged(agentSlugs);

      return {
        jobs: jobCount,
        heartbeats: heartbeatCount,
        agentSlugs,
      };
    },

    queueReload() {
      if (scheduleReloadTimer) {
        clearTimeout(scheduleReloadTimer);
      }

      scheduleReloadTimer = setTimeout(() => {
        scheduleReloadTimer = null;
        void this.reloadSchedules().catch((error) => {
          console.error("Failed to reload daemon schedules:", error);
        });
      }, 200);
    },

    getCounts() {
      return {
        scheduledJobs: scheduledJobs.size,
        scheduledHeartbeats: scheduledHeartbeats.size,
      };
    },

    stop() {
      if (scheduleReloadTimer) {
        clearTimeout(scheduleReloadTimer);
        scheduleReloadTimer = null;
      }
      stopScheduledTasks();
    },
  };
}
