import { describe, expect, test } from "bun:test";
import { parseMuxDeepLink, resolveProjectPathFromProjectQuery } from "./deepLink";

describe("parseMuxDeepLink", () => {
  test("parses steward://chat/new", () => {
    const payload = parseMuxDeepLink(
      "steward://chat/new/?project=steward&projectPath=%2Ftmp%2Frepo&projectId=proj_123&prompt=hello%20world"
    );

    expect(payload).toEqual({
      type: "new_chat",
      project: "steward",
      projectPath: "/tmp/repo",
      projectId: "proj_123",
      prompt: "hello world",
    });
  });

  test("accepts legacy mux:// links", () => {
    expect(parseMuxDeepLink("mux://chat/new?prompt=hello")).toEqual({
      type: "new_chat",
      prompt: "hello",
    });
  });

  test("returns null for invalid scheme", () => {
    expect(parseMuxDeepLink("http://chat/new?prompt=hi")).toBeNull();
  });

  test("returns null for unknown route", () => {
    expect(parseMuxDeepLink("mux://chat/old?prompt=hi")).toBeNull();
  });

  test("resolves deep-link project query by final path segment", () => {
    const resolved = resolveProjectPathFromProjectQuery(
      ["/Users/mike/repos/mux", "/Users/mike/repos/cmux"],
      "mux"
    );

    expect(resolved).toBe("/Users/mike/repos/mux");
  });

  test("falls back to substring match when no exact match exists", () => {
    const resolved = resolveProjectPathFromProjectQuery(
      ["/Users/mike/repos/coder", "/Users/mike/repos/cmux"],
      "mux"
    );

    expect(resolved).toBe("/Users/mike/repos/cmux");
  });

  test("returns null when no project matches", () => {
    expect(resolveProjectPathFromProjectQuery(["/Users/mike/repos/coder"], "mux")).toBeNull();
  });
});
