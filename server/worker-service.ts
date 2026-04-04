import {
  closeAbsurdJobWorker,
  getAbsurdQueuePrefix,
  getAbsurdWorkerQueueNames,
  startAbsurdJobWorker,
} from "../src/lib/jobs/absurd";

export interface WorkerHealthSnapshot {
  absurdWorkerReady: boolean;
  absurdQueuePrefix: string;
  absurdQueues: string[];
}

export interface WorkerService {
  boot(agentSlugs?: string[]): void;
  reconcileAgentSlugs(agentSlugs: string[]): Promise<void>;
  getHealthSnapshot(): WorkerHealthSnapshot;
  shutdown(): Promise<void>;
}

interface StartWorkersOptions {
  attempt: number;
  logSuccess: boolean;
  logRetryMessage: boolean;
  throwOnError: boolean;
}

export function createWorkerService(): WorkerService {
  let absurdWorkerReady = false;
  let retryTimer: NodeJS.Timeout | null = null;
  let shuttingDown = false;
  let desiredAgentSlugs: string[] = [];
  let nextAttempt = 1;

  function normalizeAgentSlugs(agentSlugs: string[]): string[] {
    return [...new Set(agentSlugs)].sort();
  }

  function clearRetryTimer(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(error: unknown, attempt: number, logRetryMessage: boolean): void {
    if (shuttingDown || retryTimer) {
      return;
    }

    const delayMs = Math.min(30000, attempt * 5000);
    if (logRetryMessage) {
      console.error(
        `Failed to start Absurd worker (attempt ${attempt}). ` +
        `Make sure ABSURD_DATABASE_URL is reachable and the Absurd schema is initialized. ` +
        `Retrying in ${Math.round(delayMs / 1000)}s.`,
        error
      );
    }

    retryTimer = setTimeout(() => {
      retryTimer = null;
      void startWorkers({
        attempt: attempt + 1,
        logSuccess: true,
        logRetryMessage: true,
        throwOnError: false,
      });
    }, delayMs);
  }

  async function startWorkers(options: StartWorkersOptions): Promise<void> {
    if (shuttingDown) {
      return;
    }

    try {
      await startAbsurdJobWorker(desiredAgentSlugs);
      absurdWorkerReady = true;
      nextAttempt = 1;
      clearRetryTimer();

      if (options.logSuccess) {
        console.log(
          `Absurd workers started for queues: ${getAbsurdWorkerQueueNames().join(", ") || getAbsurdQueuePrefix()}.`
        );
      }
    } catch (error) {
      absurdWorkerReady = false;
      nextAttempt = options.attempt + 1;
      scheduleRetry(error, options.attempt, options.logRetryMessage);
      if (options.throwOnError) {
        throw error;
      }
    }
  }

  return {
    boot(agentSlugs = []) {
      desiredAgentSlugs = normalizeAgentSlugs(agentSlugs);
      void startWorkers({
        attempt: nextAttempt,
        logSuccess: true,
        logRetryMessage: true,
        throwOnError: false,
      });
    },

    async reconcileAgentSlugs(agentSlugs) {
      desiredAgentSlugs = normalizeAgentSlugs(agentSlugs);
      await startWorkers({
        attempt: nextAttempt,
        logSuccess: false,
        logRetryMessage: false,
        throwOnError: true,
      });
    },

    getHealthSnapshot() {
      return {
        absurdWorkerReady,
        absurdQueuePrefix: getAbsurdQueuePrefix(),
        absurdQueues: getAbsurdWorkerQueueNames(),
      };
    },

    async shutdown() {
      shuttingDown = true;
      clearRetryTimer();
      await closeAbsurdJobWorker();
    },
  };
}
