import * as fs from "node:fs/promises";
import * as path from "node:path";

import writeFileAtomic from "write-file-atomic";

import { log } from "@/node/services/log";
import { ensurePrivateDir } from "@/node/utils/fs";

const CONFIG_FILENAME = "telegram.json";
const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramBridgeConfig {
  enabled: boolean;
  workspaceId: string;
  agentId: "explore" | "plan" | "exec";
  allowedChatIds: string[];
}

export interface TelegramBridgeStatus {
  running: boolean;
  tokenConfigured: boolean;
  lastError?: string;
  botUsername?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number } };
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

const DEFAULT_CONFIG: TelegramBridgeConfig = {
  enabled: false,
  workspaceId: "",
  agentId: "exec",
  allowedChatIds: [],
};

function configPath(rootDir: string): string {
  return path.join(rootDir, CONFIG_FILENAME);
}
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeConfig(value: unknown): TelegramBridgeConfig {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_CONFIG };
  const candidate = value as Partial<TelegramBridgeConfig>;
  return {
    enabled: candidate.enabled === true,
    workspaceId: typeof candidate.workspaceId === "string" ? candidate.workspaceId.trim() : "",
    agentId:
      candidate.agentId === "explore" || candidate.agentId === "plan" ? candidate.agentId : "exec",
    allowedChatIds: Array.isArray(candidate.allowedChatIds)
      ? [...new Set(candidate.allowedChatIds.filter((id) => /^-?\d+$/u.test(id)))].sort()
      : [],
  };
}

export class TelegramBridgeService {
  private active = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private status: TelegramBridgeStatus = { running: false, tokenConfigured: false };

  constructor(
    private readonly rootDir: string,
    private readonly getToken: () => Promise<string | undefined>,
    private readonly runAgent: (input: {
      workspaceId: string;
      agentId: TelegramBridgeConfig["agentId"];
      prompt: string;
    }) => Promise<string>
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    void this.loop();
  }

  stop(): void {
    this.active = false;
    this.abortController?.abort();
    this.abortController = null;
    this.status = { ...this.status, running: false };
  }

  async getConfig(): Promise<TelegramBridgeConfig> {
    try {
      return normalizeConfig(JSON.parse(await fs.readFile(configPath(this.rootDir), "utf-8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_CONFIG };
      throw error;
    }
  }

  async saveConfig(config: TelegramBridgeConfig): Promise<TelegramBridgeConfig> {
    const normalized = normalizeConfig(config);
    if (normalized.enabled && !normalized.workspaceId)
      throw new Error("Choose a workspace before enabling Telegram.");
    await ensurePrivateDir(this.rootDir);
    await writeFileAtomic(configPath(this.rootDir), `${JSON.stringify(normalized, null, 2)}\n`, {
      mode: 0o600,
    });
    return normalized;
  }

  getStatus(): TelegramBridgeStatus {
    return { ...this.status };
  }

  async testConnection(): Promise<{ username: string }> {
    const token = await this.getToken();
    if (!token) throw new Error("Add TELEGRAM_BOT_TOKEN in Settings → Secrets first.");
    const response = await this.call<{ username?: string }>(token, "getMe", {}, undefined);
    const username = response.username?.trim();
    if (!username) throw new Error("Telegram returned a bot without a username.");
    this.status = {
      ...this.status,
      tokenConfigured: true,
      botUsername: username,
      lastError: undefined,
    };
    return { username };
  }

  private async loop(): Promise<void> {
    while (this.active) {
      try {
        const config = await this.getConfig();
        const token = await this.getToken();
        this.status = {
          ...this.status,
          tokenConfigured: Boolean(token),
          running: config.enabled && Boolean(token),
        };
        if (!config.enabled || !token) {
          await sleep(3000);
          continue;
        }

        this.abortController = new AbortController();
        const updates = await this.call<TelegramUpdate[]>(
          token,
          "getUpdates",
          {
            offset: this.offset,
            timeout: 30,
            allowed_updates: ["message"],
          },
          this.abortController.signal
        );
        this.abortController = null;
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.handleUpdate(token, config, update);
        }
        this.status = { ...this.status, lastError: undefined };
      } catch (error) {
        if (!this.active) return;
        const message = error instanceof Error ? error.message : String(error);
        this.status = { ...this.status, running: false, lastError: message };
        log.warn("Telegram bridge poll failed", { error: message });
        await sleep(5000);
      }
    }
  }

  private async handleUpdate(
    token: string,
    config: TelegramBridgeConfig,
    update: TelegramUpdate
  ): Promise<void> {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim();
    if (chatId === undefined || !text) return;
    const id = String(chatId);
    if (!config.allowedChatIds.includes(id)) {
      await this.send(
        token,
        id,
        `This chat is not paired with Steward. Add chat ID ${id} in Settings → Telegram.`
      );
      return;
    }
    await this.send(token, id, "Steward accepted your request. The agent is working…");
    try {
      const reply = await this.runAgent({
        workspaceId: config.workspaceId,
        agentId: config.agentId,
        prompt: text,
      });
      await this.send(token, id, reply.trim() || "The agent completed without a text report.");
    } catch (error) {
      await this.send(
        token,
        id,
        `Steward error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async send(token: string, chatId: string, text: string): Promise<void> {
    for (const chunk of splitTelegramMessage(text)) {
      await this.call(token, "sendMessage", { chat_id: chatId, text: chunk }, undefined);
    }
  }

  private async call<T>(
    token: string,
    method: string,
    body: unknown,
    signal: AbortSignal | undefined
  ): Promise<T> {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const payload = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(
        payload.description ?? `Telegram ${method} failed with HTTP ${response.status}`
      );
    }
    return payload.result;
  }
}

export function splitTelegramMessage(text: string, limit = 4000): string[] {
  const chunks: string[] = [];
  let current = "";
  let count = 0;
  for (const character of text) {
    if (count >= limit) {
      chunks.push(current);
      current = "";
      count = 0;
    }
    current += character;
    count += 1;
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}
