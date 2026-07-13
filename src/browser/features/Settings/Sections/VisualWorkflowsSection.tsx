import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bell,
  Bot,
  Box,
  Braces,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  FlaskConical,
  GitBranch,
  Globe2,
  Hammer,
  Link2,
  Maximize2,
  Minimize2,
  Minus,
  Network,
  Play,
  Plug,
  Plus,
  Save,
  Server,
  Sparkles,
  Radio,
  Repeat2,
  Terminal,
  Trash2,
  Upload,
  Workflow,
  ZoomIn,
} from "lucide-react";

import { Button } from "@/browser/components/Button/Button";
import { ModelSelector } from "@/browser/components/ModelSelector/ModelSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/SelectPrimitive/SelectPrimitive";
import { useAPI } from "@/browser/contexts/API";
import { useProvidersConfig } from "@/browser/hooks/useProvidersConfig";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import { getErrorMessage } from "@/common/utils/errors";
import { getProviderModelEntryId } from "@/common/utils/providers/modelEntries";
import { importWorkflowText } from "./visualWorkflowImport";

type AgentId = "explore" | "plan" | "exec";
type ActionKind =
  | "http-request"
  | "websocket"
  | "shell"
  | "powershell"
  | "ssh"
  | "file-read"
  | "file-write"
  | "build"
  | "test"
  | "git"
  | "mcp-tool"
  | "subworkflow"
  | "transform"
  | "container"
  | "database"
  | "notification";
type BuilderNodeKind = AgentId | ActionKind;
interface ActionConfig {
  target: string;
  operation: string;
  payload: string;
  options: string;
}
type WorkflowNode =
  | { id: string; type: "input"; title: string; position: Position }
  | {
      id: string;
      type: "agent";
      title: string;
      prompt: string;
      agentId: AgentId;
      model?: string;
      position: Position;
    }
  | {
      id: string;
      type: "action";
      title: string;
      actionKind: ActionKind;
      config: ActionConfig;
      position: Position;
    }
  | { id: string; type: "output"; title: string; position: Position };
interface Position {
  x: number;
  y: number;
}
interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}
interface WorkflowSpec {
  version: 2;
  slug: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt?: number;
}
interface WorkspaceChoice {
  id: string;
  name: string;
  title?: string;
  projectName: string;
  taskModelString?: string;
  aiSettings?: { model: string };
  aiSettingsByAgent?: Record<string, { model: string }>;
}

interface AiBuildMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ActionDefinition {
  kind: ActionKind;
  title: string;
  category: "Network" | "System" | "Development" | "Data" | "Orchestration";
  description: string;
  targetLabel: string;
  operationLabel: string;
  payloadLabel: string;
  optionsLabel: string;
  defaults: ActionConfig;
}

const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    kind: "http-request",
    title: "HTTP / API",
    category: "Network",
    description: "Call REST or compatible API endpoints",
    targetLabel: "Endpoint URL",
    operationLabel: "Method",
    payloadLabel: "Body",
    optionsLabel: "Headers/options",
    defaults: {
      target: "https://api.example.com/v1/resource",
      operation: "GET",
      payload: "",
      options: "{}",
    },
  },
  {
    kind: "websocket",
    title: "WebSocket",
    category: "Network",
    description: "Connect, emit, and receive frames",
    targetLabel: "WebSocket URL",
    operationLabel: "Message / event",
    payloadLabel: "Payload",
    optionsLabel: "Headers/timeout",
    defaults: {
      target: "wss://example.com/socket",
      operation: "message",
      payload: "{}",
      options: "{}",
    },
  },
  {
    kind: "ssh",
    title: "SSH remote",
    category: "Network",
    description: "Run a command on another machine",
    targetLabel: "Host / SSH alias",
    operationLabel: "Remote command",
    payloadLabel: "Input",
    optionsLabel: "Port/user/options",
    defaults: { target: "server-alias", operation: "uname -a", payload: "", options: "" },
  },
  {
    kind: "notification",
    title: "Notification",
    category: "Network",
    description: "Send webhook, chat, mail, or alert",
    targetLabel: "Channel / endpoint",
    operationLabel: "Message",
    payloadLabel: "Structured payload",
    optionsLabel: "Provider options",
    defaults: {
      target: "configured-channel",
      operation: "Workflow completed",
      payload: "{}",
      options: "",
    },
  },
  {
    kind: "shell",
    title: "Shell command",
    category: "System",
    description: "Run a Bash/sh command",
    targetLabel: "Working directory",
    operationLabel: "Command",
    payloadLabel: "stdin",
    optionsLabel: "Environment/options",
    defaults: { target: ".", operation: "pwd", payload: "", options: "" },
  },
  {
    kind: "powershell",
    title: "PowerShell",
    category: "System",
    description: "Run a native PowerShell operation",
    targetLabel: "Working directory",
    operationLabel: "Command",
    payloadLabel: "stdin",
    optionsLabel: "Environment/options",
    defaults: { target: ".", operation: "Get-Location", payload: "", options: "" },
  },
  {
    kind: "file-read",
    title: "Read file",
    category: "System",
    description: "Read workspace files and metadata",
    targetLabel: "File path",
    operationLabel: "Read mode",
    payloadLabel: "Selection/query",
    optionsLabel: "Encoding/options",
    defaults: { target: "README.md", operation: "text", payload: "", options: "" },
  },
  {
    kind: "file-write",
    title: "Write file",
    category: "System",
    description: "Create or update a workspace file",
    targetLabel: "File path",
    operationLabel: "Write mode",
    payloadLabel: "Content",
    optionsLabel: "Encoding/options",
    defaults: { target: "output.txt", operation: "replace", payload: "", options: "" },
  },
  {
    kind: "build",
    title: "Build / compile",
    category: "Development",
    description: "Compile and collect artifacts",
    targetLabel: "Project directory",
    operationLabel: "Build command",
    payloadLabel: "Build input",
    optionsLabel: "Environment/options",
    defaults: { target: ".", operation: "npm run build", payload: "", options: "" },
  },
  {
    kind: "test",
    title: "Test suite",
    category: "Development",
    description: "Run tests and return failures",
    targetLabel: "Project directory",
    operationLabel: "Test command",
    payloadLabel: "Test filter/input",
    optionsLabel: "Environment/options",
    defaults: { target: ".", operation: "npm test", payload: "", options: "" },
  },
  {
    kind: "git",
    title: "Git",
    category: "Development",
    description: "Status, branch, commit, fetch, or PR",
    targetLabel: "Repository",
    operationLabel: "Git operation",
    payloadLabel: "Message/input",
    optionsLabel: "Options",
    defaults: { target: ".", operation: "git status --short", payload: "", options: "" },
  },
  {
    kind: "container",
    title: "Container",
    category: "Development",
    description: "Run in Docker, Podman, or a container",
    targetLabel: "Container / runtime",
    operationLabel: "Command",
    payloadLabel: "stdin",
    optionsLabel: "Mount/network/options",
    defaults: { target: "docker", operation: "docker ps", payload: "", options: "" },
  },
  {
    kind: "database",
    title: "Database",
    category: "Data",
    description: "Run a parameterized database action",
    targetLabel: "Connection name",
    operationLabel: "Query / operation",
    payloadLabel: "Parameters JSON",
    optionsLabel: "Transaction/options",
    defaults: {
      target: "configured-connection",
      operation: "SELECT 1",
      payload: "{}",
      options: "read-only",
    },
  },
  {
    kind: "transform",
    title: "Transform data",
    category: "Data",
    description: "Map, filter, normalize, or reshape",
    targetLabel: "Output shape",
    operationLabel: "Transformation",
    payloadLabel: "Constants/schema",
    optionsLabel: "Validation options",
    defaults: {
      target: "JSON",
      operation: "Normalize the upstream result",
      payload: "{}",
      options: "",
    },
  },
  {
    kind: "mcp-tool",
    title: "MCP tool",
    category: "Orchestration",
    description: "Invoke a configured MCP tool",
    targetLabel: "MCP server",
    operationLabel: "Tool name",
    payloadLabel: "Arguments JSON",
    optionsLabel: "Timeout/options",
    defaults: { target: "server-name", operation: "tool-name", payload: "{}", options: "" },
  },
  {
    kind: "subworkflow",
    title: "Sub-workflow",
    category: "Orchestration",
    description: "Run another durable Steward workflow",
    targetLabel: "Workflow path / skill URI",
    operationLabel: "Run mode",
    payloadLabel: "Arguments JSON",
    optionsLabel: "Resume/options",
    defaults: {
      target: "skill://workflow/workflow.js",
      operation: "foreground",
      payload: "{}",
      options: "",
    },
  },
];

