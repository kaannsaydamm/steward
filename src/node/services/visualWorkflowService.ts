import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

import writeFileAtomic from "write-file-atomic";

import { ensurePrivateDir } from "@/node/utils/fs";

const SPEC_FILENAME = "visual-workflow.json";

export type VisualWorkflowNode =
  | { id: string; type: "input"; title: string; position: { x: number; y: number } }
  | {
      id: string;
      type: "agent";
      title: string;
      prompt: string;
      agentId: "explore" | "plan" | "exec";
      model?: string;
      position: { x: number; y: number };
    }
  | {
      id: string;
      type: "action";
      title: string;
      actionKind: VisualWorkflowActionKind;
      config: VisualWorkflowActionConfig;
      position: { x: number; y: number };
    }
  | { id: string; type: "output"; title: string; position: { x: number; y: number } };

export type VisualWorkflowActionKind =
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

export interface VisualWorkflowActionConfig {
  target: string;
  operation: string;
  payload: string;
  options: string;
}

const DIRECT_COMMAND_ACTIONS = new Set<VisualWorkflowActionKind>([
  "shell",
  "powershell",
  "build",
  "test",
  "git",
  "container",
]);

export interface VisualWorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface VisualWorkflowSpec {
  version: 2;
  slug: string;
  name: string;
  description: string;
  nodes: VisualWorkflowNode[];
  edges: VisualWorkflowEdge[];
  updatedAt: number;
}

interface LegacyVisualWorkflowSpec {
  slug: string;
  name: string;
  description: string;
  steps: Array<{
    id: string;
    title: string;
    prompt: string;
    agentId: "explore" | "plan" | "exec";
  }>;
  updatedAt: number;
}

function workflowDir(rootDir: string, slug: string): string {
  return path.join(rootDir, "skills", slug);
}

async function assertSafeWorkflowDir(directory: string): Promise<void> {
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Visual workflow path must be a regular directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function migrateLegacySpec(spec: LegacyVisualWorkflowSpec): VisualWorkflowSpec {
  const inputId = "workflow-input";
  const outputId = "workflow-output";
  const nodes: VisualWorkflowNode[] = [
    { id: inputId, type: "input", title: "Workflow input", position: { x: 80, y: 200 } },
    ...spec.steps.map(
      (step, index): VisualWorkflowNode => ({
        ...step,
        type: "agent",
        position: { x: 360 + index * 280, y: 200 },
      })
    ),
    {
      id: outputId,
      type: "output",
      title: "Final report",
      position: { x: 360 + spec.steps.length * 280, y: 200 },
    },
  ];
  const chain = [inputId, ...spec.steps.map((step) => step.id), outputId];
  return {
    version: 2,
    slug: spec.slug,
    name: spec.name,
    description: spec.description,
    nodes,
    edges: chain.slice(0, -1).map((source, index) => ({
      id: `edge-${source}-${chain[index + 1]}`,
      source,
      target: chain[index + 1],
    })),
    updatedAt: spec.updatedAt,
  };
}

function isLegacySpec(value: unknown): value is LegacyVisualWorkflowSpec {
  return (
    value != null &&
    typeof value === "object" &&
    Array.isArray((value as Partial<LegacyVisualWorkflowSpec>).steps)
  );
}

export function validateVisualWorkflow(spec: VisualWorkflowSpec): void {
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));
  if (nodeById.size !== spec.nodes.length) throw new Error("Workflow node IDs must be unique");

  const inputs = spec.nodes.filter((node) => node.type === "input");
  const outputs = spec.nodes.filter((node) => node.type === "output");
  const executableNodes = spec.nodes.filter(
    (node) => node.type === "agent" || node.type === "action"
  );
  if (inputs.length !== 1 || outputs.length !== 1) {
    throw new Error("Workflow must contain exactly one input and one output node");
  }
  if (executableNodes.length === 0) {
    throw new Error("Workflow must contain at least one agent or action node");
  }
  for (const node of spec.nodes) {
    if (node.type !== "action") continue;
    const requiredTarget = !["shell", "powershell", "transform"].includes(node.actionKind);
    const requiredOperation = !["file-read", "file-write"].includes(node.actionKind);
    if (requiredTarget && node.config.target.trim().length === 0) {
      throw new Error(`${node.title} requires a target`);
    }
    if (requiredOperation && node.config.operation.trim().length === 0) {
      throw new Error(`${node.title} requires an operation`);
    }
  }

  const incoming = new Map(spec.nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(spec.nodes.map((node) => [node.id, [] as string[]]));
  const edgeKeys = new Set<string>();
  for (const edge of spec.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      throw new Error(`Edge ${edge.id} references a missing node`);
    }
    if (edge.source === edge.target) throw new Error("Workflow nodes cannot connect to themselves");
    if (nodeById.get(edge.source)?.type === "output") {
      throw new Error("Output node cannot have outgoing connections");
    }
    if (nodeById.get(edge.target)?.type === "input") {
      throw new Error("Input node cannot have incoming connections");
    }
    const key = `${edge.source}\u0000${edge.target}`;
    if (edgeKeys.has(key)) throw new Error("Duplicate workflow connections are not allowed");
    edgeKeys.add(key);
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  const indegree = new Map(spec.nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]));
  const queue = spec.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) continue;
    ordered.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (ordered.length !== spec.nodes.length) throw new Error("Workflow graph contains a cycle");

  const reachable = new Set<string>([inputs[0].id]);
  for (const id of ordered) {
    if (!reachable.has(id)) continue;
    for (const target of outgoing.get(id) ?? []) reachable.add(target);
  }
  if (reachable.size !== spec.nodes.length) {
    throw new Error("Every workflow node must be reachable from the input");
  }

  const reachesOutput = new Set<string>([outputs[0].id]);
  for (const id of ordered.toReversed()) {
    if (!reachesOutput.has(id)) continue;
    for (const source of incoming.get(id) ?? []) reachesOutput.add(source);
  }
  if (reachesOutput.size !== spec.nodes.length) {
    throw new Error("Every workflow branch must reach the output");
  }
}

