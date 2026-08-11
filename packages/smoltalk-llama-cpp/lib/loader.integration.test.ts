import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadLlamaCpp,
  hasProvider,
  getClient,
  unregisterProvider,
} from "smoltalk";

// The loader dynamically imports plain JS, so it must target this package's
// built entry — run `pnpm build` here (and in packages/smoltalk) first.
const distEntry = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "index.js",
);

if (!existsSync(distEntry)) {
  throw new Error(
    "loader.integration.test.ts needs built dists: run `pnpm build` in " +
      "packages/smoltalk and packages/smoltalk-llama-cpp before running tests.",
  );
}

describe("loadLlamaCpp({ entryPath }) integration", () => {
  afterEach(() => {
    unregisterProvider("llama-cpp");
  });

  it("registers a working class under llama-cpp from an explicit entry path", async () => {
    const mod = await loadLlamaCpp({ entryPath: distEntry });

    expect(typeof mod.resolveModel).toBe("function");
    expect(hasProvider("llama-cpp")).toBe(true);

    // Path-shaped model, constructed through smoltalk's ordinary factory —
    // no model inference, just proof the registered class is usable.
    const client = getClient({
      model: "/models/fake.gguf",
      provider: "llama-cpp",
      messages: [],
    });
    expect(client.constructor.name).toBe("LlamaCPP");
    expect(typeof client.textSync).toBe("function");
  });
});
