export interface ImportedWorkflowNode {
  id: string;
  type: "input" | "agent" | "action" | "output";
  title: string;
  position: { x: number; y: number };
  prompt?: string;
  agentId?: "explore" | "plan" | "exec";
  model?: string;
  actionKind?: "transform";
  config?: { target: string; operation: string; payload: string; options: string };
}

export interface ImportedWorkflowSpec {
  version: 2;
  slug: string;
  name: string;
  description: string;
  nodes: ImportedWorkflowNode[];
  edges: Array<{ id: string; source: string; target: string }>;
  updatedAt?: number;
}

interface ArchitectureNode {
  id: string;
  label?: string;
  subgraph_id?: string | null;
}

interface ArchitectureEdge {
  source: string;
  target: string;
}

interface ArchitectureGraph {
  metadata?: { source_file?: string };
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  subgraphs?: Array<{ id: string; node_ids?: string[] }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkflowSpec(value: unknown): value is ImportedWorkflowSpec {
  return (
    isRecord(value) &&
    value.version === 2 &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges)
  );
}

function isArchitectureGraph(value: unknown): value is ArchitectureGraph {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    value.nodes.every((node) => isRecord(node) && typeof node.id === "string") &&
    value.edges.every(
      (edge) => isRecord(edge) && typeof edge.source === "string" && typeof edge.target === "string"
    )
  );
}

function cleanTitle(label: string, fallback: string): string {
  const title =
    label
      .replace(/<br\s*\/?>/giu, " ")
      .split(/\\n|\r?\n/u)[0]
      ?.trim() || fallback;
  return Array.from(title).slice(0, 80).join("");
}

function cleanSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/\.[^.]+$/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 56);
  return slug.length >= 2 ? slug : "imported-workflow";
}