function buildGraphIndex(spec: VisualWorkflowSpec) {
  const incoming = new Map(spec.nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(spec.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of spec.edges) {
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }
  return { incoming, outgoing };
}

export function buildVisualWorkflowSource(spec: VisualWorkflowSpec): string {
  validateVisualWorkflow(spec);
  const { incoming } = buildGraphIndex(spec);
  const input = spec.nodes.find((node) => node.type === "input");
  const output = spec.nodes.find((node) => node.type === "output");
  if (!input || !output) throw new Error("Workflow input/output nodes are missing");

  const remaining = new Set(
    spec.nodes
      .filter((node) => node.type === "agent" || node.type === "action")
      .map((node) => node.id)
  );
  const completed = new Set<string>([input.id]);
  const levels: VisualWorkflowNode[][] = [];
  while (remaining.size > 0) {
    const level = spec.nodes.filter(
      (node) =>
        (node.type === "agent" || node.type === "action") &&
        remaining.has(node.id) &&
        (incoming.get(node.id) ?? []).every((source) => completed.has(source))
    );
    if (level.length === 0) throw new Error("Workflow graph cannot be compiled");
    levels.push(level);
    for (const node of level) {
      remaining.delete(node.id);
      completed.add(node.id);
    }
  }

  const lines = [
    `export const meta = ${JSON.stringify(
      {
        name: spec.name,
        description: spec.description,
        argsSchema: {
          type: "object",
          additionalProperties: false,
          properties: { input: { type: "string" } },
        },
      },
      null,
      2
    )};`,
    "",
    "export default function workflow({ args, phase, agent, command, parallel }) {",
    '  const workflowInput = typeof args.input === "string" ? args.input : "";',
    "  const results = {};",
  ];

  const nodeExpression = (node: Extract<VisualWorkflowNode, { type: "agent" | "action" }>) => {
    const parents = (incoming.get(node.id) ?? []).filter((id) => id !== input.id);
    const contextExpression =
      parents.length === 0
        ? "workflowInput"
        : `JSON.stringify(${JSON.stringify(parents)}.map((id) => ({ stepId: id, output: results[id] })), null, 2)`;
    if (node.type === "action" && DIRECT_COMMAND_ACTIONS.has(node.actionKind)) {
      const cwd = node.actionKind === "container" ? "." : node.config.target.trim() || ".";
      const stdin = node.config.payload.trim()
        ? JSON.stringify(node.config.payload)
        : contextExpression;
      return [
        "command({",
        `      id: ${JSON.stringify(node.id)},`,
        `      title: ${JSON.stringify(node.title)},`,
        `      shell: ${JSON.stringify(node.actionKind === "powershell" ? "powershell" : "default")},`,
        `      command: ${JSON.stringify(node.config.operation)},`,
        `      cwd: ${JSON.stringify(cwd)},`,
        `      stdin: ${stdin},`,
        `      options: ${JSON.stringify(node.config.options)},`,
        "    })",
      ].join("\n");
    }
    const prompt = node.type === "agent" ? node.prompt : buildActionPrompt(node);
    const agentId = node.type === "agent" ? node.agentId : "exec";
    return [
      `agent(${JSON.stringify(prompt)} + "\\n\\nWorkflow input / upstream results:\\n" + ${contextExpression}, {`,
      `      id: ${JSON.stringify(node.id)},`,
      `      title: ${JSON.stringify(node.title)},`,
      `      agentId: ${JSON.stringify(agentId)},`,
      ...(node.type === "agent" && node.model
        ? [`      model: ${JSON.stringify(node.model)},`]
        : []),
      ...(node.type === "action"
        ? [
            '      schema: { type: "object", additionalProperties: false, properties: { success: { type: "boolean" }, output: { type: "string" }, error: { type: "string" } }, required: ["success", "output", "error"] },',
          ]
        : []),
      "    })",
    ].join("\n");
  };

  const actionAssertion = (node: Extract<VisualWorkflowNode, { type: "action" }>) =>
    `  if (!results[${JSON.stringify(node.id)}]?.success) throw new Error(${JSON.stringify(`${node.title} failed: `)} + (results[${JSON.stringify(node.id)}]?.error || "Action did not report success"));`;

  for (const [levelIndex, level] of levels.entries()) {
    lines.push(
      `  phase(${JSON.stringify(`Stage ${levelIndex + 1}`)}, { nodes: ${JSON.stringify(level.map((node) => node.id))} });`
    );
    if (level.length === 1 && (level[0].type === "agent" || level[0].type === "action")) {
      lines.push(`  results[${JSON.stringify(level[0].id)}] = ${nodeExpression(level[0])};`);
      if (level[0].type === "action") lines.push(actionAssertion(level[0]));
      continue;
    }
    lines.push("  {");
    lines.push("    const stageResults = parallel([");
    for (const node of level) {
      if (node.type !== "agent" && node.type !== "action") continue;
      lines.push(`      () => ${nodeExpression(node)},`);
    }
    lines.push("    ]);");
    level.forEach((node, index) => {
      lines.push(`    results[${JSON.stringify(node.id)}] = stageResults[${index}];`);
      if (node.type === "action") lines.push(`  ${actionAssertion(node)}`);
    });
    lines.push("  }");
  }

  const outputParents = (incoming.get(output.id) ?? []).filter((id) => id !== input.id);
  lines.push(`  const finalIds = ${JSON.stringify(outputParents)};`);
  lines.push(
    "  const finalValue = finalIds.length === 1 ? results[finalIds[0]] : finalIds.map((id) => ({ stepId: id, output: results[id] }));"
  );
  lines.push(
    '  return { reportMarkdown: typeof finalValue === "string" ? finalValue : "```json\\n" + JSON.stringify(finalValue, null, 2) + "\\n```", structuredOutput: { results, final: finalValue } };',
    "}",
    ""
  );
  return lines.join("\n");
}

function buildActionPrompt(node: Extract<VisualWorkflowNode, { type: "action" }>): string {
  const config = node.config;
  const operation = config.operation.trim();
  const target = config.target.trim();
  const payload = config.payload.trim();
  const options = config.options.trim();
  const detail = [
    target ? `Target: ${target}` : "",
    operation ? `Operation: ${operation}` : "",
    payload ? `Payload/input: ${payload}` : "",
    options ? `Options: ${options}` : "",
  ].filter(Boolean);
  const instructions: Record<VisualWorkflowActionKind, string> = {
    "http-request":
      "Perform the specified HTTP/API request exactly once. Validate the URL, use configured secret references rather than printing secrets, check the status code, and return the response body plus relevant headers.",
    websocket:
      "Connect to the specified WebSocket endpoint, send the configured message, wait for the expected response, then close the socket cleanly. Return the received frames and connection outcome.",
    shell:
      "Run the specified shell command in the requested working directory. Do not interpolate untrusted upstream text into the command. Return exit code, stdout, and stderr.",
    powershell:
      "Run the specified PowerShell command in the requested working directory. Pass dynamic values as arguments rather than string-built commands. Return exit code, stdout, and stderr.",
    ssh: "Connect to the specified SSH host using existing user credentials, execute the command, close the connection, and return exit code, stdout, and stderr. Never echo credentials.",
    "file-read":
      "Read the specified file using the file tools. Refuse path traversal outside the active workspace unless policy explicitly permits it. Return the content and file metadata.",
    "file-write":
      "Write the configured content to the specified file using file tools. Preserve unrelated content, create parent directories only when needed, and report the final path and size.",
    build:
      "Run the configured build or compile command in the target directory. Capture diagnostics and artifact paths. Treat a non-zero exit as failure.",
    test: "Run the configured test command in the target directory. Return pass/fail counts and the actionable failure output. Treat a non-zero exit as failure.",
    git: "Perform the specified Git operation in the target repository using non-interactive commands. Do not discard unrelated working-tree changes. Return the resulting status and identifiers.",
    "mcp-tool":
      "Invoke the named MCP server tool once with the configured JSON arguments. Validate arguments against the tool schema and return its structured result.",
    subworkflow:
      "Run the specified Steward workflow with the configured JSON arguments, wait for its durable result, and return its report and run identifier.",
    transform:
      "Transform the upstream data exactly as described. Return a deterministic JSON-compatible result and do not perform unrelated external actions.",
    container:
      "Execute the configured operation in the specified container or container runtime. Do not mount additional host paths or elevate privileges unless explicitly configured. Return exit status and output.",
    database:
      "Execute the configured database operation using the named existing connection. Use parameters for dynamic values, do not concatenate SQL, and return rows/affected-count without exposing credentials.",
    notification:
      "Send the configured notification once to the specified channel or endpoint. Do not include secrets or unrelated workflow state. Return the provider message identifier and delivery status.",
  };
  const requiredTool: Record<VisualWorkflowActionKind, string> = {
    "http-request":
      "Use web_fetch only for a plain GET. For methods, headers, authentication, or a body, use the bash tool with curl and keep secrets in configured environment variables.",
    websocket:
      "Use the bash tool with an installed WebSocket client or a short runtime script. Do not invent a WebSocket-specific Steward tool.",
    shell: "Use the bash tool. Its input field is script.",
    powershell:
      "Use the bash tool. On Windows invoke powershell.exe -NoProfile -NonInteractive -Command with the configured operation. Do not invent a PowerShell-specific Steward tool.",
    ssh: "Use the bash tool with the installed non-interactive ssh client and existing credentials.",
    "file-read": "Use the file_read tool.",
    "file-write":
      "Use file_edit_insert for a new file or file_edit_replace_string for a guarded update.",
    build: "Use the bash tool to run the build command.",
    test: "Use the bash tool to run the test command.",
    git: "Use the bash tool to run non-interactive git commands.",
    "mcp-tool": `Call the configured MCP tool named ${JSON.stringify(target)} directly. Do not invent an alias.`,
    subworkflow: "Use the workflow_run tool with the configured workflow path and arguments.",
    transform: "No external tool is required unless the transformation needs workspace data.",
    container: "Use the bash tool with the configured Docker or Podman command.",
    database:
      "Use the configured MCP database tool when available; otherwise use the bash tool with an installed database client and parameterized input.",
    notification:
      "Use notify for an in-app alert. For an external webhook or provider, use the bash tool with curl and configured environment secrets.",
  };
  return [
    `## Steward ${node.actionKind} action`,
    instructions[node.actionKind],
    requiredTool[node.actionKind],
    "",
    ...detail,
    "",
    "Use only the tools named above. Respect Steward tool governance, approvals, sandboxing, and audit policy. Do not merely describe the action: execute it.",
    "Finish by calling agent_report with exactly { success, output, error }. Set success=false and explain the cause in error if the required tool is unavailable or the operation fails. Never claim success from prose alone.",
  ].join("\n");
}

async function readSpec(filePath: string): Promise<VisualWorkflowSpec> {
  const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf-8"));
  const spec = isLegacySpec(parsed) ? migrateLegacySpec(parsed) : (parsed as VisualWorkflowSpec);
  validateVisualWorkflow(spec);
  return spec;
}

export async function listVisualWorkflows(rootDir: string): Promise<VisualWorkflowSpec[]> {
  const skillsRoot = path.join(rootDir, "skills");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const workflows: VisualWorkflowSpec[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const spec = await readSpec(path.join(skillsRoot, entry.name, SPEC_FILENAME));
      if (spec.slug === entry.name) workflows.push(spec);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
  return workflows.toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveVisualWorkflow(
  rootDir: string,
  input: Omit<VisualWorkflowSpec, "updatedAt">
): Promise<VisualWorkflowSpec> {
  const spec = { ...input, updatedAt: Date.now() };
  validateVisualWorkflow(spec);
  const source = buildVisualWorkflowSource(spec);
  const directory = workflowDir(rootDir, spec.slug);
  await assertSafeWorkflowDir(directory);
  await ensurePrivateDir(directory);
  const skillMarkdown = `---\nname: ${spec.slug}\ndescription: ${JSON.stringify(spec.description)}\n---\n\n# ${spec.name}\n\n${spec.description}\n\nThis workflow is maintained by Steward's visual workflow builder.\n`;
  await Promise.all([
    writeFileAtomic(path.join(directory, SPEC_FILENAME), `${JSON.stringify(spec, null, 2)}\n`),
    writeFileAtomic(path.join(directory, "SKILL.md"), skillMarkdown),
    writeFileAtomic(path.join(directory, "workflow.js"), source),
  ]);
  return spec;
}

export async function deleteVisualWorkflow(rootDir: string, slug: string): Promise<void> {
  const directory = workflowDir(rootDir, slug);
  await assertSafeWorkflowDir(directory);
  await fs.access(path.join(directory, SPEC_FILENAME));
  await fs.rm(directory, { recursive: true, force: false });
}
