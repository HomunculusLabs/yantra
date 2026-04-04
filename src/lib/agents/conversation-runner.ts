import type { JobConfig, JobRun, JobPostAction } from "@/types/jobs";
import type { ConversationMeta } from "@/types/conversations";
import path from "path";
import { resolveVaultPath } from "@/lib/config/yantra-roots";
import { readPage } from "../storage/page-io";
import { DATA_DIR } from "../storage/path-utils";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import {
  appendConversationTranscript,
  createConversation,
  finalizeConversation,
  readConversationMeta,
  readConversationTranscript,
} from "./conversation-store";
import {
  createDaemonSession,
  getDaemonSessionOutput,
  type DaemonSessionHandle,
} from "./daemon-client";
import { readPersona, type AgentPersona } from "./persona-manager";
import { resolveLaunchSpec } from "./launcher-manager";
import { sendNotification } from "./notification-service";
import type { ResolvedLaunchSpec } from "@/types/launchers";

export interface StartedConversation extends ConversationMeta, DaemonSessionHandle {}

export interface ConversationCompletion {
  meta: ConversationMeta;
  output: string;
  status: "completed" | "failed";
}

interface StartConversationInput {
  agentSlug: string;
  title: string;
  trigger: ConversationMeta["trigger"];
  prompt: string;
  mentionedPaths?: string[];
  jobId?: string;
  jobName?: string;
  cwd?: string;
  launch?: ResolvedLaunchSpec;
  timeoutSeconds?: number;
  completionTimeoutSeconds?: number;
  onComplete?: (completion: ConversationCompletion) => Promise<void> | void;
}

function buildYantraEpilogueInstructions(): string {
  return [
    "At the end of your response, include a ```yantra block with these fields:",
    "SUMMARY: one short summary line",
    "CONTEXT: optional lightweight memory/context summary",
    "ARTIFACT: relative/path/to/file for every KB file you created or updated",
  ].join("\n");
}

function buildAgentContextHeader(persona: AgentPersona | null, agentSlug: string): string {
  if (!persona) {
    return [
      "You are Yantra's General agent.",
      "Handle the request directly and use the configured vault as your working area.",
    ].join("\n");
  }

  return [
    persona.body,
    "",
    `You are working as ${persona.name} (${agentSlug}).`,
  ].join("\n");
}

function makeTitle(text: string): string {
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "New conversation";
  return firstLine.slice(0, 80);
}

function resolveVaultWorkdir(workdir?: string): string {
  if (!workdir || workdir === "/data") return DATA_DIR;
  if (workdir.startsWith("/data/")) {
    return resolveVaultPath(workdir.slice("/data/".length));
  }
  if (path.isAbsolute(workdir)) {
    return resolveVaultPath(workdir);
  }
  const normalized = workdir.startsWith("/data/")
    ? workdir.slice("/data/".length)
    : workdir.replace(/^\/+/, "");
  return resolveVaultPath(normalized);
}

async function buildMentionContext(mentionedPaths: string[]): Promise<string> {
  if (mentionedPaths.length === 0) return "";

  const chunks = await Promise.all(
    mentionedPaths.map(async (pagePath) => {
      try {
        const page = await readPage(pagePath);
        return `--- ${page.frontmatter.title} (${pagePath}) ---\n${page.content}`;
      } catch {
        return null;
      }
    })
  );

  const valid = chunks.filter(Boolean);
  if (valid.length === 0) return "";

  return `\n\nReferenced pages:\n${valid.join("\n\n")}`;
}

export async function buildManualConversationPrompt(input: {
  agentSlug: string;
  userMessage: string;
  mentionedPaths?: string[];
}): Promise<{
  prompt: string;
  title: string;
  cwd?: string;
}> {
  const persona = input.agentSlug === "general"
    ? null
    : await readPersona(input.agentSlug);
  const mentionContext = await buildMentionContext(input.mentionedPaths || []);
  const cwd = resolveVaultWorkdir(persona?.workdir);

  const prompt = [
    buildAgentContextHeader(persona, input.agentSlug),
    "",
    "Work in the configured Obsidian vault.",
    "Reflect useful outputs in vault files, not only in terminal text.",
    buildYantraEpilogueInstructions(),
    "",
    `User request:\n${input.userMessage}${mentionContext}`,
  ].join("\n");

  return {
    prompt,
    title: makeTitle(input.userMessage),
    cwd,
  };
}