function isAgentId(value: BuilderNodeKind): value is AgentId {
  return value === "explore" || value === "plan" || value === "exec";
}

function actionIcon(kind: ActionKind) {
  if (kind === "http-request") return Globe2;
  if (kind === "websocket") return Radio;
  if (kind === "ssh") return Server;
  if (kind === "file-read" || kind === "file-write") return FileText;
  if (kind === "build") return Hammer;
  if (kind === "test") return FlaskConical;
  if (kind === "git") return GitBranch;
  if (kind === "mcp-tool") return Plug;
  if (kind === "subworkflow") return Repeat2;
  if (kind === "container") return Box;
  if (kind === "notification") return Bell;
  return Terminal;
}

const MIN_CANVAS_WIDTH = 1800;
const MIN_CANVAS_HEIGHT = 1000;
const CANVAS_GROWTH_MARGIN = 800;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 116;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 20) / 20));
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63);
}

function createDraft(): WorkflowSpec {
  const agentId = newId("agent");
  return {
    version: 2,
    slug: "",
    name: "My agent workflow",
    description: "A reusable visual agent graph.",
    nodes: [
      { id: "workflow-input", type: "input", title: "Workflow input", position: { x: 60, y: 280 } },
      {
        id: agentId,
        type: "agent",
        title: "Agent step",
        prompt: "Describe what this agent should accomplish.",
        agentId: "exec",
        position: { x: 370, y: 280 },
      },
      {
        id: "workflow-output",
        type: "output",
        title: "Final report",
        position: { x: 700, y: 280 },
      },
    ],
    edges: [
      { id: newId("edge"), source: "workflow-input", target: agentId },
      { id: newId("edge"), source: agentId, target: "workflow-output" },
    ],
  };
}

function persistedPayload(spec: WorkflowSpec) {
  return {
    version: 2 as const,
    slug: spec.slug || slugify(spec.name),
    name: spec.name.trim(),
    description: spec.description.trim(),
    nodes: spec.nodes,
    edges: spec.edges,
  };
}

function nodeInputPoint(node: WorkflowNode): Position {
  return { x: node.position.x, y: node.position.y + NODE_HEIGHT / 2 };
}

function nodeOutputPoint(node: WorkflowNode): Position {
  return { x: node.position.x + NODE_WIDTH, y: node.position.y + NODE_HEIGHT / 2 };
}

