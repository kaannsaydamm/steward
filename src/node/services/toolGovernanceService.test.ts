import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ToolCallEndEvent, ToolCallStartEvent } from "@/common/types/stream";

import {
  ToolAuditService,
  applyToolGovernance,
  loadToolGovernance,
  saveToolGovernance,
} from "./toolGovernanceService";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "steward-governance-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("tool governance", () => {
  test("persists normalized settings and removes disabled tools", async () => {
    const root = await tempRoot();
    const config = await saveToolGovernance(root, {
      auditEnabled: true,
      retentionDays: 30,
      maxEntries: 5000,
      disabledTools: ["bash", "bash", "bad tool"],
    });

    expect(config.disabledTools).toEqual(["bash"]);
    expect(await loadToolGovernance(root)).toEqual(config);
    expect(await applyToolGovernance(root, { bash: 1, file_read: 2 })).toEqual({ file_read: 2 });
  });

  test("records metadata without arguments or results", async () => {
    const root = await tempRoot();
    const service = new ToolAuditService(root);
    const now = Date.now();
    const start = {
      type: "tool-call-start",
      workspaceId: "workspace-1",
      messageId: "message-1",
      toolCallId: "call-1",
      toolName: "bash",
      args: { secret: "must-not-be-written" },
      tokens: 2,
      timestamp: now,
    } satisfies ToolCallStartEvent;
    const end = {
      type: "tool-call-end",
      workspaceId: "workspace-1",
      messageId: "message-1",
      toolCallId: "call-1",
      toolName: "bash",
      result: { success: false, error: "redacted-result" },
      timestamp: now + 45,
    } satisfies ToolCallEndEvent;

    service.handleStart(start);
    service.handleEnd(end);
    const entries = await service.list();
    expect(entries).toEqual([
      expect.objectContaining({
        id: "call-1",
        toolName: "bash",
        durationMs: 45,
        outcome: "failed",
      }),
    ]);
    const raw = await fs.readFile(path.join(root, "audit", "tool-calls.jsonl"), "utf-8");
    expect(raw).not.toContain("must-not-be-written");
    expect(raw).not.toContain("redacted-result");
  });
});
