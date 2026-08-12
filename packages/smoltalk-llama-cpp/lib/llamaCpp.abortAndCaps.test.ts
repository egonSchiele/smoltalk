import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Behavior contracts around cancellation and generation bounds:
 *
 * 1. An aborted generation must resolve as `failure("Request was aborted")`
 *    (smoltalk's audio convention), never as a success. node-llama-cpp's
 *    `stopOnAbortSignal` resolves the PARTIAL response on abort instead of
 *    rejecting; without the conversion a timed-out call surfaces as
 *    `success(output: null)` — callers record a null assistant turn and
 *    their timeout/retry machinery never engages.
 * 2. `maxTokens` gets a default cap when the caller sets none, so a thinking
 *    model can never generate unbounded (169k tokens over 100 minutes in the
 *    incident that motivated this).
 * 3. The context is created with a bounded size: node-llama-cpp's "auto"
 *    allocates the KV cache up front for the model's full advertised context
 *    (9.2 GB for Qwen3.5's 262k tokens).
 *
 * node-llama-cpp can't load a real GGUF in CI, so it is mocked; the mock
 * records the options our code passes to the native layer.
 */

const h = vi.hoisted(() => {
  const record = {
    createContextArgs: [] as any[],
    generateOptions: [] as any[],
  };
  const reset = () => {
    record.createContextArgs = [];
    record.generateOptions = [];
  };
  return { record, reset };
});

vi.mock("node-llama-cpp", () => {
  class LlamaChat {
    constructor(_opts: any) {}
    async generateResponse(history: any[], options: any) {
      h.record.generateOptions.push(options);
      // Mirror stopOnAbortSignal: an aborted signal resolves the partial
      // response (empty when aborted before any tokens) — no throw.
      if (options?.signal?.aborted && options?.stopOnAbortSignal) {
        return { response: "", functionCalls: undefined };
      }
      if (options?.onTextChunk) options.onTextChunk("hi");
      await new Promise((r) => setTimeout(r, 5));
      if (options?.signal?.aborted && options?.stopOnAbortSignal) {
        // Aborted mid-generation: a truncated partial WITH content.
        return { response: "partial", functionCalls: undefined };
      }
      const lastUser = [...history].reverse().find((m) => m.type === "user");
      return {
        response: `${lastUser?.text ?? ""}-resp`,
        functionCalls: undefined,
      };
    }
    dispose() {}
  }

  const makeSequence = () => ({
    tokenMeter: {
      getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }),
    },
    async clearHistory() {},
  });

  const makeContext = () => {
    let seq: any = null;
    return {
      totalSequences: 1,
      getSequence() {
        if (!seq) seq = makeSequence();
        return seq;
      },
      async dispose() {},
    };
  };

  const makeModel = () => ({
    async createContext(opts: any) {
      h.record.createContextArgs.push(opts);
      return makeContext();
    },
    async dispose() {},
  });

  const makeLlama = () => ({
    async loadModel(_opts: any) {
      return makeModel();
    },
    async createGrammarForJsonSchema(_schema: any) {
      return {};
    },
  });

  return {
    getLlama: async () => makeLlama(),
    LlamaChat,
    LlamaLogLevel: { error: "error" },
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { disposeAll } from "./nativeRegistry.js";

function makeClient(modelFile: string, dir = "/models") {
  return new LlamaCPP({
    model: modelFile,
    messages: [],
    metadata: { llamaCppModelDir: dir },
  });
}

function userMessages(...texts: string[]): any[] {
  return texts.map((t) => ({ role: "user", content: t }));
}

async function drainStream(gen: AsyncGenerator<any>) {
  const chunks: any[] = [];
  for await (const c of gen) chunks.push(c);
  return chunks;
}

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("aborted generations resolve as failure", () => {
  it("sync: an already-aborted signal yields failure('Request was aborted'), not success", async () => {
    const client = makeClient("m.gguf");
    const controller = new AbortController();
    controller.abort();

    const result = await client._textSync({
      messages: userMessages("hello"),
      abortSignal: controller.signal,
    } as any);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Request was aborted");
  });

  it("sync: an abort landing mid-generation yields failure even with partial content", async () => {
    const client = makeClient("m.gguf");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1);

    const result = await client._textSync({
      messages: userMessages("hello"),
      abortSignal: controller.signal,
    } as any);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Request was aborted");
  });

  it("sync: a normal generation still succeeds", async () => {
    const client = makeClient("m.gguf");
    const result = await client._textSync({
      messages: userMessages("a"),
    } as any);
    expect(result.success && result.value.output).toBe("a-resp");
  });

  it("stream: an aborted generation ends with an error chunk, never a done chunk", async () => {
    const client = makeClient("m.gguf");
    const controller = new AbortController();
    controller.abort();

    const chunks = await drainStream(
      client._textStream({
        messages: userMessages("hello"),
        abortSignal: controller.signal,
      } as any),
    );

    const types = chunks.map((c) => c.type);
    expect(types).not.toContain("done");
    const errChunk = chunks.find((c) => c.type === "error");
    expect(errChunk?.error).toBe("Request was aborted");
  });

  it("stream: a normal generation still ends with a done chunk", async () => {
    const client = makeClient("m.gguf");
    const chunks = await drainStream(
      client._textStream({ messages: userMessages("hello") } as any),
    );
    const done = chunks.find((c) => c.type === "done");
    expect(done?.result.output).toBe("hello-resp");
  });
});

describe("maxTokens default cap", () => {
  it("sync: applies the default cap when the caller sets none", async () => {
    const client = makeClient("m.gguf");
    await client._textSync({ messages: userMessages("a") } as any);
    expect(h.record.generateOptions[0].maxTokens).toBe(16384);
  });

  it("sync: an explicit maxTokens wins over the default", async () => {
    const client = makeClient("m.gguf");
    await client._textSync({
      messages: userMessages("a"),
      maxTokens: 123,
    } as any);
    expect(h.record.generateOptions[0].maxTokens).toBe(123);
  });

  it("sync: a rawAttributes maxTokens overrides the default (escape hatch)", async () => {
    const client = makeClient("m.gguf");
    await client._textSync({
      messages: userMessages("a"),
      rawAttributes: { maxTokens: 0 },
    } as any);
    expect(h.record.generateOptions[0].maxTokens).toBe(0);
  });

  it("stream: applies the default cap when the caller sets none", async () => {
    const client = makeClient("m.gguf");
    await drainStream(
      client._textStream({ messages: userMessages("a") } as any),
    );
    expect(h.record.generateOptions[0].maxTokens).toBe(16384);
  });
});

describe("bounded context size", () => {
  it("creates the context with a 32k cap instead of unbounded auto-sizing", async () => {
    const client = makeClient("m.gguf");
    await client._textSync({ messages: userMessages("a") } as any);
    expect(h.record.createContextArgs).toEqual([
      { contextSize: { max: 32768 } },
    ]);
  });
});