function WorkflowCanvas(props: {
  spec: WorkflowSpec;
  selectedId: string | null;
  selectedEdgeId: string | null;
  connectSource: string | null;
  expanded: boolean;
  onSelect: (id: string) => void;
  onSelectEdge: (id: string | null) => void;
  onMove: (id: string, position: Position) => void;
  onAdd: (kind: BuilderNodeKind, position: Position) => void;
  onSetConnectSource: (id: string | null) => void;
  onConnectNodes: (source: string, target: string) => void;
  onRemoveEdge: (id: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.8);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [connectionPoint, setConnectionPoint] = useState<Position | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    origin: Position;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const connectionDragRef = useRef<{
    source: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const ignoreConnectionClickRef = useRef(false);
  const nodeById = useMemo(
    () => new Map(props.spec.nodes.map((node) => [node.id, node])),
    [props.spec.nodes]
  );
  const canvasSize = useMemo(() => {
    const farthestX = Math.max(
      MIN_CANVAS_WIDTH,
      ...props.spec.nodes.map((node) => node.position.x + NODE_WIDTH + CANVAS_GROWTH_MARGIN)
    );
    const farthestY = Math.max(
      MIN_CANVAS_HEIGHT,
      ...props.spec.nodes.map((node) => node.position.y + NODE_HEIGHT + CANVAS_GROWTH_MARGIN)
    );
    return {
      width: Math.max(farthestX, viewportSize.width / zoom + CANVAS_GROWTH_MARGIN),
      height: Math.max(farthestY, viewportSize.height / zoom + CANVAS_GROWTH_MARGIN),
    };
  }, [props.spec.nodes, viewportSize.height, viewportSize.width, zoom]);
  const stageByNode = useMemo(() => {
    const stages = new Map<string, number>();
    const input = props.spec.nodes.find((node) => node.type === "input");
    if (input) stages.set(input.id, 0);
    for (let pass = 0; pass < props.spec.nodes.length; pass += 1) {
      let changed = false;
      for (const edge of props.spec.edges) {
        const sourceStage = stages.get(edge.source);
        if (sourceStage === undefined) continue;
        const nextStage = sourceStage + 1;
        if ((stages.get(edge.target) ?? -1) < nextStage) {
          stages.set(edge.target, nextStage);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return stages;
  }, [props.spec.edges, props.spec.nodes]);

  const canvasPoint = (clientX: number, clientY: number): Position | null => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return { x: (clientX - bounds.left) / zoom, y: (clientY - bounds.top) / zoom };
  };

  const setZoomAt = useCallback(
    (requestedZoom: number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current;
      const nextZoom = clampZoom(requestedZoom);
      if (!viewport || nextZoom === zoom) return;
      const bounds = viewport.getBoundingClientRect();
      const anchorX = clientX === undefined ? viewport.clientWidth / 2 : clientX - bounds.left;
      const anchorY = clientY === undefined ? viewport.clientHeight / 2 : clientY - bounds.top;
      const contentX = (viewport.scrollLeft + anchorX) / zoom;
      const contentY = (viewport.scrollTop + anchorY) / zoom;
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        viewport.scrollLeft = contentX * nextZoom - anchorX;
        viewport.scrollTop = contentY * nextZoom - anchorY;
      });
    },
    [zoom]
  );

  const fitCanvas = () => {
    const viewport = viewportRef.current;
    if (!viewport || props.spec.nodes.length === 0) return;
    const minX = Math.min(...props.spec.nodes.map((node) => node.position.x));
    const minY = Math.min(...props.spec.nodes.map((node) => node.position.y));
    const maxX = Math.max(...props.spec.nodes.map((node) => node.position.x + NODE_WIDTH));
    const maxY = Math.max(...props.spec.nodes.map((node) => node.position.y + NODE_HEIGHT));
    const padding = 80;
    const fitted = clampZoom(
      Math.min(
        (viewport.clientWidth - 32) / (maxX - minX + padding * 2),
        (viewport.clientHeight - 32) / (maxY - minY + padding * 2),
        1
      )
    );
    setZoom(fitted);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (minX - padding) * fitted);
      viewport.scrollTop = Math.max(0, (minY - padding) * fitted);
    });
  };

  useEffect(() => {
    const frame = requestAnimationFrame(fitCanvas);
    return () => cancelAnimationFrame(frame);
    // Preserve the user's viewport after the initial graph fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      setZoomAt(zoom + (event.deltaY < 0 ? 0.1 : -0.1), event.clientX, event.clientY);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [setZoomAt, zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () =>
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-w-0">
      <div
        ref={viewportRef}
        aria-label="Workflow canvas"
        className={`border-border-medium bg-background-primary active:cursor-grabbing overflow-auto rounded-lg border select-none ${
          props.expanded ? "h-[calc(100vh-190px)] min-h-[620px]" : "h-[clamp(560px,68vh,820px)]"
        }`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement;
          if (target.closest("[data-workflow-node], [data-canvas-control]")) return;
          const viewport = viewportRef.current;
          if (!viewport) return;
          panRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
          };
          viewport.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pan = panRef.current;
          const viewport = viewportRef.current;
          if (!pan || !viewport || pan.pointerId !== event.pointerId) return;
          viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
          viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
        }}
        onPointerUp={(event) => {
          if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
        }}
      >
        <div style={{ width: canvasSize.width * zoom, height: canvasSize.height * zoom }}>
          <div
            ref={canvasRef}
            className="relative origin-top-left"
            style={{
              width: canvasSize.width,
              height: canvasSize.height,
              transform: `scale(${zoom})`,
            }}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes("application/steward-node") ||
                event.dataTransfer.types.includes("text/plain")
              )
                event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const kind = (event.dataTransfer.getData("application/steward-node") ||
                event.dataTransfer.getData("text/plain")) as BuilderNodeKind;
              if (
                ![
                  "explore",
                  "plan",
                  "exec",
                  ...ACTION_DEFINITIONS.map((item) => item.kind),
                ].includes(kind)
              )
                return;
              const point = canvasPoint(event.clientX, event.clientY);
              if (!point) return;
              props.onAdd(kind, {
                x: Math.max(0, point.x - NODE_WIDTH / 2),
                y: Math.max(0, point.y - NODE_HEIGHT / 2),
              });
            }}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              <title>Workflow connections</title>
              <defs>
                <marker
                  id="workflow-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" className="fill-accent" />
                </marker>
              </defs>
              {props.spec.edges.map((edge) => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                if (!source || !target) return null;
                const from = nodeOutputPoint(source);
                const to = nodeInputPoint(target);
                const curve = Math.max(80, Math.abs(to.x - from.x) / 2);
                const direction = to.x >= from.x ? 1 : -1;
                const path = `M ${from.x} ${from.y} C ${from.x + curve * direction} ${from.y}, ${to.x - curve * direction} ${to.y}, ${to.x} ${to.y}`;
                return (
                  <g key={edge.id}>
                    <path
                      d={path}
                      fill="none"
                      className={`pointer-events-none ${
                        props.selectedEdgeId === edge.id ? "stroke-success" : "stroke-accent"
                      }`}
                      strokeWidth={props.selectedEdgeId === edge.id ? 4 : 2}
                      markerEnd="url(#workflow-arrow)"
                    />
                  </g>
                );
              })}
              {connectionPoint &&
                props.connectSource &&
                nodeById.get(props.connectSource) &&
                (() => {
                  const source = nodeById.get(props.connectSource)!;
                  const from = nodeOutputPoint(source);
                  return (
                    <path
                      d={`M ${from.x} ${from.y} L ${connectionPoint.x} ${connectionPoint.y}`}
                      fill="none"
                      className="stroke-success pointer-events-none"
                      strokeWidth="3"
                      strokeDasharray="8 6"
                    />
                  );
                })()}
            </svg>
            {props.spec.edges.map((edge) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              if (!source || !target) return null;
              const from = nodeOutputPoint(source);
              const to = nodeInputPoint(target);
              return (
                <button
                  key={`control-${edge.id}`}
                  type="button"
                  data-canvas-control
                  aria-label={`Select connection from ${source.title} to ${target.title}`}
                  title="Select this arrow"
                  className={`absolute z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold shadow-sm ${
                    props.selectedEdgeId === edge.id
                      ? "border-success bg-success text-white"
                      : "border-accent bg-background-secondary text-accent hover:bg-accent hover:text-white"
                  }`}
                  style={{
                    position: "absolute",
                    left: (from.x + to.x) / 2 - 12,
                    top: (from.y + to.y) / 2 - 12,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelectEdge(edge.id);
                  }}
                >
                  {stageByNode.get(edge.target) ?? "?"}
                </button>
              );
            })}
            {props.spec.nodes.map((node) => {
              const selected = props.selectedId === node.id;
              const connecting = props.connectSource === node.id;
              const ActionIcon = node.type === "action" ? actionIcon(node.actionKind) : null;
              return (
                <div
                  key={node.id}
                  data-workflow-node
                  className="absolute touch-none"
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                  }}
                >
                  <button
                    type="button"
                    aria-label={`${node.title} workflow node`}
                    className={`h-full w-full rounded-lg border p-0 text-left shadow-sm transition-shadow ${
                      selected
                        ? "border-accent bg-background-secondary ring-accent/30 ring-2"
                        : "border-border-medium bg-background-secondary hover:border-accent/60"
                    } ${connecting ? "ring-success ring-2" : ""}`}
                    onClick={() => {
                      props.onSelectEdge(null);
                      props.onSelect(node.id);
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      dragRef.current = {
                        id: node.id,
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        origin: node.position,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const drag = dragRef.current;
                      if (!drag || drag.id !== node.id || drag.pointerId !== event.pointerId)
                        return;
                      props.onMove(node.id, {
                        x: Math.max(0, drag.origin.x + (event.clientX - drag.startX) / zoom),
                        y: Math.max(0, drag.origin.y + (event.clientY - drag.startY) / zoom),
                      });
                    }}
                    onPointerUp={(event) => {
                      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
                    }}
                  >
                    <div className="border-border-light flex items-center gap-2 border-b px-3 py-2">
                      {node.type === "agent" ? (
                        <Bot className="text-accent h-4 w-4" />
                      ) : ActionIcon ? (
                        <ActionIcon className="text-accent h-4 w-4" />
                      ) : (
                        <Network className="text-muted h-4 w-4" />
                      )}
                      <span className="text-foreground truncate text-sm font-medium">
                        {node.title}
                      </span>
                      <span className="text-muted ml-auto text-[10px] uppercase">
                        {node.type === "agent"
                          ? node.agentId
                          : node.type === "action"
                            ? node.actionKind
                            : node.type}
                      </span>
                    </div>
                    <div className="text-muted line-clamp-3 px-3 py-2 text-xs">
                      {node.type === "agent"
                        ? node.prompt
                        : node.type === "action"
                          ? `${node.config.operation} · ${node.config.target}`
                          : node.type === "input"
                            ? "Input passed to the graph"
                            : "Combined final branch result"}
                    </div>
                  </button>
                  {node.type !== "input" && (
                    <button
                      type="button"
                      data-canvas-control
                      data-connect-target={node.id}
                      aria-label={`Connect into ${node.title}`}
                      title="Drop a connection here"
                      className={`border-background-primary absolute h-5 w-5 rounded-full border-4 ${
                        props.connectSource ? "bg-success scale-125" : "bg-accent"
                      }`}
                      style={{ position: "absolute", left: -10, top: NODE_HEIGHT / 2 - 10 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (props.connectSource) props.onConnectNodes(props.connectSource, node.id);
                      }}
                    />
                  )}
                  {node.type !== "output" && (
                    <button
                      type="button"
                      data-canvas-control
                      aria-label={`Start connection from ${node.title}`}
                      title="Drag to another node or click, then choose a target"
                      className={`border-background-primary absolute h-5 w-5 rounded-full border-4 ${
                        connecting ? "bg-success scale-125" : "bg-accent"
                      }`}
                      style={{ position: "absolute", right: -10, top: NODE_HEIGHT / 2 - 10 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (ignoreConnectionClickRef.current) return;
                        props.onSetConnectSource(connecting ? null : node.id);
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.stopPropagation();
                        connectionDragRef.current = {
                          source: node.id,
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          startY: event.clientY,
                          moved: false,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const drag = connectionDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        if (
                          !drag.moved &&
                          Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4
                        ) {
                          drag.moved = true;
                          props.onSetConnectSource(node.id);
                        }
                        if (drag.moved) {
                          const point = canvasPoint(event.clientX, event.clientY);
                          if (point) setConnectionPoint(point);
                        }
                      }}
                      onPointerUp={(event) => {
                        const drag = connectionDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        const target = document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest<HTMLElement>("[data-connect-target]")?.dataset.connectTarget;
                        if (drag.moved) {
                          ignoreConnectionClickRef.current = true;
                          setTimeout(() => {
                            ignoreConnectionClickRef.current = false;
                          }, 0);
                        }
                        if (target) props.onConnectNodes(drag.source, target);
                        else if (drag.moved) props.onSetConnectSource(null);
                        connectionDragRef.current = null;
                        setConnectionPoint(null);
                      }}
                    />
                  )}
                </div>
              );
            })}
            {props.connectSource && (
              <div className="bg-success/15 text-success absolute top-3 left-3 rounded px-3 py-2 text-xs font-medium">
                Select a target node. Esc cancels.
              </div>
            )}
            <div className="text-muted pointer-events-none absolute top-3 right-3 rounded bg-black/25 px-2 py-1 text-[11px]">
              Drag background to pan · Ctrl + wheel to zoom
            </div>
          </div>
        </div>
      </div>
      <div
        data-canvas-control
        className="border-border-medium bg-background-secondary/95 absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border p-1 shadow-lg backdrop-blur"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom out workflow"
          title="Zoom out"
          onClick={() => setZoomAt(zoom - 0.1)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="text-foreground w-14 text-center text-xs font-medium">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom in workflow"
          title="Zoom in"
          onClick={() => setZoomAt(zoom + 0.1)}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fit workflow to view"
          title="Fit workflow to view"
          onClick={fitCanvas}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        {props.selectedEdgeId && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => props.onRemoveEdge(props.selectedEdgeId!)}
          >
            <Trash2 className="h-4 w-4" /> Delete arrow
          </Button>
        )}
      </div>
    </div>
  );
}

