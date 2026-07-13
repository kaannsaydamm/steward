import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Plus, RefreshCw, Send, X } from "lucide-react";

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

interface TelegramConfig {
  enabled: boolean;
  workspaceId: string;
  agentId: "explore" | "plan" | "exec";
  allowedChatIds: string[];
}
interface TelegramStatus {
  running: boolean;
  tokenConfigured: boolean;
  lastError?: string;
  botUsername?: string;
}
interface WorkspaceChoice {
  id: string;
  name: string;
  title?: string;
  projectName: string;
}

export function TelegramSection() {
  const { api } = useAPI();
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const [bridge, workspaceList] = await Promise.all([
      api.telegram.get({}),
      api.workspace.list({}),
    ]);
    setConfig(bridge.config);
    setStatus(bridge.status);
    setWorkspaces(workspaceList);
  }, [api]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(getErrorMessage(cause)));
  }, [refresh]);

  const save = useCallback(
    async (next: TelegramConfig) => {
      if (!api) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        setConfig(await api.telegram.set(next));
        await refresh();
      } catch (cause) {
        setError(getErrorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [api, refresh]
  );

  if (!config || !status)
    return <div className="text-muted py-8 text-sm">Loading Telegram settings…</div>;

  const addChat = () => {
    const id = chatId.trim();
    if (!/^-?\d+$/u.test(id)) {
      setError("Telegram chat ID must be a number, optionally starting with - for groups.");
      return;
    }
    setChatId("");
    if (!config.allowedChatIds.includes(id))
      void save({ ...config, allowedChatIds: [...config.allowedChatIds, id].sort() });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-foreground text-sm font-medium">Telegram bridge</h3>
        <p className="text-muted mt-1 text-xs">
          Send work to a Steward agent from your phone. Unknown chats are denied and receive only
          their pairing ID.
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

      <section className="border-border-medium bg-background-secondary rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <MessageCircle className="text-accent h-4 w-4" />
          <div className="min-w-0 flex-1">
            <h4 className="text-foreground text-sm font-medium">Connection</h4>
            <p className="text-muted text-xs">
              Token: {status.tokenConfigured ? "configured" : "missing"} · Bridge:{" "}
              {status.running ? "running" : "stopped"}
              {status.botUsername ? ` · @${status.botUsername}` : ""}
            </p>
          </div>
          <Switch
            checked={config.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => void save({ ...config, enabled })}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!api) return;
              setBusy(true);
              setError(null);
              void api.telegram
                .test({})
                .then(({ username }) => {
                  setMessage(`Connected to @${username}`);
                  return refresh();
                })
                .catch((cause: unknown) => setError(getErrorMessage(cause)))
                .finally(() => setBusy(false));
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Test bot
          </Button>
        </div>
        {!status.tokenConfigured && (
          <p className="bg-warning/10 text-warning mt-3 rounded-md px-3 py-2 text-xs">
            Create the bot with @BotFather, then add its token as <code>TELEGRAM_BOT_TOKEN</code> in
            Settings → Secrets. The token is never copied into Telegram settings or audit logs.
          </p>
        )}
        {status.lastError && <p className="text-destructive mt-3 text-xs">{status.lastError}</p>}
      </section>

      <section className="border-border-medium bg-background-secondary space-y-3 rounded-md border p-4">
        <h4 className="text-foreground text-sm font-medium">Agent target</h4>
        {workspaces.length === 0 ? (
          <p className="text-muted text-sm">Create a workspace before enabling Telegram.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={config.workspaceId}
              onValueChange={(workspaceId) => void save({ ...config, workspaceId })}
            >
              <SelectTrigger aria-label="Telegram workspace">
                <SelectValue placeholder="Choose workspace" />
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
              value={config.agentId}
              onValueChange={(agentId) =>
                void save({ ...config, agentId: agentId as TelegramConfig["agentId"] })
              }
            >
              <SelectTrigger aria-label="Telegram agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="explore">Explore</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
                <SelectItem value="exec">Execute</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      <section className="border-border-medium bg-background-secondary rounded-md border p-4">
        <h4 className="text-foreground text-sm font-medium">Allowed chats</h4>
        <p className="text-muted mt-1 text-xs">
          Message the bot once to receive your numeric chat ID, then add it here.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addChat();
              }
            }}
            placeholder="Telegram chat ID"
            aria-label="Telegram chat ID"
            className="border-border-medium bg-background-primary text-foreground placeholder:text-muted min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <Button disabled={busy || !chatId.trim()} onClick={addChat}>
            <Plus className="h-4 w-4" /> Allow
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {config.allowedChatIds.map((id) => (
            <span
              key={id}
              className="border-border-medium bg-background-primary flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
            >
              <Send className="h-3 w-3" />
              {id}
              <button
                aria-label={`Remove Telegram chat ${id}`}
                disabled={busy}
                onClick={() =>
                  void save({
                    ...config,
                    allowedChatIds: config.allowedChatIds.filter((item) => item !== id),
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {config.allowedChatIds.length === 0 && (
            <span className="text-muted text-xs">No chats paired.</span>
          )}
        </div>
      </section>
    </div>
  );
}