export async function buildEditorConversationPrompt(input: {
  pagePath: string;
  userMessage: string;
  mentionedPaths?: string[];
}): Promise<{
  prompt: string;
  title: string;
  cwd?: string;
  mentionedPaths: string[];
}> {
  const persona = await readPersona("editor");
  const combinedMentionedPaths = Array.from(
    new Set([input.pagePath, ...(input.mentionedPaths || [])])
  );
  const mentionContext = await buildMentionContext(combinedMentionedPaths);
  const cwd = resolveVaultWorkdir(persona?.workdir);

  const prompt = [
    buildAgentContextHeader(persona, "editor"),
    "",
    `You are editing the page at ${input.pagePath}.`,
    `Prefer making the requested changes directly in ${input.pagePath} unless the task clearly belongs in another vault file.`,
    "Work in the configured Obsidian vault.",
    "Edit vault files directly and reflect useful outputs in the vault, not only in terminal text.",
    buildYantraEpilogueInstructions(),
    "",
    `User request:\n${input.userMessage}${mentionContext}`,
  ].join("\n");

  return {
    prompt,
    title: makeTitle(input.userMessage),
    cwd,
    mentionedPaths: combinedMentionedPaths,
  };
}

export async function startConversationRun(
  input: StartConversationInput
): Promise<StartedConversation> {
  const meta = await createConversation({
    agentSlug: input.agentSlug,
    title: input.title,
    trigger: input.trigger,
    prompt: input.prompt,
    mentionedPaths: input.mentionedPaths,
    jobId: input.jobId,
    jobName: input.jobName,
  });

  let daemonSession: DaemonSessionHandle;

  try {
    const launch =
      input.launch ||
      (await resolveLaunchSpec({
        prompt: input.prompt,
        persona:
          input.agentSlug === "general" ? null : await readPersona(input.agentSlug),
        cwd: input.cwd,
      }));

    daemonSession = await createDaemonSession({
      id: meta.id,
      prompt: input.prompt,
      launch,
      timeoutSeconds: input.timeoutSeconds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start daemon session";
    await appendConversationTranscript(meta.id, `${message}\n`);
    await finalizeConversation(meta.id, {
      status: "failed",
      output: message,
      exitCode: 1,
    });
    throw error;
  }

  if (input.onComplete) {
    void waitForConversationCompletion(meta.id, {
      timeoutSeconds: input.completionTimeoutSeconds,
      onComplete: input.onComplete,
    });
  }

  return {
    ...meta,
    ...daemonSession!,
  };
}

export function resolveCompletionTimeoutSeconds(
  timeoutSeconds?: number,
  graceSeconds = 15
): number | undefined {
  if (typeof timeoutSeconds !== "number" || timeoutSeconds <= 0) {
    return undefined;
  }

  return timeoutSeconds + graceSeconds;
}

function buildConversationCompletion(
  meta: ConversationMeta,
  output: string
): ConversationCompletion {
  return {
    meta,
    output,
    status: meta.status === "completed" ? "completed" : "failed",
  };
}

export async function waitForConversationCompletion(
  conversationId: string,
  options?: {
    timeoutSeconds?: number;
    onComplete?: (completion: ConversationCompletion) => Promise<void> | void;
  }
): Promise<ConversationCompletion> {
  const deadline =
    typeof options?.timeoutSeconds === "number" && options.timeoutSeconds > 0
      ? Date.now() + options.timeoutSeconds * 1000
      : null;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      const data = await getDaemonSessionOutput(conversationId);
      if (data.status === "running") {
        if (!deadline || Date.now() < deadline) {
          continue;
        }
      } else {
        const normalizedStatus = data.status === "completed" ? "completed" : "failed";
        const currentMeta = await readConversationMeta(conversationId);
        const finalMeta =
          currentMeta?.status === "running"
            ? await finalizeConversation(conversationId, {
                status: normalizedStatus,
                output: data.output,
                exitCode: normalizedStatus === "completed" ? 0 : 1,
              })
            : currentMeta;

        if (!finalMeta) {
          throw new Error(`Conversation ${conversationId} disappeared during completion`);
        }

        const completion = buildConversationCompletion(finalMeta, data.output);

        if (options?.onComplete) {
          await options.onComplete(completion);
        }

        return completion;
      }
    } catch {
      // Retry until timeout. The daemon can briefly 404 while cleaning up.
      const currentMeta = await readConversationMeta(conversationId).catch(() => null);
      if (currentMeta && currentMeta.status !== "running") {
        const output = await readConversationTranscript(conversationId).catch(() => "");
        const completion = buildConversationCompletion(currentMeta, output);

        if (options?.onComplete) {
          await options.onComplete(completion);
        }

        return completion;
      }

      if (!deadline || Date.now() < deadline) {
        continue;
      }
    }

    if (!deadline || Date.now() < deadline) {
      continue;
    }

    const finalMeta = await finalizeConversation(conversationId, {
      status: "failed",
      output: "Conversation timed out while waiting for completion.",
      exitCode: 124,
    });

    if (!finalMeta) {
      throw new Error(`Conversation ${conversationId} timed out and no metadata was found`);
    }

    const completion = buildConversationCompletion(
      finalMeta,
      "Conversation timed out while waiting for completion."
    );

    if (options?.onComplete) {
      await options.onComplete(completion);
    }

    return completion;
  }
}