export function VisualWorkflowsSection() {
  const { api } = useAPI();
  const { config: providersConfig } = useProvidersConfig();
  const [saved, setSaved] = useState<WorkflowSpec[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [spec, setSpec] = useState<WorkflowSpec>(() => createDraft());
  const [view, setView] = useState<"visual" | "json" | "code">("visual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [expandedCanvas, setExpandedCanvas] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [compiledSource, setCompiledSource] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [runInput, setRunInput] = useState("");
  const [aiRequest, setAiRequest] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiMessages, setAiMessages] = useState<AiBuildMessage[]>([]);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const [nextSaved, nextWorkspaces] = await Promise.all([
      api.visualWorkflows.list({}),
      api.workspace.list({}),
    ]);
    setSaved(nextSaved);
    setWorkspaces(nextWorkspaces);
    setWorkspaceId((current) => current || nextWorkspaces[0]?.id || "");
    setAiModel(
      (current) =>
        current ||
        nextWorkspaces[0]?.aiSettingsByAgent?.exec?.model ||
        nextWorkspaces[0]?.aiSettings?.model ||
        nextWorkspaces[0]?.taskModelString ||
        ""
    );
  }, [api]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(getErrorMessage(cause)));
  }, [refresh]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConnectSource(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  const selectedNode = spec.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedActionDefinition =
    selectedNode?.type === "action"
      ? ACTION_DEFINITIONS.find((item) => item.kind === selectedNode.actionKind)
      : null;
  const normalizedPaletteQuery = paletteQuery.trim().toLowerCase();
  const visibleActions = ACTION_DEFINITIONS.filter((item) =>
    `${item.title} ${item.category} ${item.description}`
      .toLowerCase()
      .includes(normalizedPaletteQuery)
  );
  const availableModels = useMemo(() => {
    const models = new Set<string>(Object.values(KNOWN_MODELS).map((model) => model.id));
    for (const [provider, providerConfig] of Object.entries(providersConfig ?? {})) {
      for (const entry of providerConfig.models ?? []) {
        models.add(`${provider}:${getProviderModelEntryId(entry)}`);
      }
    }
    return [...models].sort((left, right) => left.localeCompare(right));
  }, [providersConfig]);

  const updateSpec = (update: (current: WorkflowSpec) => WorkflowSpec) => {
    setSpec((current) => update(current));
    setMessage(null);
  };

  const removeEdge = (id: string) => {
    updateSpec((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== id),
    }));
    setSelectedEdgeId(null);
  };

  const connectNodes = (source: string, target: string) => {
    const sourceNode = spec.nodes.find((node) => node.id === source);
    const targetNode = spec.nodes.find((node) => node.id === target);
    if (
      !sourceNode ||
      !targetNode ||
      source === target ||
      sourceNode.type === "output" ||
      targetNode.type === "input"
    ) {
      setError(
        "Connections must flow from input, agent, or action nodes into agent, action, or output nodes."
      );
      setConnectSource(null);
      return;
    }
    if (spec.edges.some((edge) => edge.source === source && edge.target === target)) {
      setConnectSource(null);
      return;
    }
    const outgoing = new Map<string, string[]>();
    for (const edge of spec.edges) {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    }
    const pending = [target];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visited.has(current)) continue;
      if (current === source) {
        setError("That arrow would create a workflow cycle.");
        setConnectSource(null);
        return;
      }
      visited.add(current);
      pending.push(...(outgoing.get(current) ?? []));
    }
    updateSpec((current) => ({
      ...current,
      edges: [...current.edges, { id: newId("edge"), source, target }],
    }));
    setConnectSource(null);
    setSelectedId(target);
    setSelectedEdgeId(null);
    setError(null);
  };

  const addNode = (kind: BuilderNodeKind, position: Position) => {
    updateSpec((current) => {
      const id = newId(isAgentId(kind) ? "agent" : "action");
      const definition = isAgentId(kind)
        ? null
        : ACTION_DEFINITIONS.find((item) => item.kind === kind);
      if (!isAgentId(kind) && !definition) return current;
      const node: WorkflowNode = isAgentId(kind)
        ? {
            id,
            type: "agent",
            title: `${kind[0].toUpperCase()}${kind.slice(1)} agent`,
            prompt: "Describe what this agent should accomplish.",
            agentId: kind,
            position,
          }
        : {
            id,
            type: "action",
            title: definition!.title,
            actionKind: kind,
            config: { ...definition!.defaults },
            position,
          };
      setSelectedId(id);
      setSelectedEdgeId(null);
      return {
        ...current,
        nodes: [...current.nodes, node],
      };
    });
  };

  const removeNode = (id: string) => {
    updateSpec((current) => {
      const node = current.nodes.find((item) => item.id === id);
      if (!node || (node.type !== "agent" && node.type !== "action")) return current;
      return {
        ...current,
        nodes: current.nodes.filter((item) => item.id !== id),
        edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
      };
    });
    setSelectedId(null);
    setConnectSource(null);
  };

  const sourceFilename = () =>
    /^\s*(?:flowchart|graph)\b/iu.test(jsonText)
      ? `${spec.slug || "workflow"}.mmd`
      : `${spec.slug || "workflow"}.json`;

  const save = async (): Promise<WorkflowSpec | null> => {
    if (!api) return null;
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const pendingSpec =
        view === "json"
          ? ((await importWorkflowText(jsonText, sourceFilename())) as WorkflowSpec)
          : spec;
      setSpec(pendingSpec);
      const savedSpec = await api.visualWorkflows.save(persistedPayload(pendingSpec));
      setSpec(savedSpec);
      setMessage("Workflow built and saved as an executable Steward skill.");
      await refresh();
      return savedSpec;
    } catch (cause) {
      setError(getErrorMessage(cause));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const compile = async () => {
    if (!api) return;
    setBusy("compile");
    setError(null);
    try {
      const result = await api.visualWorkflows.compile(persistedPayload(spec));
      setCompiledSource(result.source);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const switchView = (next: "visual" | "json" | "code") => {
    if (next === "json") setJsonText(`${JSON.stringify(persistedPayload(spec), null, 2)}\n`);
    if (next === "code") void compile();
    setView(next);
  };

  const applyJson = async () => {
    try {
      const parsed = (await importWorkflowText(jsonText, sourceFilename())) as WorkflowSpec;
      setSpec(parsed);
      setSelectedId(null);
      setError(null);
      setMessage("Source applied to the visual graph. Build to validate and save it.");
      setView("visual");
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  };

  const exportJson = () => {
    const payload = `${JSON.stringify(persistedPayload(spec), null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${persistedPayload(spec).slug || "steward-workflow"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importWorkflow = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const imported = (await importWorkflowText(text, file.name)) as WorkflowSpec;
      setSpec(imported);
      setJsonText(`${JSON.stringify(persistedPayload(imported), null, 2)}\n`);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setView("visual");
      setMessage(
        `Imported ${imported.nodes.length} nodes and ${imported.edges.length} connections into the canvas.`
      );
    } catch (cause) {
      setError(`Could not import workflow: ${getErrorMessage(cause)}`);
    }
  };

  const generateWithAi = async () => {
    if (!api || !workspaceId || !aiModel || aiRequest.trim().length < 2) return;
    const request = aiRequest.trim();
    const userMessage: AiBuildMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: request,
    };
    setAiMessages((current) => [...current, userMessage]);
    setBusy("ai");
    setError(null);
    setMessage(null);
    try {
      const result = await api.visualWorkflows.generate({
        workspaceId,
        model: aiModel,
        request,
        current: persistedPayload(spec),
      });
      setSpec(result.spec);
      setJsonText(`${JSON.stringify(result.spec, null, 2)}\n`);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setView("visual");
      setAiRequest("");
      setAiMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `Graph updated with ${result.spec.nodes.length} nodes and ${result.spec.edges.length} connections using ${result.modelUsed}.`,
        },
      ]);
      setMessage(`AI updated the graph with ${result.modelUsed}. Review it, then build and save.`);
    } catch (cause) {
      const failure = getErrorMessage(cause);
      setError(failure);
      setAiMessages((current) => [
        ...current,
        { id: `assistant-error-${Date.now()}`, role: "assistant", content: failure },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const copyCompiledSource = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(compiledSource);
      setMessage("Runtime code copied to the clipboard.");
    } catch (cause) {
      setError(`Could not copy runtime code: ${getErrorMessage(cause)}`);
    }
  };

  const run = async () => {
    if (!api || !workspaceId) return;
    const savedSpec = await save();
    if (!savedSpec) return;
    setBusy("run");
    setError(null);
    try {
      const result = await api.visualWorkflows.run({
        slug: savedSpec.slug,
        workspaceId,
        input: runInput,
      });
      setMessage(
        `Workflow started: ${result.runId} (${result.status}). Open the workspace Workflows panel to inspect every step.`
      );
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h3 className="text-foreground flex items-center gap-2 text-sm font-medium">
            <Workflow className="text-accent h-4 w-4" /> Workflow Studio
          </h3>
          <p className="text-muted mt-1 max-w-3xl text-xs">
            Build agent graphs visually or edit their declarative JSON or Mermaid source. Steward
            validates every view and compiles it into the same durable workflow runtime with
            parallel branches and inspectable runs.
          </p>
        </div>
        <Select
          value={spec.slug || "new"}
          onValueChange={(value) => {
            const next =
              value === "new" ? createDraft() : saved.find((item) => item.slug === value);
            if (!next) return;
            setSpec(next);
            setSelectedId(null);
            setError(null);
            setMessage(null);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Open saved workflow">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">New workflow</SelectItem>
            {saved.map((workflow) => (
              <SelectItem key={workflow.slug} value={workflow.slug}>
                {workflow.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-success/10 text-success rounded-md px-3 py-2 text-sm">{message}</div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-muted text-xs">
          Workflow name
          <input
            value={spec.name}
            maxLength={80}
            onChange={(event) =>
              updateSpec((current) => ({ ...current, name: event.target.value }))
            }
            className="border-border-medium bg-background-secondary text-foreground mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <label className="text-muted text-xs">
          Description
          <input
            value={spec.description}
            maxLength={240}
            onChange={(event) =>
              updateSpec((current) => ({ ...current, description: event.target.value }))
            }
            className="border-border-medium bg-background-secondary text-foreground mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="border-border-medium bg-background-secondary overflow-hidden rounded-xl border">
        <div className="mb-2 flex items-center gap-2">
          <div className="bg-accent/10 text-accent ml-3 mt-3 rounded-md p-1.5">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-foreground mt-3 text-sm font-medium">AI Build chat</div>
            <div className="text-muted text-xs">
              Build or revise the live canvas with any configured chat model.
            </div>
          </div>
        </div>
        <div className="border-border-medium mx-3 max-h-44 space-y-2 overflow-y-auto border-y py-3">
          {aiMessages.length === 0 && (
            <div className="text-muted flex gap-2 px-1 text-sm">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              Tell me what to add, remove, connect, or reorganize. I will update the canvas
              directly.
            </div>
          )}
          {aiMessages.map((item) => (
            <div
              key={item.id}
              className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${
                item.role === "user"
                  ? "bg-accent text-accent-foreground ml-auto"
                  : "bg-background-primary text-foreground mr-auto"
              }`}
            >
              {item.content}
            </div>
          ))}
        </div>
        <div className="bg-background-primary m-3 rounded-lg border border-border-medium p-2">
          <textarea
            value={aiRequest}
            onChange={(event) => setAiRequest(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void generateWithAi();
              }
            }}
            placeholder="Example: Add parallel research and implementation agents, then join them in a test gate before deployment."
            aria-label="AI workflow request"
            className="text-foreground min-h-20 w-full resize-y bg-transparent px-2 py-1 text-sm outline-none"
          />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <ModelSelector
              value={aiModel}
              onChange={setAiModel}
              models={availableModels}
              emptyLabel="Select model"
              inputPlaceholder="Search models…"
              variant="box"
              className="min-w-44"
            />
            <Select
              value={workspaceId}
              onValueChange={(value) => {
                setWorkspaceId(value);
                const workspace = workspaces.find((item) => item.id === value);
                const workspaceModel =
                  workspace?.aiSettingsByAgent?.exec?.model ??
                  workspace?.aiSettings?.model ??
                  workspace?.taskModelString;
                if (workspaceModel) setAiModel(workspaceModel);
              }}
            >
              <SelectTrigger className="min-w-52 flex-1" aria-label="AI Build workspace">
                <SelectValue placeholder="Workspace context" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.title || workspace.name} · {workspace.projectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="icon"
              aria-label="Send AI workflow request"
              title="Send"
              onClick={() => void generateWithAi()}
              disabled={busy !== null || !workspaceId || !aiModel || aiRequest.trim().length < 2}
            >
              {busy === "ai" ? (
                <Repeat2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="border-border-medium bg-background-secondary flex flex-wrap items-center gap-2 rounded-lg border p-2">
        {(["visual", "json", "code"] as const).map((item) => (
          <Button
            key={item}
            variant={view === item ? "default" : "ghost"}
            size="sm"
            onClick={() => switchView(item)}
          >
            {item === "visual" ? (
              <Network className="h-4 w-4" />
            ) : item === "json" ? (
              <Braces className="h-4 w-4" />
            ) : (
              <Code2 className="h-4 w-4" />
            )}
            {item === "visual"
              ? "Visual builder"
              : item === "json"
                ? "Edit source"
                : "Runtime code"}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          {view === "visual" && (
            <Button
              variant={expandedCanvas ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setExpandedCanvas((current) => !current)}
            >
              {expandedCanvas ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
              {expandedCanvas ? "Show panels" : "Focus canvas"}
            </Button>
          )}
          <input
            ref={importRef}
            type="file"
            accept="application/json,text/plain,.json,.mmd,.mermaid"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void importWorkflow(file);
              event.target.value = "";
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button variant="ghost" size="sm" onClick={exportJson}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {view === "visual" && (
        <div
          className={
            expandedCanvas
              ? "grid min-w-0"
              : "grid min-w-0 gap-4 xl:grid-cols-[220px_minmax(520px,1fr)_260px]"
          }
        >
          {!expandedCanvas && (
            <aside className="border-border-medium bg-background-secondary max-h-[680px] space-y-3 overflow-y-auto rounded-lg border p-3">
              <h4 className="text-foreground text-xs font-semibold uppercase tracking-wide">
                Node library
              </h4>
              <p className="text-muted text-xs">
                Drag agents and operational actions onto the canvas. Every action runs through
                Steward policy and audit.
              </p>
              <input
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                placeholder="Filter nodes…"
                aria-label="Filter workflow nodes"
                className="border-border-medium bg-background-primary text-foreground w-full rounded border px-2 py-2 text-xs"
              />
              <div className="text-muted text-[10px] font-semibold uppercase tracking-wide">
                Agents
              </div>
              {(["explore", "plan", "exec"] as const).map((agentId) => (
                <button
                  key={agentId}
                  draggable
                  type="button"
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/steward-node", agentId);
                    event.dataTransfer.setData("text/plain", agentId);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => addNode(agentId, { x: 430, y: 80 + spec.nodes.length * 24 })}
                  className="border-border-light bg-background-primary hover:border-accent flex w-full cursor-grab items-center gap-2 rounded-md border px-3 py-2 text-left"
                >
                  <Bot className="text-accent h-4 w-4" />
                  <span className="text-foreground text-sm capitalize">{agentId}</span>
                  <Plus className="text-muted ml-auto h-3.5 w-3.5" />
                </button>
              ))}
              {(["Network", "System", "Development", "Data", "Orchestration"] as const).map(
                (category) => {
                  const actions = visibleActions.filter((item) => item.category === category);
                  if (actions.length === 0) return null;
                  return (
                    <div key={category} className="space-y-2">
                      <div className="text-muted pt-1 text-[10px] font-semibold uppercase tracking-wide">
                        {category}
                      </div>
                      {actions.map((action) => {
                        const Icon = actionIcon(action.kind);
                        return (
                          <button
                            key={action.kind}
                            draggable
                            type="button"
                            title={action.description}
                            onDragStart={(event) => {
                              event.dataTransfer.setData("application/steward-node", action.kind);
                              event.dataTransfer.setData("text/plain", action.kind);
                              event.dataTransfer.effectAllowed = "copy";
                            }}
                            onClick={() =>
                              addNode(action.kind, { x: 430, y: 80 + spec.nodes.length * 24 })
                            }
                            className="border-border-light bg-background-primary hover:border-accent flex w-full cursor-grab items-center gap-2 rounded-md border px-3 py-2 text-left"
                          >
                            <Icon className="text-accent h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="text-foreground block truncate text-xs font-medium">
                                {action.title}
                              </span>
                              <span className="text-muted block truncate text-[10px]">
                                {action.description}
                              </span>
                            </span>
                            <Plus className="text-muted h-3.5 w-3.5 shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  );
                }
              )}
              <div className="border-border-light border-t pt-3 text-xs">
                <div className="text-muted">Graph</div>
                <div className="text-foreground mt-1">
                  {spec.nodes.filter((node) => node.type === "agent").length} agents ·{" "}
                  {spec.nodes.filter((node) => node.type === "action").length} actions ·{" "}
                  {spec.edges.length} connections
                </div>
              </div>
            </aside>
          )}

          <WorkflowCanvas
            spec={spec}
            selectedId={selectedId}
            selectedEdgeId={selectedEdgeId}
            connectSource={connectSource}
            expanded={expandedCanvas}
            onSelect={(id) => {
              setSelectedId(id);
              setSelectedEdgeId(null);
            }}
            onSelectEdge={(id) => {
              setSelectedEdgeId(id);
              if (id) setSelectedId(null);
            }}
            onMove={(id, position) =>
              updateSpec((current) => ({
                ...current,
                nodes: current.nodes.map((node) => (node.id === id ? { ...node, position } : node)),
              }))
            }
            onAdd={addNode}
            onSetConnectSource={setConnectSource}
            onConnectNodes={connectNodes}
            onRemoveEdge={removeEdge}
          />

          {!expandedCanvas && (
            <aside className="border-border-medium bg-background-secondary space-y-3 rounded-lg border p-3">
              <h4 className="text-foreground text-xs font-semibold uppercase tracking-wide">
                Inspector
              </h4>
              {!selectedNode ? (
                <p className="text-muted rounded-md border border-dashed p-4 text-xs">
                  Select a node to edit it or create connections.
                </p>
              ) : (
                <>
                  <label className="text-muted block text-xs">
                    Title
                    <input
                      value={selectedNode.title}
                      maxLength={80}
                      onChange={(event) =>
                        updateSpec((current) => ({
                          ...current,
                          nodes: current.nodes.map((node) =>
                            node.id === selectedNode.id
                              ? { ...node, title: event.target.value }
                              : node
                          ),
                        }))
                      }
                      className="border-border-medium bg-background-primary text-foreground mt-1 w-full rounded border px-2 py-2 text-sm"
                    />
                  </label>
                  {selectedNode.type === "agent" && (
                    <>
                      <label className="text-muted block text-xs">
                        Agent role
                        <Select
                          value={selectedNode.agentId}
                          onValueChange={(agentId) =>
                            updateSpec((current) => ({
                              ...current,
                              nodes: current.nodes.map((node) =>
                                node.id === selectedNode.id && node.type === "agent"
                                  ? { ...node, agentId: agentId as AgentId }
                                  : node
                              ),
                            }))
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="explore">Explore</SelectItem>
                            <SelectItem value="plan">Plan</SelectItem>
                            <SelectItem value="exec">Execute</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="text-muted block text-xs">
                        Model
                        <Select
                          value={selectedNode.model ?? "__inherit__"}
                          onValueChange={(model) =>
                            updateSpec((current) => ({
                              ...current,
                              nodes: current.nodes.map((node) =>
                                node.id === selectedNode.id && node.type === "agent"
                                  ? {
                                      ...node,
                                      model: model === "__inherit__" ? undefined : model,
                                    }
                                  : node
                              ),
                            }))
                          }
                        >
                          <SelectTrigger className="mt-1" aria-label="Agent model">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__inherit__">Inherit workspace model</SelectItem>
                            {availableModels.map((model) => (
                              <SelectItem key={model} value={model}>
                                {model}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="text-muted block text-xs">
                        Instructions
                        <textarea
                          value={selectedNode.prompt}
                          maxLength={8000}
                          rows={10}
                          onChange={(event) =>
                            updateSpec((current) => ({
                              ...current,
                              nodes: current.nodes.map((node) =>
                                node.id === selectedNode.id && node.type === "agent"
                                  ? { ...node, prompt: event.target.value }
                                  : node
                              ),
                            }))
                          }
                          className="border-border-medium bg-background-primary text-foreground mt-1 w-full resize-y rounded border px-2 py-2 text-sm"
                        />
                      </label>
                    </>
                  )}
                  {selectedNode.type === "action" && selectedActionDefinition && (
                    <>
                      <div className="border-accent/20 bg-accent/5 rounded-md border px-3 py-2">
                        <div className="text-foreground text-xs font-medium">
                          {selectedActionDefinition.title}
                        </div>
                        <div className="text-muted mt-1 text-[11px]">
                          {selectedActionDefinition.description}
                        </div>
                      </div>
                      {(
                        [
                          ["target", selectedActionDefinition.targetLabel, 2],
                          ["operation", selectedActionDefinition.operationLabel, 4],
                          ["payload", selectedActionDefinition.payloadLabel, 6],
                          ["options", selectedActionDefinition.optionsLabel, 4],
                        ] as const
                      ).map(([key, label, rows]) => (
                        <label key={key} className="text-muted block text-xs">
                          {label}
                          <textarea
                            value={selectedNode.config[key]}
                            maxLength={key === "payload" ? 100_000 : 20_000}
                            rows={rows}
                            spellCheck={false}
                            onChange={(event) =>
                              updateSpec((current) => ({
                                ...current,
                                nodes: current.nodes.map((node) =>
                                  node.id === selectedNode.id && node.type === "action"
                                    ? {
                                        ...node,
                                        config: { ...node.config, [key]: event.target.value },
                                      }
                                    : node
                                ),
                              }))
                            }
                            className="border-border-medium bg-background-primary text-foreground mt-1 w-full resize-y rounded border px-2 py-2 font-mono text-xs"
                          />
                        </label>
                      ))}
                    </>
                  )}
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setConnectSource(selectedNode.id)}
                    disabled={selectedNode.type === "output"}
                  >
                    <Link2 className="h-4 w-4" /> Connect from this node
                  </Button>
                  {(selectedNode.type === "agent" || selectedNode.type === "action") && (
                    <Button
                      variant="ghost"
                      className="text-destructive w-full"
                      onClick={() => removeNode(selectedNode.id)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete node
                    </Button>
                  )}
                  <div className="space-y-1 border-t pt-3">
                    <div className="text-muted text-xs">Connections</div>
                    {spec.edges
                      .filter(
                        (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id
                      )
                      .map((edge) => (
                        <div key={edge.id} className="flex items-center gap-2 text-xs">
                          <span className="text-foreground min-w-0 flex-1 truncate">
                            {edge.source} → {edge.target}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove connection ${edge.source} to ${edge.target}`}
                            className="text-muted hover:text-destructive"
                            onClick={() => removeEdge(edge.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </aside>
          )}
        </div>
      )}

      {view === "json" && (
        <div className="space-y-3">
          <textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            spellCheck={false}
            aria-label="Workflow JSON or Mermaid"
            className="border-border-medium bg-background-primary text-foreground min-h-[560px] w-full resize-y rounded-lg border p-4 font-mono text-xs leading-5"
          />
          <div className="flex justify-end">
            <Button onClick={() => void applyJson()}>
              <Check className="h-4 w-4" /> Apply source to graph
            </Button>
          </div>
        </div>
      )}

      {view === "code" && (
        <div className="space-y-3">
          <p className="text-muted text-xs">
            Exact JavaScript generated for Steward's durable workflow runtime. Edit the graph or
            JSON, then regenerate.
          </p>
          <textarea
            value={compiledSource}
            readOnly
            spellCheck={false}
            aria-label="Compiled workflow JavaScript"
            className="border-border-medium bg-background-primary text-foreground min-h-[560px] w-full resize-y rounded-lg border p-4 font-mono text-xs leading-5"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void copyCompiledSource()}>
              <Copy className="h-4 w-4" /> Copy code
            </Button>
            <Button onClick={() => void compile()} disabled={busy !== null}>
              <Code2 className="h-4 w-4" /> Regenerate
            </Button>
          </div>
        </div>
      )}

      <section className="border-border-medium bg-background-secondary space-y-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Play className="text-accent h-4 w-4" />
          <h4 className="text-foreground text-sm font-medium">Build and run</h4>
        </div>
        {workspaces.length === 0 ? (
          <p className="text-muted rounded-md border border-dashed p-4 text-sm">
            Add a project and create a workspace to run this graph. Building and exporting work
            without one.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[280px_1fr_auto]">
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger aria-label="Workflow workspace">
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
            <input
              value={runInput}
              onChange={(event) => setRunInput(event.target.value)}
              placeholder="Workflow input"
              aria-label="Workflow run input"
              className="border-border-medium bg-background-primary text-foreground rounded-md border px-3 py-2 text-sm"
            />
            <Button onClick={() => void run()} disabled={busy !== null || !workspaceId}>
              <Play className="h-4 w-4" /> Build & run
            </Button>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        {spec.slug && (
          <Button
            variant="secondary"
            onClick={() => {
              if (!api || !window.confirm(`Delete ${spec.name}?`)) return;
              setBusy("delete");
              void api.visualWorkflows
                .remove({ slug: spec.slug })
                .then(() => {
                  setSpec(createDraft());
                  return refresh();
                })
                .catch((cause: unknown) => setError(getErrorMessage(cause)))
                .finally(() => setBusy(null));
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        )}
        <Button onClick={() => void save()} disabled={busy !== null}>
          <Save className="h-4 w-4" /> {busy === "save" ? "Building…" : "Build & save"}
        </Button>
      </div>
    </div>
  );
}
