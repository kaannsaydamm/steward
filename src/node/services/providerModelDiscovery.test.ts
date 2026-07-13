import { afterEach, describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Config } from "@/node/config";
import { ProviderService } from "./providerService";

const roots: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("custom provider live model discovery", () => {
  it("fetches, deduplicates, sorts, and preserves provider context limits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "steward-provider-test-"));
    roots.push(root);
    const config = new Config(root);
    const service = new ProviderService(config);
    const added = await service.addCustomOpenAICompatibleProvider({
      provider: "nvidia-nim",
      displayName: "NVIDIA NIM",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "test-key",
    });
    expect(added.success).toBe(true);
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://integrate.api.nvidia.com/v1/models");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { id: "z-model", context_length: 131_072 },
              { id: "a-model", context_window: 32_000 },
              { id: "z-model" },
            ],
          }),
          { status: 200 }
        )
      );
    }) as unknown as typeof fetch;

    expect(await service.fetchCustomProviderModels("nvidia-nim")).toEqual([
      { id: "a-model", contextWindowTokens: 32_000 },
      { id: "z-model", contextWindowTokens: 131_072 },
    ]);
    service.dispose();
  });

  it("enriches missing limits with one bounded models.dev metadata request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "steward-provider-test-"));
    roots.push(root);
    const config = new Config(root);
    const service = new ProviderService(config);
    await service.addCustomOpenAICompatibleProvider({
      provider: "nvidia-nim",
      displayName: "NVIDIA NIM",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "test-key",
    });
    const requestedUrls: string[] = [];
    globalThis.fetch = mock((url: string | URL | Request) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith("/models")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "meta/llama-3.1-8b-instruct" }] }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            nvidia: {
              models: {
                "meta/llama-3.1-8b-instruct": { limit: { context: 16_000 } },
              },
            },
          }),
          { status: 200 }
        )
      );
    }) as unknown as typeof fetch;

    expect(await service.fetchCustomProviderModels("nvidia-nim")).toEqual([
      { id: "meta/llama-3.1-8b-instruct", contextWindowTokens: 16_000 },
    ]);
    expect(requestedUrls).toEqual([
      "https://integrate.api.nvidia.com/v1/models",
      "https://models.dev/api.json",
    ]);
    service.dispose();
  });
});
