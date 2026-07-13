import { useCallback, useEffect, useState } from "react";
import { Archive, Download, RotateCw, Upload, X } from "lucide-react";

import { Button } from "@/browser/components/Button/Button";
import { useAPI } from "@/browser/contexts/API";
import { getErrorMessage } from "@/common/utils/errors";

interface DataStatus {
  archivePath: string | null;
  dataRoot: string;
  defaultExportPath: string;
}

export function DataSection() {
  const { api } = useAPI();
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [exportPath, setExportPath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [busy, setBusy] = useState<"export" | "import" | "restart" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const next = await api.dataArchive.getPendingImport({});
    setStatus(next);
    setExportPath((current) => current || next.defaultExportPath);
    setImportPath((current) => current || next.archivePath || "");
  }, [api]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(getErrorMessage(cause)));
  }, [refresh]);

  const run = useCallback(
    async (kind: "export" | "import") => {
      if (!api) return;
      setBusy(kind);
      setError(null);
      setMessage(null);
      try {
        if (kind === "export") {
          const result = await api.dataArchive.export({ archivePath: exportPath.trim() });
          setMessage(`Portable archive created at ${result.archivePath}`);
        } else {
          if (
            !window.confirm(
              "Import replaces Steward configuration, sessions, skills, and local state on the next restart. Continue?"
            )
          ) {
            return;
          }
          const result = await api.dataArchive.scheduleImport({ archivePath: importPath.trim() });
          setMessage(`Import verified and queued from ${result.archivePath}. Restart to apply it.`);
          await refresh();
        }
      } catch (cause) {
        setError(getErrorMessage(cause));
      } finally {
        setBusy(null);
      }
    },
    [api, exportPath, importPath, refresh]
  );

  const restart = useCallback(async () => {
    if (!api) return;
    setBusy("restart");
    setError(null);
    try {
      const result = await api.general.restartApp();
      if (!result.supported) setError(result.message);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }, [api]);

  if (!status) return <div className="text-muted py-8 text-sm">Loading data settings…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-foreground text-sm font-medium">Data and portability</h3>
        <p className="text-muted mt-1 text-xs">
          Move Steward between machines with one compressed archive. The archive includes sessions,
          configuration, providers, skills, workflows, memory, and audit history.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-success/10 text-success rounded-md px-3 py-2 text-sm">{message}</div>
      )}

      <div className="border-border-medium bg-background-secondary rounded-md border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Archive className="text-accent h-4 w-4" />
          <div>
            <h4 className="text-foreground text-sm font-medium">Active data directory</h4>
            <code className="text-muted break-all text-xs">{status.dataRoot}</code>
          </div>
        </div>
      </div>

      <section className="border-border-medium bg-background-secondary rounded-md border p-4">
        <h4 className="text-foreground text-sm font-medium">Export all data</h4>
        <p className="text-muted mt-1 text-xs">
          Choose an absolute path outside the active data directory.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={exportPath}
            onChange={(event) => setExportPath(event.target.value)}
            aria-label="Export archive path"
            className="border-border-medium bg-background-primary text-foreground min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <Button disabled={!exportPath.trim() || busy !== null} onClick={() => void run("export")}>
            <Download className="h-4 w-4" /> {busy === "export" ? "Exporting…" : "Export"}
          </Button>
        </div>
      </section>

      <section className="border-border-medium bg-background-secondary rounded-md border p-4">
        <h4 className="text-foreground text-sm font-medium">Import all data</h4>
        <p className="text-muted mt-1 text-xs">
          Steward validates paths, links, format, size, and entry count before scheduling an import.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={importPath}
            onChange={(event) => setImportPath(event.target.value)}
            placeholder="Absolute path to a .steward.tgz archive"
            aria-label="Import archive path"
            className="border-border-medium bg-background-primary text-foreground placeholder:text-muted min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <Button disabled={!importPath.trim() || busy !== null} onClick={() => void run("import")}>
            <Upload className="h-4 w-4" /> {busy === "import" ? "Checking…" : "Verify & queue"}
          </Button>
        </div>

        {status.archivePath && (
          <div className="border-warning/30 bg-warning/10 mt-4 rounded-md border p-3">
            <p className="text-warning break-all text-xs">Pending import: {status.archivePath}</p>
            <div className="mt-3 flex gap-2">
              <Button disabled={busy !== null} onClick={() => void restart()}>
                <RotateCw className="h-4 w-4" />{" "}
                {busy === "restart" ? "Restarting…" : "Restart & apply"}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  if (!api) return;
                  void api.dataArchive.cancelPendingImport({}).then(() => {
                    setMessage("Pending import cancelled.");
                    return refresh();
                  });
                }}
              >
                <X className="h-4 w-4" /> Cancel import
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
