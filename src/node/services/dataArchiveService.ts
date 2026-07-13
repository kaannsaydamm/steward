import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { create, extract, list, type ReadEntry } from "tar";
import writeFileAtomic from "write-file-atomic";

import { ensurePrivateDir } from "@/node/utils/fs";

const MANIFEST_NAME = ".steward-export-manifest.json";
const PENDING_NAME = ".steward-pending-import.json";
const MAX_ARCHIVE_ENTRIES = 2_000_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024 * 1024;

interface ArchiveManifest {
  format: "steward-data";
  version: 1;
  createdAt: string;
}

interface PendingImport {
  archivePath: string;
  scheduledAt: string;
}

function pendingPath(rootDir: string): string {
  return path.join(path.dirname(rootDir), PENDING_NAME);
}

function assertAbsoluteOutsideRoot(rootDir: string, archivePath: string): string {
  if (!path.isAbsolute(archivePath)) {
    throw new Error("Archive path must be absolute.");
  }
  const resolvedRoot = path.resolve(rootDir);
  const resolvedArchive = path.resolve(archivePath);
  const relative = path.relative(resolvedRoot, resolvedArchive);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error("Archive must be stored outside Steward's active data directory.");
  }
  return resolvedArchive;
}

function validateEntry(entry: ReadEntry, state: { entries: number; bytes: number }): void {
  const normalized = path.posix.normalize(entry.path.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new Error(`Archive contains an unsafe path: ${entry.path}`);
  }
  if (entry.type === "SymbolicLink" || entry.type === "Link") {
    throw new Error(`Archive contains a link, which is not portable: ${entry.path}`);
  }
  state.entries += 1;
  state.bytes += entry.size;
  if (state.entries > MAX_ARCHIVE_ENTRIES || state.bytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("Archive exceeds Steward's safe import limits.");
  }
}

async function validateArchive(archivePath: string): Promise<void> {
  const state = { entries: 0, bytes: 0 };
  let hasManifest = false;
  await list({
    file: archivePath,
    gzip: true,
    strict: true,
    onReadEntry: (entry) => {
      validateEntry(entry, state);
      const normalized = path.posix.normalize(entry.path.replaceAll("\\", "/"));
      if (normalized === MANIFEST_NAME || normalized === `./${MANIFEST_NAME}`) {
        hasManifest = true;
      }
    },
  });
  if (!hasManifest) {
    throw new Error("This is not a Steward data archive: manifest is missing.");
  }
}

export async function exportStewardData(rootDir: string, archivePath: string): Promise<string> {
  const destination = assertAbsoluteOutsideRoot(rootDir, archivePath);
  await ensurePrivateDir(rootDir);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const manifest: ArchiveManifest = {
    format: "steward-data",
    version: 1,
    createdAt: new Date().toISOString(),
  };
  const manifestPath = path.join(rootDir, MANIFEST_NAME);
  await writeFileAtomic(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  try {
    await create(
      {
        cwd: rootDir,
        file: destination,
        gzip: true,
        portable: true,
        strict: true,
        filter: (entryPath, entry) => {
          const isLink =
            "type" in entry
              ? entry.type === "SymbolicLink" || entry.type === "Link"
              : entry.isSymbolicLink();
          return !isLink && entryPath !== "logs/mux.log";
        },
      },
      ["."]
    );
  } finally {
    await fs.rm(manifestPath, { force: true });
  }
  return destination;
}

export async function scheduleStewardDataImport(
  rootDir: string,
  archivePath: string
): Promise<string> {
  const source = assertAbsoluteOutsideRoot(rootDir, archivePath);
  await validateArchive(source);
  const pending: PendingImport = { archivePath: source, scheduledAt: new Date().toISOString() };
  await ensurePrivateDir(path.dirname(rootDir));
  await writeFileAtomic(pendingPath(rootDir), `${JSON.stringify(pending)}\n`, { mode: 0o600 });
  return source;
}

export async function getPendingStewardDataImport(rootDir: string): Promise<string | null> {
  try {
    const pending = JSON.parse(await fs.readFile(pendingPath(rootDir), "utf-8")) as PendingImport;
    return typeof pending.archivePath === "string" ? pending.archivePath : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function cancelPendingStewardDataImport(rootDir: string): Promise<void> {
  await fs.rm(pendingPath(rootDir), { force: true });
}

export async function applyPendingStewardDataImport(rootDir: string): Promise<boolean> {
  const source = await getPendingStewardDataImport(rootDir);
  if (source === null) return false;
  await validateArchive(source);

  const parent = path.dirname(rootDir);
  const staging = path.join(parent, `.steward-import-${randomUUID()}`);
  const backup = path.join(parent, `.steward-backup-${randomUUID()}`);
  await ensurePrivateDir(staging);
  try {
    await extract({
      cwd: staging,
      file: source,
      gzip: true,
      strict: true,
      preservePaths: false,
      unlink: true,
    });
    const manifest = JSON.parse(
      await fs.readFile(path.join(staging, MANIFEST_NAME), "utf-8")
    ) as Partial<ArchiveManifest>;
    if (manifest.format !== "steward-data" || manifest.version !== 1) {
      throw new Error("Steward data archive has an unsupported format version.");
    }
    await fs.rm(path.join(staging, MANIFEST_NAME), { force: true });

    let movedCurrentRoot = false;
    try {
      await fs.rename(rootDir, backup);
      movedCurrentRoot = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await fs.rename(staging, rootDir);
    } catch (error) {
      if (movedCurrentRoot) await fs.rename(backup, rootDir);
      throw error;
    }
    await cancelPendingStewardDataImport(rootDir);
    await fs.rm(backup, { recursive: true, force: true });
    return true;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
