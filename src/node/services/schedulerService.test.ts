import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { SchedulerService } from "./schedulerService";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("SchedulerService", () => {
  it("persists jobs and records a successful run", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "steward-scheduler-test-"));
    roots.push(root);
    const started: string[] = [];
    const service = new SchedulerService(root, (job) => {
      started.push(job.id);
      return Promise.resolve({ success: true, taskId: "task-1" });
    });
    const created = await service.create({
      name: "Daily review",
      workspaceId: "workspace-1",
      prompt: "Review the repository",
      agentId: "exec",
      intervalMinutes: 60,
    });

    const ran = await service.runNow(created.id);
    expect(started).toEqual([created.id]);
    expect(ran.lastStatus).toBe("started");
    expect(ran.lastTaskId).toBe("task-1");
    expect((await service.list())[0]?.lastRunAt).toBeNumber();
  });

  it("toggles and removes a job", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "steward-scheduler-test-"));
    roots.push(root);
    const service = new SchedulerService(root, () => Promise.resolve({ success: true }));
    const created = await service.create({
      name: "Plan",
      workspaceId: "workspace-2",
      prompt: "Plan the next release",
      agentId: "plan",
      intervalMinutes: 5,
    });
    expect((await service.setEnabled(created.id, false)).enabled).toBe(false);
    await service.remove(created.id);
    expect(await service.list()).toEqual([]);
  });
});
