import * as fs from "node:fs/promises";
import * as path from "node:path";

import writeFileAtomic from "write-file-atomic";

import type { ToolCallEndEvent, ToolCallStartEvent } from "@/common/types/stream";
import { log } from "@/node/services/log";
import { ensurePrivateDir } from "@/node/utils/fs";

const CONFIG_FILENAME = "tool-governance.json";
const AUDIT_DIR = "audit";
const AUDIT_FILENAME = "tool-calls.jsonl";
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/u;

export interface ToolGovernanceConfig {
  auditEnabled: boolean;
  retentionDays: number;
  maxEntries: number;
  disabledTools: string[];
}

export interface ToolAuditEntry {
  id: string;
  workspaceId: string;
  toolName: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  outcome: "completed" | "failed";
  parentToolCallId?: string;
}

const DEFAULT_CONFIG: ToolGovernanceConfig = {
  auditEnabled: true,
  retentionDays: 30,
  maxEntries: 5000,
  disabledTools: [],
};

function configPath(rootDir: string): string {
  return path.join(rootDir, CONFIG_FILENAME);
}

function auditPath(rootDir: string): string {
  return path.join(rootDir, AUDIT_DIR, AUDIT_FILENAME);
}

function normalizeConfig(value: unknown): ToolGovernanceConfig {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_CONFIG };
  const candidate = value as Partial<ToolGovernanceConfig>;
  const disabledTools = Array.isArray(candidate.disabledTools)
    ? [...new Set(candidate.disabledTools.filter((tool) => TOOL_NAME_PATTERN.test(tool)))].sort()
    : [];
  return {
    auditEnabled: candidate.auditEnabled !== false,
    retentionDays:
      typeof candidate.retentionDays === "number"
        ? Math.min(365, Math.max(1, Math.trunc(candidate.retentionDays)))
        : DEFAULT_CONFIG.retentionDays,
    maxEntries:
      typeof candidate.maxEntries === "number"
        ? Math.min(50_000, Math.max(100, Math.trunc(candidate.maxEntries)))
        : DEFAULT_CONFIG.maxEntries,
    disabledTools,
  };
}

export async function loadToolGovernance(rootDir: string): Promise<ToolGovernanceConfig> {
  try {
    return normalizeConfig(JSON.parse(await fs.readFile(configPath(rootDir), "utf-8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_CONFIG };
    throw error;
  }
}

export async function saveToolGovernance(
  rootDir: string,
  config: ToolGovernanceConfig
): Promise<ToolGovernanceConfig> {
  const normalized = normalizeConfig(config);
  await ensurePrivateDir(rootDir);
  await writeFileAtomic(configPath(rootDir), `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return normalized;
}

export async function applyToolGovernance<T>(
  rootDir: string,
  tools: Record<string, T>
): Promise<Record<string, T>> {
  const config = await loadToolGovernance(rootDir);
  if (config.disabledTools.length === 0) return tools;
  const disabled = new Set(config.disabledTools);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !disabled.has(name)));
}

function resultFailed(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const record = result as Record<string, unknown>;
  return record.success === false || typeof record.error === "string";
}

export class ToolAuditService {
  private readonly starts = new Map<string, ToolCallStartEvent>();
  private writeQueue: Promise<void> = Promise.resolve();
  private writesSinceCompaction = 0;

  constructor(private readonly rootDir: string) {}

  handleStart(event: ToolCallStartEvent): void {
    if (event.replay === true) return;
    this.starts.set(`${event.workspaceId}:${event.toolCallId}`, event);
  }

  handleEnd(event: ToolCallEndEvent): void {
    if (event.replay === true) return;
    const key = `${event.workspaceId}:${event.toolCallId}`;
    const start = this.starts.get(key);
    this.starts.delete(key);
    const completedAt = event.timestamp;
    const entry: ToolAuditEntry = {
      id: event.toolCallId,
      workspaceId: event.workspaceId,
      toolName: event.toolName,
      startedAt: start?.timestamp ?? completedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - (start?.timestamp ?? completedAt)),
      outcome: resultFailed(event.result) ? "failed" : "completed",
      ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
    };
    this.writeQueue = this.writeQueue
      .then(() => this.append(entry))
      .catch((error: unknown) => {
        log.error("Failed to persist tool audit entry", { error });
      });
  }

  async list(input?: {
    toolName?: string;
    workspaceId?: string;
    outcome?: ToolAuditEntry["outcome"];
    limit?: number;
  }): Promise<ToolAuditEntry[]> {
    await this.writeQueue;
    const config = await loadToolGovernance(this.rootDir);
    const entries = await this.readAll();
    const cutoff = Date.now() - config.retentionDays * 86_400_000;
    return entries
      .filter((entry) => entry.completedAt >= cutoff)
      .filter((entry) => !input?.toolName || entry.toolName === input.toolName)
      .filter((entry) => !input?.workspaceId || entry.workspaceId === input.workspaceId)
      .filter((entry) => !input?.outcome || entry.outcome === input.outcome)
      .toSorted((a, b) => b.completedAt - a.completedAt)
      .slice(0, Math.min(1000, Math.max(1, input?.limit ?? 200)));
  }

  async clear(): Promise<void> {
    await this.writeQueue;
    await fs.rm(auditPath(this.rootDir), { force: true });
    this.writesSinceCompaction = 0;
  }

  private async append(entry: ToolAuditEntry): Promise<void> {
    const config = await loadToolGovernance(this.rootDir);
    if (!config.auditEnabled) return;
    const directory = path.dirname(auditPath(this.rootDir));
    await ensurePrivateDir(directory);
    await fs.appendFile(auditPath(this.rootDir), `${JSON.stringify(entry)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    this.writesSinceCompaction += 1;
    if (this.writesSinceCompaction < 100) return;
    this.writesSinceCompaction = 0;
    const entries = await this.readAll();
    const cutoff = Date.now() - config.retentionDays * 86_400_000;
    const retained = entries.filter((item) => item.completedAt >= cutoff).slice(-config.maxEntries);
    await writeFileAtomic(
      auditPath(this.rootDir),
      retained.map((item) => JSON.stringify(item)).join("\n") + "\n",
      "utf-8"
    );
  }

  private async readAll(): Promise<ToolAuditEntry[]> {
    try {
      const content = await fs.readFile(auditPath(this.rootDir), "utf-8");
      const entries: ToolAuditEntry[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as ToolAuditEntry;
          if (
            typeof entry.id === "string" &&
            typeof entry.workspaceId === "string" &&
            typeof entry.toolName === "string" &&
            typeof entry.completedAt === "number"
          ) {
            entries.push(entry);
          }
        } catch {
          continue;
        }
      }
      return entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
