import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { textSync, textStream } from "./functions.js";
import { _setImportForTests } from "./clients/llamaCppLoader.js";
import { registerProvider, unregisterProvider } from "./client.js";
import { TestProvider } from "./testing/index.js";
import { userMessage } from "./classes/message/index.js";
import type { StreamChunk } from "./types.js";

const fakeResolveModel = async (uriOrPath: string, _cacheDir: string) =>
  uriOrPath;

function llamaConfig() {
  return {
    model: "/models/llama-3.gguf",
    provider: "llama-cpp",
    metadata: { testResponse: "local hello" },
    messages: [userMessage("hi")],
  };
}

function moduleNotFound(): Error {
  const err = new Error(
    "Cannot find package 'smoltalk-llama-cpp' imported from /app/node_modules/smoltalk/dist/clients/llamaCppLoader.js",
  );
  (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
  return err;
}

beforeEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

afterEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
});

describe("auto-load on provider: llama-cpp", () => {
  it("textSync loads the plugin once, then serves the call", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const result = await textSync(llamaConfig());

    expect(importCount).toBe(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.output).toBe("local hello");
    }
  });

  it("concurrent first calls share one load", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const [a, b] = await Promise.all([
      textSync(llamaConfig()),
      textSync(llamaConfig()),
    ]);

    expect(importCount).toBe(1);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });

  it("textStream loads the plugin and streams", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const chunks: StreamChunk[] = [];
    for await (const c of textStream(llamaConfig())) {
      chunks.push(c);
    }

    expect(importCount).toBe(1);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });

  it("a pre-existing llama-cpp registration suppresses the import entirely", async () => {
    registerProvider("llama-cpp", TestProvider);
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const result = await textSync(llamaConfig());

    expect(importCount).toBe(0);
    expect(result.success).toBe(true);
  });

  it("missing package: textSync rejects with the install hint", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound();
    });

    await expect(textSync(llamaConfig())).rejects.toThrow(
      /Install it \(npm i smoltalk-llama-cpp\)/,
    );
  });

  it("missing package: textStream throws from the first next(), not an error chunk", async () => {
    _setImportForTests(async () => {
      throw moduleNotFound();
    });

    const gen = textStream(llamaConfig());

    await expect(gen.next()).rejects.toThrow(
      /Install it \(npm i smoltalk-llama-cpp\)/,
    );
  });

  it("recovers after unregisterProvider: next call re-registers from cache", async () => {
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const first = await textSync(llamaConfig());
    expect(first.success).toBe(true);
    unregisterProvider("llama-cpp");

    const second = await textSync(llamaConfig());

    expect(importCount).toBe(1);
    expect(second.success).toBe(true);
  });

  it("other providers never touch the loader", async () => {
    registerProvider("other-provider", TestProvider);
    let importCount = 0;
    _setImportForTests(async () => {
      importCount += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });

    const result = await textSync({
      model: "any-model",
      provider: "other-provider",
      metadata: { testResponse: "hi" },
      messages: [userMessage("x")],
    });

    expect(importCount).toBe(0);
    expect(result.success).toBe(true);
    unregisterProvider("other-provider");
  });
});
