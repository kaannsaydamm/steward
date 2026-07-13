import { existsSync, lstatSync, mkdirSync, renameSync, rmSync, symlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LEGACY_MUX_DIR_NAME = ".cmux";
const MUX_DIR_NAME = ".mux";
const STEWARD_DIR_NAME = ".steward";
const STEWARD_APP_DIR_NAME = "app";

/**
 * Session-dir file holding the active chat history epoch (latest compaction
 * boundary onward). Example: ~/.mux/sessions/<workspace>/chat.jsonl
 */
export const CHAT_FILE_NAME = "chat.jsonl";

/**
 * Session-dir file holding sealed pre-boundary chat history. HistoryService
 * rotates everything before the latest durable context boundary out of
 * chat.jsonl into this append-only archive so per-turn reads/rewrites stay
 * O(active epoch) instead of O(lifetime history).
 */
export const CHAT_ARCHIVE_FILE_NAME = "chat-archive.jsonl";

/**
 * Per-workspace sidecar recording headless AI usage (status generation,
 * memory consolidation/harvest) that produces no chat.jsonl assistant row.
 * Appended by SessionUsageService.recordHeadlessUsage and ingested into the
 * analytics events table by the ETL so dashboard totals include this spend.
 */
export const HEADLESS_USAGE_FILE_NAME = "headless-usage.jsonl";

/**
 * Migrate data from the upstream ~/.mux location into Steward's namespaced home.
 *
 * Steward lives under ~/.steward/app so it can coexist with the earlier Rust
 * runtime, whose config and database already live directly under ~/.steward.
 */
export function migrateLegacyMuxHome(): void {
  // Explicit roots are commonly used for tests and isolated server instances.
  // They must never trigger a migration of the user's real home directory.
  // eslint-disable-next-line no-restricted-syntax, no-restricted-globals
  if (process.env.STEWARD_ROOT || process.env.MUX_ROOT) {
    return;
  }

  const home = homedir();
  const cmuxPath = join(home, LEGACY_MUX_DIR_NAME);
  const muxPath = join(home, MUX_DIR_NAME);
  const stewardRoot = join(home, STEWARD_DIR_NAME);
  const stewardAppPath = join(stewardRoot, STEWARD_APP_DIR_NAME);

  if (existsSync(stewardAppPath)) {
    return;
  }

  const legacyPath = existsSync(muxPath) ? muxPath : existsSync(cmuxPath) ? cmuxPath : null;
  if (legacyPath === null) {
    return;
  }

  mkdirSync(stewardRoot, { recursive: true });
  renameSync(legacyPath, stewardAppPath);

  try {
    symlinkSync(stewardAppPath, legacyPath, "dir");
  } catch {
    // Symlink creation may require elevated privileges on Windows. The data has
    // already migrated successfully, so compatibility linking is best-effort.
  }
}

const OBSOLETE_MUX_BIN_ARTIFACTS = ["agent-browser", "agent-browser.cmd"] as const;

/**
 * Remove obsolete mux-managed bin wrappers that are no longer created at startup.
 * Keep this startup migration narrow so we don't delete unrelated user-managed files.
 */
export function cleanupObsoleteMuxBinArtifacts(rootDir?: string): void {
  const binDir = join(rootDir ?? getMuxHome(), "bin");

  for (const artifactName of OBSOLETE_MUX_BIN_ARTIFACTS) {
    const artifactPath = join(binDir, artifactName);

    try {
      if (!existsSync(artifactPath)) {
        continue;
      }

      const stats = lstatSync(artifactPath);
      if (stats.isDirectory()) {
        continue;
      }

      rmSync(artifactPath, { force: true });
    } catch {
      // Startup cleanup is best-effort; permission drift on a stale wrapper should not
      // abort app launch or prevent the remaining artifacts from being cleaned up.
      continue;
    }
  }
}

/**
 * Get the root directory for all Steward configuration and data.
 * STEWARD_ROOT is canonical; MUX_ROOT remains a compatibility fallback.
 * Appends '-dev' suffix when NODE_ENV=development (explicit dev mode).
 *
 * This is a getter function to support test mocking of os.homedir().
 *
 * Note: This file is only used by main process code, but lives in constants/
 * for organizational purposes. The process.env access is safe.
 */
export function getMuxHome(): string {
  // eslint-disable-next-line no-restricted-syntax, no-restricted-globals
  if (process.env.STEWARD_ROOT) {
    // eslint-disable-next-line no-restricted-syntax, no-restricted-globals
    return process.env.STEWARD_ROOT;
  }

  // eslint-disable-next-line no-restricted-syntax, no-restricted-globals
  if (process.env.MUX_ROOT) {
    // eslint-disable-next-line no-restricted-syntax, no-restricted-globals
    return process.env.MUX_ROOT;
  }

  // Use -dev suffix only when explicitly in development mode
  // eslint-disable-next-line no-restricted-syntax, no-restricted-globals
  const suffix = process.env.NODE_ENV === "development" ? "-dev" : "";
  return join(homedir(), STEWARD_DIR_NAME, STEWARD_APP_DIR_NAME + suffix);
}

/**
 * Get the directory where workspace git worktrees are stored.
 * Example: ~/.mux/src/my-project/feature-branch
 *
 * @param rootDir - Optional root directory (defaults to getMuxHome())
 */
export function getMuxSrcDir(rootDir?: string): string {
  const root = rootDir ?? getMuxHome();
  return join(root, "src");
}

/**
 * Get the directory where session chat histories are stored.
 * Example: ~/.mux/sessions/workspace-id/chat.jsonl
 *
 * @param rootDir - Optional root directory (defaults to getMuxHome())
 */
export function getMuxSessionsDir(rootDir?: string): string {
  const root = rootDir ?? getMuxHome();
  return join(root, "sessions");
}

/**
 * Get the directory where mux backend logs are stored.
 * Example: ~/.mux/logs/mux.log
 *
 * @param rootDir - Optional root directory (defaults to getMuxHome())
 */
export function getMuxLogsDir(rootDir?: string): string {
  const root = rootDir ?? getMuxHome();
  return join(root, "logs");
}

/**
 * Get the default directory for new projects created with bare names.
 * Example: ~/.mux/projects/my-project
 *
 * @param rootDir - Optional root directory (defaults to getMuxHome())
 */
export function getMuxProjectsDir(rootDir?: string): string {
  const root = rootDir ?? getMuxHome();
  return join(root, "projects");
}

/**
 * Get the extension metadata file path (shared with VS Code extension).
 *
 * @param rootDir - Optional root directory (defaults to getMuxHome())
 */
export function getMuxExtensionMetadataPath(rootDir?: string): string {
  const root = rootDir ?? getMuxHome();
  return join(root, "extensionMetadata.json");
}
