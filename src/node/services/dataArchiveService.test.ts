import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { create } from "tar";

import {
  applyPendingStewardDataImport,
  exportStewardData,
  getPendingStewardDataImport,
  scheduleStewardDataImport,
} from "./dataArchiveService";

const temporaryDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "steward-data-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("Steward data archives", () => {
  it("round-trips nested application state through a scheduled import", async () => {
    const parent = await tempDirectory();
    const root = path.join(parent, "app");
    const archive = path.join(parent, "backup.steward.tgz");
    await fs.mkdir(path.join(root, "sessions", "session-1"), { recursive: true });
    await fs.writeFile(path.join(root, "config.json"), '{"theme":"dark"}\n');
    await fs.writeFile(path.join(root, "sessions", "session-1", "chat.jsonl"), "original\n");

    expect(await exportStewardData(root, archive)).toBe(archive);
    await fs.writeFile(path.join(root, "config.json"), '{"theme":"light"}\n');
    await scheduleStewardDataImport(root, archive);
    expect(await getPendingStewardDataImport(root)).toBe(archive);

    expect(await applyPendingStewardDataImport(root)).toBe(true);
    expect(await fs.readFile(path.join(root, "config.json"), "utf-8")).toContain("dark");
    expect(await fs.readFile(path.join(root, "sessions", "session-1", "chat.jsonl"), "utf-8")).toBe(
      "original\n"
    );
    expect(await getPendingStewardDataImport(root)).toBeNull();
  });

  it("rejects archives without a Steward manifest", async () => {
    const parent = await tempDirectory();
    const root = path.join(parent, "app");
    const source = path.join(parent, "foreign");
    const archive = path.join(parent, "foreign.tgz");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "file.txt"), "not steward");
    await create({ cwd: source, file: archive, gzip: true }, ["."]);

    await expect(scheduleStewardDataImport(root, archive)).rejects.toThrow("manifest is missing");
  });
});