function substituteTemplateVars(text: string, job: JobConfig): string {
  const now = new Date();
  return text
    .replace(/\{\{date\}\}/g, now.toISOString().split("T")[0])
    .replace(/\{\{datetime\}\}/g, now.toISOString())
    .replace(/\{\{job\.name\}\}/g, job.name)
    .replace(/\{\{job\.id\}\}/g, job.id)
    .replace(/\{\{job\.workdir\}\}/g, job.workdir || "/data");
}

async function processPostActions(
  actions: JobPostAction[] | undefined,
  job: JobConfig
): Promise<void> {
  if (!actions || actions.length === 0) return;

  for (const action of actions) {
    try {
      if (action.action === "git_commit") {
        const simpleGit = (await import("simple-git")).default;
        const git = simpleGit(getYantraRoots().vaultRoot);
        await git.add(".");
        await git.commit(
          substituteTemplateVars(
            action.message || `Job ${job.name} completed {{date}}`,
            job
          )
        );
      }
      if (action.action === "notify") {
        await sendNotification({
          title: job.name,
          message: substituteTemplateVars(
            action.message || `Job ${job.name} completed at {{datetime}}`,
            job
          ),
          channel: action.channel,
          severity: "info",
        });
      }
    } catch (error) {
      console.error(`Post-action ${action.action} failed:`, error);
    }
  }
}

export async function startJobConversation(job: JobConfig): Promise<JobRun> {
  const persona = job.agentSlug ? await readPersona(job.agentSlug) : null;
  const jobPrompt = substituteTemplateVars(job.prompt, job);
  const cwd = resolveVaultWorkdir(job.workdir || persona?.workdir);

  const prompt = [
    buildAgentContextHeader(persona, job.agentSlug || "agent"),
    "",
    "This is a scheduled or manual Yantra job.",
    "Reflect the results in KB files whenever useful.",
    buildYantraEpilogueInstructions(),
    "",
    `Job instructions:\n${jobPrompt}`,
  ].join("\n");

  const launch = await resolveLaunchSpec({
    prompt,
    persona,
    job,
    cwd,
  });

  const meta = await startConversationRun({
    agentSlug: job.agentSlug || "agent",
    title: job.name,
    trigger: "job",
    prompt,
    jobId: job.id,
    jobName: job.name,
    cwd,
    launch,
    timeoutSeconds: job.timeout || 600,
    completionTimeoutSeconds: resolveCompletionTimeoutSeconds(job.timeout || 600),
    onComplete: async (completion) => {
      if (completion.status === "completed") {
        await processPostActions(job.on_complete, job);
      } else {
        await processPostActions(job.on_failure, job);
      }
    },
  });

  return {
    id: meta.id,
    jobId: job.id,
    status: "running",
    startedAt: meta.startedAt,
    output: "",
  };
}
