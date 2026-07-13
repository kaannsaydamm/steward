import { describe, expect, test } from "bun:test";

import { architectureGraphToWorkflow, importWorkflowText } from "./visualWorkflowImport";

describe("visual workflow imports", () => {
  test("converts architecture JSON into an immediately editable graph", async () => {
    const graph = {
      metadata: { source_file: "architecture.mmd" },
      nodes: [
        { id: "User", label: "User", subgraph_id: null },
        { id: "Plan", label: "Plan agent\nCreates a plan", subgraph_id: "agents" },
        { id: "Deploy", label: "Deploy", subgraph_id: "ops" },
      ],
      edges: [
        { source: "User", target: "Plan" },
        { source: "Plan", target: "Deploy" },
      ],
    };

    const spec = architectureGraphToWorkflow(graph);
    expect(spec.nodes).toHaveLength(3);
    expect(spec.nodes.find((node) => node.id === "user")?.type).toBe("input");
    expect(spec.nodes.find((node) => node.id === "plan")).toMatchObject({
      type: "action",
      actionKind: "transform",
    });
    expect(spec.nodes.find((node) => node.id === "deploy")?.type).toBe("output");
    expect(spec.edges).toHaveLength(2);
  });

  test("accepts native Steward v2 JSON without rewriting it", async () => {
    const spec = {
      version: 2 as const,
      slug: "native-workflow",
      name: "Native workflow",
      description: "Native workflow fixture",
      nodes: [],
      edges: [],
    };
    expect(await importWorkflowText(JSON.stringify(spec), "workflow.json")).toEqual(spec);
  });
});
