import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import writeFileAtomic from "write-file-atomic";

import { log } from "@/node/services/log";
import { ensurePrivateDir } from "@/node/utils/fs";

const SCHEDULES_FILENAME = "schedules.json";
const TICK_INTERVAL_MS = 30_000;

export interface ScheduledAgentJob {
  id: string;
  name: string;
  workspaceId: string;
  prompt: string;
  agentId: "explore" | "plan" | "exec";
  intervalMinutes: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastStatus?: "started" | "failed";
  lastError?: string;
  lastTaskId?: string;
}

export interface ScheduledAgentJobInput {
  name: string;
  workspaceId: string;
  prompt: string;
  agentId: ScheduledAgentJob["agentId"];
  intervalMinutes: number;
}

interface TaskStartResult {
  success: boolean;
  taskId?: string;
  error?: string;
}

function schedulesPath(rootDir: string): string {
  return path.join(rootDir, SCHEDULES_FILENAME);
}

function normalizeInput(input: ScheduledAgentJobInput): ScheduledAgentJobInput {
  const name = input.name.trim();
  const workspaceId = input.workspaceId.trim();
  const prompt = input.prompt.trim();
  if (!name || !workspaceId || !prompt) {
    throw new Error("Schedule name, workspace, and prompt are required.");
  }
  if (
    !Number.isInteger(input.intervalMinutes) ||
    input.intervalMinutes < 1 ||
    input.intervalMinutes > 525_600
  ) {
    throw new Error("Schedule interval must be between 1 minute and 1 year.");
  }
  return { ...input, name, workspaceId, prompt };
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly startTask: (job: ScheduledAgentJob) => Promise<TaskStartResult>
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async list(): Promise<ScheduledAgentJob[]> {
    await this.operationQueue;
    return this.read();
  }

  async create(input: ScheduledAgentJobInput): Promise<ScheduledAgentJob> {
    const normalized = normalizeInput(input);
    const job: ScheduledAgentJob = {
      ...normalized,
      id: randomUUID(),
      enabled: true,
      createdAt: Date.now(),
    };
    await this.mutate((jobs) => [job, ...jobs]);
    return job;
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledAgentJob> {
    let updated: ScheduledAgentJob | undefined;
    await this.mutate((jobs) =>
      jobs.map((job) => {
        if (job.id !== id) return job;
        updated = { ...job, enabled };
        return updated;
      })
    );
    if (!updated) throw new Error(`Schedule not found: ${id}`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    let found = false;
    await this.mutate((jobs) => jobs.filter((job) => (job.id === id ? !(found = true) : true)));
    if (!found) throw new Error(`Schedule not found: ${id}`);
  }

  async runNow(id: string): Promise<ScheduledAgentJob> {
    let result: ScheduledAgentJob | undefined;
    await this.enqueue(async () => {
      const jobs = await this.read();
      const index = jobs.findIndex((job) => job.id === id);
      if (index === -1) throw new Error(`Schedule not found: ${id}`);
      result = await this.execute(jobs[index]!);
      jobs[index] = result;
      await this.write(jobs);
    });
    return result!;
  }

  getNextRunAt(job: ScheduledAgentJob): number {
    return (job.lastRunAt ?? job.createdAt) + job.intervalMinutes * 60_000;
  }

  private async tick(): Promise<void> {
    try {
      await this.enqueue(async () => {
        const jobs = await this.read();
        const now = Date.now();
        let changed = false;
        for (let index = 0; index < jobs.length; index += 1) {
          const job = jobs[index]!;
          if (!job.enabled || this.getNextRunAt(job) > now) continue;
          jobs[index] = await this.execute(job);
          changed = true;
        }
        if (changed) await this.write(jobs);
      });
    } catch (error) {
      log.error("Scheduled agent tick failed", { error });
    }
  }

  private async execute(job: ScheduledAgentJob): Promise<ScheduledAgentJob> {
    const lastRunAt = Date.now();
    try {
      const result = await this.startTask(job);
      if (!result.success) {
        return {
          ...job,
          lastRunAt,
          lastStatus: "failed",
          lastError: result.error ?? "Task failed to start",
        };
      }
      return {
        ...job,
        lastRunAt,
        lastStatus: "started",
        ...(result.taskId ? { lastTaskId: result.taskId } : {}),
        lastError: undefined,
      };
    } catch (error) {
      return {
        ...job,
        lastRunAt,
        lastStatus: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async mutate(
    transform: (jobs: ScheduledAgentJob[]) => ScheduledAgentJob[]
  ): Promise<void> {
    await this.enqueue(async () => this.write(transform(await this.read())));
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.catch((error: unknown) => {
      log.error("Scheduled agent operation failed", { error });
    });
    return run;
  }

  private async read(): Promise<ScheduledAgentJob[]> {
    try {
      const value = JSON.parse(await fs.readFile(schedulesPath(this.rootDir), "utf-8")) as unknown;
      return Array.isArray(value) ? (value as ScheduledAgentJob[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(jobs: ScheduledAgentJob[]): Promise<void> {
    await ensurePrivateDir(this.rootDir);
    await writeFileAtomic(schedulesPath(this.rootDir), `${JSON.stringify(jobs, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}
