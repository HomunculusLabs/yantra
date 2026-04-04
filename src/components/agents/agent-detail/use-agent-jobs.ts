"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAgentJob,
  deleteAgentJob,
  listAgentJobs,
  runAgentJob,
  saveAgentJob,
  toggleAgentJob,
} from "@/lib/api/agents-client";
import type { CreateJobPayload, JobConfig, JobRun, UpdateJobPayload } from "@/types/jobs";

type UseAgentJobsResult = {
  jobs: JobConfig[];
  loading: boolean;
  runningJobId: string | null;
  refresh: () => Promise<void>;
  createJob: (payload: CreateJobPayload) => Promise<JobConfig | null>;
  updateJob: (jobId: string, payload: UpdateJobPayload) => Promise<JobConfig | null>;
  toggleJob: (jobId: string) => Promise<JobConfig | null>;
  runJob: (jobId: string) => Promise<JobRun | null>;
  deleteJob: (jobId: string) => Promise<boolean>;
};

export function useAgentJobs(slug: string): UseAgentJobsResult {
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;

    try {
      const nextJobs = await listAgentJobs(slug);
      if (requestRef.current !== requestId) return;
      setJobs(nextJobs);
    } catch {
      if (requestRef.current !== requestId) return;
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [slug]);

  const createJob = useCallback(
    async (payload: CreateJobPayload) => {
      let job: JobConfig | null = null;
      try {
        job = await createAgentJob(slug, payload);
      } catch {
        job = null;
      } finally {
        await refresh();
      }
      return job;
    },
    [refresh, slug]
  );

  const updateJob = useCallback(
    async (jobId: string, payload: UpdateJobPayload) => {
      let job: JobConfig | null = null;
      try {
        job = await saveAgentJob(slug, jobId, payload);
      } catch {
        job = null;
      } finally {
        await refresh();
      }
      return job;
    },
    [refresh, slug]
  );

  const toggleJob = useCallback(
    async (jobId: string) => {
      let job: JobConfig | null = null;
      try {
        job = await toggleAgentJob(slug, jobId);
      } catch {
        job = null;
      } finally {
        await refresh();
      }
      return job;
    },
    [refresh, slug]
  );

  const runJob = useCallback(
    async (jobId: string) => {
      setRunningJobId(jobId);
      try {
        const run = await runAgentJob(slug, jobId);
        await refresh();
        return run;
      } catch {
        await refresh();
        return null;
      } finally {
        setRunningJobId(null);
      }
    },
    [refresh, slug]
  );

  const deleteJobById = useCallback(
    async (jobId: string) => {
      let success = true;
      try {
        await deleteAgentJob(slug, jobId);
      } catch {
        success = false;
      } finally {
        await refresh();
      }
      return success;
    },
    [refresh, slug]
  );

  useEffect(() => {
    setLoading(true);
    setJobs([]);
    void refresh();
  }, [refresh]);

  return {
    jobs,
    loading,
    runningJobId,
    refresh,
    createJob,
    updateJob,
    toggleJob,
    runJob,
    deleteJob: deleteJobById,
  };
}
