import { useCallback, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { Button } from "@/browser/components/Button/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/SelectPrimitive/SelectPrimitive";
import { useAPI } from "@/browser/contexts/API";
import { CUSTOM_EVENTS, createCustomEvent } from "@/common/constants/events";

interface CatalogSkill {
  skillId: string;
  name: string;
  owner?: string;
  repo?: string;
  installs: number;
  url: string;
  summary: string;
  source: "skills.sh" | "clawhub";
  installable: boolean;
  installed: boolean;
}

type SkillSourceFilter = "all" | CatalogSkill["source"];
type SkillStateFilter = "all" | "installed" | "available" | "review";
type SkillSort = "relevance" | "popular" | "name";

interface CatalogStatus {
  source: CatalogSkill["source"];
  available: boolean;
}

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function SkillsSection() {
  const { api } = useAPI();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSkill[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogStatus[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SkillSourceFilter>("all");
  const [stateFilter, setStateFilter] = useState<SkillStateFilter>("all");
  const [sort, setSort] = useState<SkillSort>("relevance");

  const visibleResults = useMemo(() => {
    const filtered = results.filter((skill) => {
      if (sourceFilter !== "all" && skill.source !== sourceFilter) return false;
      if (stateFilter === "installed" && !skill.installed) return false;
      if (stateFilter === "available" && (!skill.installable || skill.installed)) return false;
      if (stateFilter === "review" && skill.installable) return false;
      return true;
    });

    if (sort === "popular") return filtered.toSorted((a, b) => b.installs - a.installs);
    if (sort === "name") return filtered.toSorted((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [results, sourceFilter, stateFilter, sort]);

  const search = useCallback(async () => {
    const normalizedQuery = query.trim();
    if (!api || normalizedQuery.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const response = await api.agentSkills.catalogSearch({
        query: normalizedQuery,
        limit: 20,
      });
      setResults(response.skills);
      setCatalogs(response.catalogs);
      setHasSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill search failed");
    } finally {
      setSearching(false);
    }
  }, [api, query]);

  const install = useCallback(
    async (skill: CatalogSkill) => {
      if (!api || !skill.owner || !skill.repo || !skill.installable) return;
      setInstalling(skill.skillId);
      setError(null);
      try {
        const result = await api.agentSkills.installFromCatalog({
          owner: skill.owner,
          repo: skill.repo,
          skillId: skill.skillId,
        });
        if (!result.success) throw new Error(result.error ?? "Skill installation failed");
        setResults((current) =>
          current.map((entry) =>
            entry.skillId === skill.skillId ? { ...entry, installed: true } : entry
          )
        );
        window.dispatchEvent(createCustomEvent(CUSTOM_EVENTS.SKILLS_REFRESH_REQUESTED));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Skill installation failed");
      } finally {
        setInstalling(null);
      }
    },
    [api]
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted text-xs">
          Discover and install reusable agent skills. Global skills are stored in{" "}
          <code className="text-accent">~/.steward/app/skills</code>.
        </p>
      </div>

      <div className="border-border-medium bg-background-secondary rounded-md border p-4">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="text-accent h-4 w-4" />
          <h3 className="text-foreground text-sm font-medium">Skill catalogs</h3>
        </div>
        <p className="text-muted mb-3 text-xs">
          Federated search covers skills.sh and ClawHub. Community skills can execute instructions
          and scripts, so review their source and security report before installing.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openExternal("https://skills.sh/official")}
          >
            Official skills <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openExternal("https://github.com/anthropics/skills")}
          >
            Anthropic skills <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openExternal("https://skills.sh/audits")}
          >
            Security audits <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openExternal("https://clawhub.ai")}>
            ClawHub <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openExternal("https://www.skillhub.club")}
          >
            SkillHub <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openExternal("https://skillsmp.com")}
          >
            SkillsMP <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openExternal("https://docs.nvidia.com/skills")}
          >
            NVIDIA skills <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div>
        <h3 className="text-foreground mb-3 text-sm font-medium">Skill marketplace</h3>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills, e.g. React testing"
            aria-label="Search skill marketplace"
            className="border-border-medium bg-background-secondary text-foreground placeholder:text-muted min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={!api || query.trim().length < 2 || searching}>
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="text-muted h-4 w-4" />
          <Select
            value={sourceFilter}
            onValueChange={(value) => setSourceFilter(value as SkillSourceFilter)}
          >
            <SelectTrigger className="h-8 w-36" aria-label="Filter skills by source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="skills.sh">skills.sh</SelectItem>
              <SelectItem value="clawhub">ClawHub</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={stateFilter}
            onValueChange={(value) => setStateFilter(value as SkillStateFilter)}
          >
            <SelectTrigger className="h-8 w-40" aria-label="Filter skills by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="available">Ready to install</SelectItem>
              <SelectItem value="installed">Installed</SelectItem>
              <SelectItem value="review">Review required</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as SkillSort)}>
            <SelectTrigger className="h-8 w-36" aria-label="Sort skills">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">Relevance</SelectItem>
              <SelectItem value="popular">Most installed</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
          {hasSearched && (
            <span className="text-muted ml-auto text-xs">{visibleResults.length} results</span>
          )}
        </div>
        {catalogs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3" aria-label="Skill catalog status">
            {catalogs.map((catalog) => (
              <span key={catalog.source} className="text-muted flex items-center gap-1 text-xs">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${catalog.available ? "bg-success" : "bg-destructive"}`}
                />
                {catalog.source} {catalog.available ? "online" : "unavailable"}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {visibleResults.map((skill) => {
          const isInstalled = skill.installable && skill.installed;
          const isInstalling = installing === skill.skillId;
          return (
            <div
              key={`${skill.source}:${skill.owner ?? ""}/${skill.repo ?? ""}/${skill.skillId}`}
              className="border-border-medium bg-background-secondary flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-sm font-medium">{skill.name}</div>
                <div className="text-muted truncate text-xs">
                  {skill.source} · {skill.owner}
                  {skill.repo ? `/${skill.repo}` : ""} · {skill.installs.toLocaleString()} installs
                </div>
                {skill.summary && (
                  <div className="text-muted mt-1 line-clamp-2 text-xs">{skill.summary}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" onClick={() => openExternal(skill.url)}>
                  Review <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  disabled={!api || isInstalled || installing !== null}
                  onClick={() =>
                    skill.installable ? void install(skill) : openExternal(skill.url)
                  }
                >
                  {isInstalling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isInstalled ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                  {isInstalled
                    ? "Installed"
                    : isInstalling
                      ? "Installing"
                      : skill.installable
                        ? "Install"
                        : "Open catalog"}
                </Button>
              </div>
            </div>
          );
        })}
        {hasSearched && !searching && visibleResults.length === 0 && (
          <div className="border-border-medium text-muted rounded-md border border-dashed px-4 py-8 text-center text-sm">
            No skills match this search and filter combination.
          </div>
        )}
      </div>
    </div>
  );
}
