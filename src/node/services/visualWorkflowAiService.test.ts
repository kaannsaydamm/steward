import { describe, expect, test } from "bun:test";

import { extractVisualWorkflowJson } from "./visualWorkflowAiService";

describe("visual workflow AI response parsing", () => {
  test("extracts a graph object from plain JSON or a fenced model response", () => {
    expect(extractVisualWorkflowJson('{"version":2,"name":"Graph"}')).toEqual({
      version: 2,
      name: "Graph",
    });
    expect(
      extractVisualWorkflowJson('```json\n{"description":"brace } inside string","nodes":[]}\n```')
    ).toEqual({ description: "brace } inside string", nodes: [] });
  });

  test("rejects responses without a complete JSON object", () => {
    expect(() => extractVisualWorkflowJson("I could not build the graph.")).toThrow(
      "did not return valid workflow JSON"
    );
  });
});
