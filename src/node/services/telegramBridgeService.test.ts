import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { splitTelegramMessage, TelegramBridgeService } from "./telegramBridgeService";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("TelegramBridgeService", () => {
  it("persists normalized allowlist configuration without a token", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "steward-telegram-test-"));
    roots.push(root);
    const service = new TelegramBridgeService(
      root,
      () => Promise.resolve("secret"),
      () => Promise.resolve("report")
    );
    const saved = await service.saveConfig({
      enabled: true,
      workspaceId: " workspace-1 ",
      agentId: "plan",
      allowedChatIds: ["42", "42", "-1001", "invalid"],
    });
    expect(saved.workspaceId).toBe("workspace-1");
    expect(saved.allowedChatIds).toEqual(["-1001", "42"]);
    expect(await fs.readFile(path.join(root, "telegram.json"), "utf-8")).not.toContain("secret");
  });

  it("splits long Unicode replies within Telegram's safe character limit", () => {
    const chunks = splitTelegramMessage("^w^".repeat(3000), 4000);
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => [...chunk].length <= 4000)).toBe(true);
    expect(chunks.join("")).toBe("^w^".repeat(3000));
  });
});
