import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildVisualWorkflowSource,
  deleteVisualWorkflow,
  listVisualWorkflows,
  saveVisualWorkflow,
  type VisualWorkflowSpec,
} from "./visualWorkflowService";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "steward-workflow-"));
  roots.push(root);
  return root;
}

function graph(): Omit<VisualWorkflowSpec, "updatedAt"> {
  return {
    version: 2,
    slug: "review-graph",
    name: "Review graph",
    description: "Research in parallel, then implement.",
    nodes: [
      { id: "input", type: "input", title: "Input", position: { x: 0, y: 100 } },
      {
        id: "research",
        type: "agent",
        title: "Research",
        prompt: "Research the request.",
        agentId: "explore",
        model: "nvidia:meta/llama-3.1-8b-instruct",
        position: { x: 260, y: 0 },
      },
      {
        id: "plan",
        type: "agent",
        title: "Plan",
        prompt: "Plan the request.",
        agentId: "plan",
        position: { x: 260, y: 220 },
      },
      {
        id: "implement",
        type: "agent",
        title: "Implement",
        prompt: "Implement from both reports.",
        agentId: "exec",
        position: { x: 540, y: 100 },
      },
      {
        id: "compile",
        type: "action",
        title: "Compile",
        actionKind: "build",
        config: {
          target: ".",
          operation: "npm run build",
          payload: "",
          options: '{"timeoutSeconds": 600}',
        },
        position: { x: 820, y: 100 },
      },
      { id: "output", type: "output", title: "Output", position: { x: 1100, y: 100 } },
    ],
    edges: [
      { id: "input-research", source: "input", target: "research" },
      { id: "input-plan", source: "input", target: "plan" },
      { id: "research-implement", source: "research", target: "implement" },
      { id: "plan-implement", source: "plan", target: "implement" },
      { id: "implement-compile", source: "implement", target: "compile" },
      { id: "compile-output", source: "compile", target: "output" },
    ],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("visual workflow service", () => {
  test("writes a discoverable skill and compiles parallel graph stages", async () => {
    const root = await tempRoot();
    const saved = await saveVisualWorkflow(root, graph());

    expect((await listVisualWorkflows(root))[0]).toEqual(saved);
    const skill = await fs.readFile(path.join(root, "skills", "review-graph", "SKILL.md"), "utf-8");
    const source = await fs.readFile(
      path.join(root, "skills", "review-graph", "workflow.js"),
      "utf-8"
    );
    expect(skill).toContain("name: review-graph");
    expect(source).toContain("parallel([");
    expect(source).toContain('agentId: "plan"');
    expect(source).toContain('model: "nvidia:meta/llama-3.1-8b-instruct"');
    expect(source).toContain('results["implement"]');
    expect(source).toContain("command({");
    expect(source).toContain("npm run build");
    expect(source).toContain('shell: "default"');
    expect(source).toContain('options: "{\\\"timeoutSeconds\\\": 600}"');
    expect(source).toContain("Compile failed: ");
    const executableSource = source
      .replace(/^export const meta =/mu, "const meta =")
      .replace(/^export default function workflow/mu, "function workflow");
    expect(() => new Function(executableSource)).not.toThrow();

    await deleteVisualWorkflow(root, "review-graph");
    expect(await listVisualWorkflows(root)).toEqual([]);
  });

  test("rejects cyclic and disconnected graphs", () => {
    const cyclic = graph();
    cyclic.edges.push({ id: "implement-research", source: "implement", target: "research" });
    expect(() => buildVisualWorkflowSource({ ...cyclic, updatedAt: 0 })).toThrow("cycle");

    const disconnected = graph();
    disconnected.edges = disconnected.edges.filter((edge) => edge.target !== "plan");
    expect(() => buildVisualWorkflowSource({ ...disconnected, updatedAt: 0 })).toThrow(
      "reachable from the input"
    );
  });

  test("refuses to overwrite a symbolic-link workflow directory", async () => {
    if (process.platform === "win32") return;
    const root = await tempRoot();
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.symlink(root, path.join(root, "skills", "unsafe"));
    await expect(saveVisualWorkflow(root, { ...graph(), slug: "unsafe" })).rejects.toThrow(
      "regular directory"
    );
  });
});
