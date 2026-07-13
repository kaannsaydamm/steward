import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Clock, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";

import { Button } from "@/browser/components/Button/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/SelectPrimitive/SelectPrimitive";
import { Switch } from "@/browser/components/Switch/Switch";
import { useAPI } from "@/browser/contexts/API";

interface GovernanceConfig {
  auditEnabled: boolean;
  retentionDays: number;
  maxEntries: number;
  disabledTools: string[];
}

interface AuditEntry {
  id: string;
  workspaceId: string;
  toolName: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  outcome: "completed" | "failed";
}

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/u;

export function ToolGovernanceSection() {
  const { api } = useAPI();
  const [config, setConfig] = useState<GovernanceConfig | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [newTool, setNewTool] = useState("");
  const [outcome, setOutcome] = useState<"all" | AuditEntry["outcome"]>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAudit = useCallback(async () => {
    if (!api) return;
    const entries = await api.toolGovernance.listAudit({
      ...(outcome === "all" ? {} : { outcome }),
      limit: 500,
    });
    setAudit(entries);
  }, [api, outcome]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.toolGovernance.get({}), api.toolGovernance.listAudit({ limit: 500 })])
      .then(([nextConfig, entries]) => {
        if (cancelled) return;
        setConfig(nextConfig);
        setAudit(entries);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Governance failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    void refreshAudit().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Audit failed to load")
    );
  }, [refreshAudit]);

  const save = useCallback(
    async (next: GovernanceConfig) => {
      if (!api) return;
      setSaving(true);
      setError(null);
      try {
        setConfig(await api.toolGovernance.set(next));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Governance settings failed to save");
      } finally {
        setSaving(false);
      }
    },
    [api]
  );

  const addDisabledTool = useCallback(() => {
    const tool = newTool.trim();
    if (!config || !TOOL_NAME_PATTERN.test(tool)) {
      setError(
        "Use an exact tool name containing letters, numbers, dot, colon, dash, or underscore."
      );
      return;
    }
    if (config.disabledTools.includes(tool)) {
      setNewTool("");
      return;
    }
    setNewTool("");
    void save({ ...config, disabledTools: [...config.disabledTools, tool].sort() });
  }, [config, newTool, save]);

  const visibleAudit = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return audit;
    return audit.filter(
      (entry) =>
        entry.toolName.toLowerCase().includes(normalized) ||
        entry.workspaceId.toLowerCase().includes(normalized)
    );
  }, [audit, query]);

  if (loading || !config) {
    return <div className="text-muted py-8 text-sm">Loading tool governance…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-foreground text-sm font-medium">Tool governance</h3>
        <p className="text-muted mt-1 text-xs">
          Disable tools globally and review execution metadata. Audit entries never store tool
          arguments, results, prompts, or secrets.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <section className="border-border-medium bg-background-secondary rounded-md border p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="text-accent h-4 w-4" />
          <h4 className="text-foreground text-sm font-medium">Globally disabled tools</h4>
          {saving && <span className="text-muted ml-auto text-xs">Saving…</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={newTool}
            onChange={(event) => setNewTool(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDisabledTool();
              }
            }}
            placeholder="Exact tool name, e.g. bash"
            aria-label="Tool name to disable"
            className="border-border-medium bg-background-primary text-foreground placeholder:text-muted min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <Button onClick={addDisabledTool} disabled={saving || !newTool.trim()}>
            <Plus className="h-4 w-4" /> Disable
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {config.disabledTools.map((tool) => (
            <span
              key={tool}
              className="border-border-medium bg-background-primary text-foreground flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
            >
              {tool}
              <button
                type="button"
                className="text-muted hover:text-foreground"
                aria-label={`Enable ${tool}`}
                onClick={() =>
                  void save({
                    ...config,
                    disabledTools: config.disabledTools.filter((item) => item !== tool),
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {config.disabledTools.length === 0 && (
            <span className="text-muted text-xs">No tools are globally disabled.</span>
          )}
        </div>
      </section>

      <section className="border-border-medium bg-background-secondary rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <h4 className="text-foreground text-sm font-medium">Audit history</h4>
            <p className="text-muted text-xs">
              Compact local metadata stored under ~/.steward/app/audit.
            </p>
          </div>
          <label className="text-foreground flex items-center gap-2 text-sm">
            Record activity
            <Switch
              checked={config.auditEnabled}
              onCheckedChange={(checked) => void save({ ...config, auditEnabled: checked })}
            />
          </label>
          <Select
            value={String(config.retentionDays)}
            onValueChange={(value) => void save({ ...config, retentionDays: Number(value) })}
          >
            <SelectTrigger className="h-8 w-32" aria-label="Audit retention">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="365">1 year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by tool or workspace"
            aria-label="Filter audit history"
            className="border-border-medium bg-background-primary text-foreground placeholder:text-muted min-w-52 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <Select value={outcome} onValueChange={(value) => setOutcome(value as typeof outcome)}>
            <SelectTrigger className="h-9 w-32" aria-label="Filter audit outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="secondary" size="sm" onClick={() => void refreshAudit()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={audit.length === 0}
            onClick={() => {
              if (!api || !window.confirm("Clear the local tool audit history?")) return;
              void api.toolGovernance.clearAudit({}).then(() => setAudit([]));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>

        <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
          {visibleAudit.map((entry) => (
            <div
              key={`${entry.workspaceId}:${entry.id}`}
              className="border-border-light bg-background-primary flex flex-col gap-1 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
            >
              {entry.outcome === "completed" ? (
                <CheckCircle className="text-success h-4 w-4 shrink-0" />
              ) : (
                <X className="text-destructive h-4 w-4 shrink-0" />
              )}
              <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                {entry.toolName}
              </span>
              <span className="text-muted truncate text-xs">{entry.workspaceId}</span>
              <span className="text-muted flex items-center gap-1 text-xs">
                <Clock className="h-3 w-3" /> {entry.durationMs.toLocaleString()} ms
              </span>
              <time
                className="text-muted text-xs"
                dateTime={new Date(entry.completedAt).toISOString()}
              >
                {new Date(entry.completedAt).toLocaleString()}
              </time>
            </div>
          ))}
          {visibleAudit.length === 0 && (
            <div className="border-border-light text-muted rounded-md border border-dashed px-4 py-8 text-center text-sm">
              No matching tool activity yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