function uniqueId(value: string, used: Set<string>): string {
  const base = cleanSlug(value).slice(0, 56);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 56 - String(suffix).length)}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function uniqueEdges(edges: ArchitectureEdge[], nodeIds: Set<string>) {
  const seen = new Set<string>();
  return edges.flatMap((edge, index) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      return [];
    }
    const key = `${edge.source}\u0000${edge.target}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: `edge-import-${index}`, source: edge.source, target: edge.target }];
  });
}

export function architectureGraphToWorkflow(
  graph: ArchitectureGraph,
  fallbackName = "Imported architecture"
): ImportedWorkflowSpec {
  if (graph.nodes.length < 3) throw new Error("The imported graph needs at least three nodes");
  if (graph.nodes.length > 512) throw new Error("The imported graph exceeds the 512-node limit");

  const rawNodeIds = new Set(graph.nodes.map((node) => node.id));
  if (rawNodeIds.size !== graph.nodes.length) throw new Error("Imported node IDs must be unique");
  const usedIds = new Set<string>();
  const idMap = new Map(graph.nodes.map((node) => [node.id, uniqueId(node.id, usedIds)]));
  const groupNodes = new Map(
    (graph.subgraphs ?? []).map((group) => [
      group.id,
      (group.node_ids ?? []).filter((id) => rawNodeIds.has(id)),
    ])
  );
  const mappedEdges = graph.edges.flatMap((edge) => {
    const sourceRaw = rawNodeIds.has(edge.source)
      ? edge.source
      : groupNodes.get(edge.source)?.at(-1);
    const targetRaw = rawNodeIds.has(edge.target) ? edge.target : groupNodes.get(edge.target)?.[0];
    if (!sourceRaw || !targetRaw) return [];
    return [{ source: idMap.get(sourceRaw)!, target: idMap.get(targetRaw)! }];
  });
  const nodeIds = new Set(idMap.values());
  const edges = uniqueEdges(mappedEdges, nodeIds);
  if (edges.length < 2) throw new Error("The imported graph needs at least two valid edges");
  if (edges.length > 4096) throw new Error("The imported graph exceeds the 4096-edge limit");

  const incoming = new Set(edges.map((edge) => edge.target));
  const outgoing = new Set(edges.map((edge) => edge.source));
  const sources = graph.nodes.filter((node) => !incoming.has(idMap.get(node.id)!));
  const sinks = graph.nodes.filter((node) => !outgoing.has(idMap.get(node.id)!));
  const input =
    sources.find((node) => /^(user|input|start)$/iu.test(node.id)) ?? sources[0] ?? graph.nodes[0];
  const output =
    sinks.find((node) => /^(output|final|deploy|end)$/iu.test(node.id)) ??
    sinks.at(-1) ??
    graph.nodes.at(-1)!;
  if (input.id === output.id) throw new Error("Could not identify separate input and output nodes");

  const groupOrder = new Map<string, number>();
  for (const node of graph.nodes) {
    const group = node.subgraph_id ?? "ungrouped";
    if (!groupOrder.has(group)) groupOrder.set(group, groupOrder.size);
  }
  const groupOffsets = new Map<string, number>();
  const nodes = graph.nodes.map((node) => {
    const group = node.subgraph_id ?? "ungrouped";
    const itemIndex = groupOffsets.get(group) ?? 0;
    groupOffsets.set(group, itemIndex + 1);
    const groupIndex = groupOrder.get(group) ?? 0;
    const column = groupIndex % 5;
    const groupRow = Math.floor(groupIndex / 5);
    const position = {
      x: 80 + column * 340,
      y: 80 + groupRow * 520 + itemIndex * 150,
    };
    const label = node.label?.trim() || node.id;
    const common = { id: idMap.get(node.id)!, title: cleanTitle(label, node.id), position };
    if (node.id === input.id) return { ...common, type: "input" as const };
    if (node.id === output.id) return { ...common, type: "output" as const };
    return {
      ...common,
      type: "action" as const,
      actionKind: "transform" as const,
      config: {
        target: "",
        operation: label.slice(0, 20_000),
        payload: "",
        options: JSON.stringify({ importedGroup: node.subgraph_id ?? null }),
      },
    };
  });
  const sourceFile = graph.metadata?.source_file?.trim() || fallbackName;
  return {
    version: 2,
    slug: cleanSlug(sourceFile),
    name: cleanTitle(sourceFile, fallbackName),
    description: `Imported editable graph with ${nodes.length} nodes and ${edges.length} connections.`,
    nodes,
    edges,
  };
}

async function mermaidToArchitecture(text: string): Promise<ArchitectureGraph> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(text);
  const db = diagram.db as {
    getVertices?: () => Map<string, { id: string; text?: string }>;
    getEdges?: () => Array<{ start: string; end: string }>;
    getSubGraphs?: () => Array<{ id: string; nodes: string[] }>;
  };
  if (!db.getVertices || !db.getEdges) {
    throw new Error("Only Mermaid flowchart/graph diagrams can be imported into the builder");
  }
  const groups = db.getSubGraphs?.() ?? [];
  const groupByNode = new Map(groups.flatMap((group) => group.nodes.map((id) => [id, group.id])));
  return {
    nodes: [...db.getVertices().values()].map((node) => ({
      id: node.id,
      label: node.text,
      subgraph_id: groupByNode.get(node.id) ?? null,
    })),
    edges: db.getEdges().map((edge) => ({ source: edge.start, target: edge.end })),
    subgraphs: groups.map((group) => ({ id: group.id, node_ids: group.nodes })),
  };
}

export async function importWorkflowText(
  text: string,
  filename: string
): Promise<ImportedWorkflowSpec> {
  if (/\.(mmd|mermaid)$/iu.test(filename)) {
    return architectureGraphToWorkflow(await mermaidToArchitecture(text), filename);
  }
  const parsed: unknown = JSON.parse(text);
  if (isWorkflowSpec(parsed)) return parsed;
  if (isArchitectureGraph(parsed)) return architectureGraphToWorkflow(parsed, filename);
  throw new Error(
    "Expected Steward workflow JSON, architecture graph JSON, or a Mermaid flowchart"
  );
}
