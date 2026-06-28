import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { refreshModels } from "./modelData.js";

const validBlob = JSON.stringify({
  schemaVersion: 1,
  generatedAt: "2026-06-28T00:00:00Z",
  models: [{ type: "text", modelName: "m1", provider: "openai", inputTokenCost: 1, outputTokenCost: 2, maxInputTokens: 1, maxOutputTokens: 1 }],
  hostedTools: [],
});

describe("refreshModels", () => {
  it("fetches and validates with an injected fetcher", async () => {
    const result = await refreshModels({ url: "https://example.com/x.json", fetcher: async () => validBlob });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.models).toHaveLength(1);
  });

  it("returns a failure when the fetcher throws", async () => {
    const result = await refreshModels({ fetcher: async () => { throw new Error("network down"); } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("network down");
  });

  it("returns a failure on malformed payload", async () => {
    const result = await refreshModels({ fetcher: async () => "garbage{" });
    expect(result.success).toBe(false);
  });

  it("passes the resolved url to the fetcher", async () => {
    let seen = "";
    await refreshModels({ url: "https://custom.example/y.json", fetcher: async (u) => { seen = u; return validBlob; } });
    expect(seen).toBe("https://custom.example/y.json");
  });
});

// Integration test: exercise the REAL default fetcher (no injected fetcher)
// against a file:// URL. This proves the actual fetch path end-to-end.
describe("refreshModels (file:// integration, real fetcher)", () => {
  it("reads and parses a local catalog via a file URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smoltalk-modeldata-"));
    const path = join(dir, "model-data.json");
    await writeFile(path, validBlob, "utf8");

    const result = await refreshModels({ url: pathToFileURL(path).href });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.models[0].modelName).toBe("m1");
    }
  });

  it("returns a failure for an unsupported URL scheme", async () => {
    const result = await refreshModels({ url: "ftp://example.com/x.json" });
    expect(result.success).toBe(false);
  });
});
