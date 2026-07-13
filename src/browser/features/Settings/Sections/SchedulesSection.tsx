import { useCallback, useEffect, useState } from "react";
import { Clock3, Play, Plus, RefreshCw, Trash2 } from "lucide-react";

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
import { getErrorMessage } from "@/common/utils/errors";

interface WorkspaceChoice {
  id: string;
  name: string;
  title?: string;
  projectName: string;
}
interface ScheduledJob {
  id: string;
  name: string;
  workspaceId: string;
  prompt: string;
  agentId: "explore" | "plan" | "exec";
  intervalMinutes: number;
  enabled: boolean;
  createdAt: number;
  nextRunAt: number;
  lastRunAt?: number;
  lastStatus?: "started" | "failed";
  lastError?: string;
  lastTaskId?: string;
}

export function SchedulesSection() {
  const { api } = useAPI();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState<ScheduledJob["agentId"]>("exec");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const [nextJobs, nextWorkspaces] = await Promise.all([
      api.schedules.list({}),
      api.workspace.list({}),
    ]);
    setJobs(nextJobs);
    setWorkspaces(nextWorkspaces);
    setWorkspaceId((current) => current || nextWorkspaces[0]?.id || "");
  }, [api]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(getErrorMessage(cause)));
  }, [refresh]);

  const create = useCallback(async () => {
    if (!api) return;
    setBusy("create");
    setError(null);
    try {
      await api.schedules.create({ name, workspaceId, prompt, agentId, intervalMinutes });
      setName("");
      setPrompt("");
      await refresh();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }, [agentId, api, intervalMinutes, name, prompt, refresh, workspaceId]);

  const workspaceLabel = (id: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    return workspace ? `${workspace.title ?? workspace.name} · ${workspace.projectName}` : id;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-foreground text-sm font-medium">Scheduled agents</h3>
        <p className="text-muted mt-1 text-xs">
          Launch a real Steward agent task on a durable interval. Scheduled runs use the workspace's
          existing provider, model, tools, and policy.
        </p>
      </div>
      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <section className="border-border-medium bg-background-secondary space-y-3 rounded-md border p-4">
        <div className="flex items-center gap-2">
          <Plus className="text-accent h-4 w-4" />
          <h4 className="text-foreground text-sm font-medium">New schedule</h4>
        </div>
        {workspaces.length === 0 ? (
          <p className="text-muted rounded-md border border-dashed p-4 text-sm">
            Add a project and create a workspace before scheduling an agent.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Schedule name"
                aria-label="Schedule name"
                className="border-border-medium bg-background-primary text-foreground rounded-md border px-3 py-2 text-sm"
              />
              <Select value={workspaceId} onValueChange={setWorkspaceId}>
                <SelectTrigger aria-label="Schedule workspace">
                  <SelectValue placeholder="Workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.title ?? workspace.name} · {workspace.projectName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={agentId}
                onValueChange={(value) => setAgentId(value as ScheduledJob["agentId"])}
              >
                <SelectTrigger aria-label="Schedule agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="explore">Explore</SelectItem>
                  <SelectItem value="plan">Plan</SelectItem>
                  <SelectItem value="exec">Execute</SelectItem>
                </SelectContent>
              </Select>
              <label className="text-muted flex items-center gap-2 text-xs">
                Every
                <input
                  type="number"
                  min={1}
                  max={525600}
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                  aria-label="Schedule interval minutes"
                  className="border-border-medium bg-background-primary text-foreground w-28 rounded-md border px-3 py-2 text-sm"
                />{" "}
                minutes
              </label>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What should the scheduled agent accomplish?"
              aria-label="Schedule prompt"
              rows={5}
              className="border-border-medium bg-background-primary text-foreground placeholder:text-muted w-full resize-y rounded-md border px-3 py-2 text-sm"
            />
            <Button
              disabled={busy !== null || !name.trim() || !workspaceId || !prompt.trim()}
              onClick={() => void create()}
            >
              <Plus className="h-4 w-4" /> {busy === "create" ? "Creating…" : "Create schedule"}
            </Button>
          </>
        )}
      </section>

      <section className="border-border-medium bg-background-secondary rounded-md border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="text-accent h-4 w-4" />
          <h4 className="text-foreground text-sm font-medium">Schedules</h4>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
        <div className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="border-border-light bg-background-primary rounded-md border p-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  checked={job.enabled}
                  onCheckedChange={(enabled) => {
                    if (!api) return;
                    setBusy(job.id);
                    void api.schedules
                      .setEnabled({ id: job.id, enabled })
                      .then(refresh)
                      .catch((cause: unknown) => setError(getErrorMessage(cause)))
                      .finally(() => setBusy(null));
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate text-sm font-medium">{job.name}</div>
                  <div className="text-muted truncate text-xs">
                    {workspaceLabel(job.workspaceId)} · {job.agentId} · every {job.intervalMinutes}{" "}
                    min
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!api) return;
                    setBusy(job.id);
                    void api.schedules
                      .runNow({ id: job.id })
                      .then(refresh)
                      .catch((cause: unknown) => setError(getErrorMessage(cause)))
                      .finally(() => setBusy(null));
                  }}
                >
                  <Play className="h-3.5 w-3.5" /> Run now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!api || !window.confirm(`Delete schedule "${job.name}"?`)) return;
                    setBusy(job.id);
                    void api.schedules
                      .remove({ id: job.id })
                      .then(refresh)
                      .catch((cause: unknown) => setError(getErrorMessage(cause)))
                      .finally(() => setBusy(null));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-muted mt-2 line-clamp-2 text-xs">{job.prompt}</p>
              <div className="text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>
                  Next: {job.enabled ? new Date(job.nextRunAt).toLocaleString() : "disabled"}
                </span>
                <span>
                  Last:{" "}
                  {job.lastRunAt
                    ? `${job.lastStatus} · ${new Date(job.lastRunAt).toLocaleString()}`
                    : "never"}
                </span>
                {job.lastError && <span className="text-destructive">{job.lastError}</span>}
              </div>
            </div>
          ))}
          {jobs.length === 0 && (
            <div className="text-muted rounded-md border border-dashed px-4 py-8 text-center text-sm">
              No scheduled agents yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
