import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * These tests exercise the native-state reuse contract described in
 * smoltalk-llama-cpp-native-reuse-spec.md: a module-level registry keyed by
 * resolved model path holds a long-lived context + sequence, generation is
 * serialized per model, and the native context is NEVER disposed on the
 * generation path (that per-call dispose is the SIGSEGV in bug.md).
 *
 * node-llama-cpp is a native binding that can't load a real GGUF in CI, so we
 * mock it and spy on the native calls we care about (loadModel / createContext
 * / dispose / clearHistory). We are asserting OUR registry's resource
 * management against the native layer, not the mock's own behaviour.
 */

const h = vi.hoisted(() => {
  const counters = {
    getLlama: 0,
    loadModel: 0,
    createContext: 0,
    contextDispose: 0,
    modelDispose: 0,
    clearHistory: 0,
    generate: 0,
    activeGenerate: 0,
    maxConcurrentGenerate: 0,
    signalReceived: 0,
  };
  // Fault injection to exercise the failure paths the crash-safety of this
  // package depends on.
  const flags = {
    failClearHistory: false, // sequence.clearHistory() rejects (drain failure)
    failChatDispose: false, // chat.dispose() throws during cleanup
    failLoadModelOnce: false, // first loadModel() rejects, then recovers
  };
  const reset = () => {
    for (const k of Object.keys(counters)) (counters as any)[k] = 0;
    flags.failClearHistory = false;
    flags.failChatDispose = false;
    flags.failLoadModelOnce = false;
  };
  return { counters, flags, reset };
});

vi.mock("node-llama-cpp", () => {
  const { counters } = h;

  class LlamaChat {
    private seq: any;
    constructor(opts: any) {
      this.seq = opts.contextSequence;
    }
    async generateResponse(history: any[], options: any) {
      counters.generate++;
      counters.activeGenerate++;
      counters.maxConcurrentGenerate = Math.max(
        counters.maxConcurrentGenerate,
        counters.activeGenerate,
      );
      if (options?.signal) counters.signalReceived++;
      // Mirror node-llama-cpp's stopOnAbortSignal: resolve normally (no throw)
      // when the signal is already aborted, rather than running to completion.
      if (options?.signal?.aborted && options?.stopOnAbortSignal) {
        counters.activeGenerate--;
        return { response: "", functionCalls: undefined };
      }
      if (options?.onTextChunk) options.onTextChunk("hi");
      // yield the event loop so overlapping calls would actually overlap
      await new Promise((r) => setTimeout(r, 10));
      counters.activeGenerate--;
      const lastUser = [...history].reverse().find((m) => m.type === "user");
      return {
        response: `${lastUser?.text ?? ""}-resp`,
        functionCalls: undefined,
      };
    }
    dispose() {
      if (h.flags.failChatDispose) {
        throw new Error("simulated chat.dispose failure");
      }
    }
  }

  const makeSequence = () => ({
    tokenMeter: {
      getState: () => ({ usedInputTokens: 1, usedOutputTokens: 1 }),
    },
    async clearHistory() {
      counters.clearHistory++;
      if (h.flags.failClearHistory) {
        throw new Error("simulated clearHistory failure");
      }
    },
  });

  const makeContext = () => {
    let seq: any = null;
    return {
      totalSequences: 1,
      getSequence() {
        if (!seq) seq = makeSequence();
        return seq;
      },
      async dispose() {
        counters.contextDispose++;
      },
    };
  };

  const makeModel = () => ({
    async createContext() {
      counters.createContext++;
      return makeContext();
    },
    async dispose() {
      counters.modelDispose++;
    },
  });

  const makeLlama = () => ({
    async loadModel(_opts: any) {
      counters.loadModel++;
      if (h.flags.failLoadModelOnce) {
        h.flags.failLoadModelOnce = false;
        throw new Error("simulated loadModel failure");
      }
      return makeModel();
    },
    async createGrammarForJsonSchema(_schema: any) {
      return {};
    },
  });

  return {
    getLlama: async () => {
      counters.getLlama++;
      return makeLlama();
    },
    LlamaChat,
    LlamaLogLevel: { error: "error" },
  };
});

import { LlamaCPP } from "./llamaCpp.js";
import { disposeAll } from "./nativeRegistry.js";

const { counters, flags, reset } = h;

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

beforeEach(() => reset());
afterEach(async () => {
  await disposeAll();
});

describe("native-state reuse", () => {
  it("reuses one model + context across sequential sync calls", async () => {
    const client = makeClient("m.gguf");

    const a = await client._textSync({ messages: userMessages("a") } as any);
    const b = await client._textSync({ messages: userMessages("b") } as any);

    expect(a.success && a.value.output).toBe("a-resp");
    expect(b.success && b.value.output).toBe("b-resp");

    expect(counters.loadModel).toBe(1);
    expect(counters.createContext).toBe(1);
    // The crash: context must NOT be freed on the generation path.
    expect(counters.contextDispose).toBe(0);
    expect(counters.modelDispose).toBe(0);
    // Drained (checkpoint work + KV reset) after each generation.
    expect(counters.generate).toBe(2);
    expect(counters.clearHistory).toBe(2);
  });

  it("streaming reuses the context and never disposes it per call", async () => {
    const client = makeClient("m.gguf");

    const chunks = await drainStream(
      client._textStream({ messages: userMessages("hello") } as any),
    );

    const text = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    const done = chunks.find((c) => c.type === "done");

    expect(text).toBe("hi");
    expect(done?.result.output).toBe("hello-resp");
    expect(counters.loadModel).toBe(1);
    expect(counters.contextDispose).toBe(0);
    expect(counters.clearHistory).toBe(1);
  });

  it("does not release the lock until generation settles on early break", async () => {
    const client = makeClient("m.gguf");

    // Consume only the first chunk, then abandon the stream while
    // generateResponse is still running on the shared sequence.
    const gen = client._textStream({ messages: userMessages("s") } as any);
    await gen.next();
    await gen.return(undefined);

    // A follow-up call must not have overlapped the abandoned generation.
    const next = await client._textSync({ messages: userMessages("t") } as any);

    expect(next.success && next.value.output).toBe("t-resp");
    expect(counters.maxConcurrentGenerate).toBe(1);
    expect(counters.contextDispose).toBe(0);
    expect(counters.clearHistory).toBe(2);
  });

  it("does not wedge the lock if stream cleanup (chat.dispose) throws", async () => {
    const client = makeClient("m.gguf");
    flags.failChatDispose = true;

    const chunks = await drainStream(
      client._textStream({ messages: userMessages("s") } as any),
    );
    flags.failChatDispose = false;

    // Stream still completed — cleanup throwing must not hang the generator.
    expect(chunks.find((c) => c.type === "done")?.result.output).toBe("s-resp");

    // The per-model lock was released, so a follow-up call is not wedged.
    const next = await client._textSync({ messages: userMessages("t") } as any);
    expect(next.success && next.value.output).toBe("t-resp");
  });

  it("serializes concurrent calls on one model and loads it once", async () => {
    const client = makeClient("m.gguf");

    const results = await Promise.all([
      client._textSync({ messages: userMessages("1") } as any),
      client._textSync({ messages: userMessages("2") } as any),
      client._textSync({ messages: userMessages("3") } as any),
      client._textSync({ messages: userMessages("4") } as any),
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    // Never more than one generateResponse in flight on the shared sequence.
    expect(counters.maxConcurrentGenerate).toBe(1);
    // Concurrent first calls must not double-load the model.
    expect(counters.loadModel).toBe(1);
    expect(counters.createContext).toBe(1);
    expect(counters.contextDispose).toBe(0);
  });

  it("keeps separate registry entries for different models", async () => {
    const clientA = makeClient("a.gguf");
    const clientB = makeClient("b.gguf");

    await clientA._textSync({ messages: userMessages("x") } as any);
    await clientB._textSync({ messages: userMessages("y") } as any);

    expect(counters.loadModel).toBe(2);
    expect(counters.createContext).toBe(2);
    expect(counters.contextDispose).toBe(0);
  });

  it("evicts a failed model load so the next call can retry", async () => {
    const client = makeClient("m.gguf");
    flags.failLoadModelOnce = true;

    await expect(
      client._textSync({ messages: userMessages("a") } as any),
    ).rejects.toThrow(/simulated loadModel/);

    // The cached rejection was evicted from the registry; a retry reloads.
    const ok = await client._textSync({ messages: userMessages("b") } as any);
    expect(ok.success && ok.value.output).toBe("b-resp");
    expect(counters.loadModel).toBe(2);
  });

  it("clears history between turns so calls are not contaminated", async () => {
    const client = makeClient("m.gguf");

    const first = await client._textSync({
      messages: userMessages("first"),
    } as any);
    const second = await client._textSync({
      messages: userMessages("second"),
    } as any);

    expect(first.success && first.value.output).toBe("first-resp");
    expect(second.success && second.value.output).toBe("second-resp");
    expect(counters.clearHistory).toBe(2);
  });

  it("releases the lock after an aborted call so follow-ups succeed", async () => {
    const client = makeClient("m.gguf");
    const controller = new AbortController();
    controller.abort();

    const aborted = await client._textSync({
      messages: userMessages("stop"),
      abortSignal: controller.signal,
    } as any);
    const next = await client._textSync({
      messages: userMessages("again"),
    } as any);

    // The signal actually reached generateResponse (only the first call).
    expect(counters.signalReceived).toBe(1);
    // Aborted generations resolve as failure, never success (the abort/caps
    // contract — see llamaCpp.abortAndCaps.test.ts). What matters HERE is
    // that the lock was released and the follow-up call still works.
    expect(aborted.success).toBe(false);
    if (!aborted.success) expect(aborted.error).toBe("Request was aborted");
    expect(next.success && next.value.output).toBe("again-resp");
    expect(counters.clearHistory).toBe(2);
    expect(counters.contextDispose).toBe(0);
  });

  it("a clearHistory (drain) failure does not break the generation result", async () => {
    const client = makeClient("m.gguf");
    flags.failClearHistory = true;

    const result = await client._textSync({
      messages: userMessages("a"),
    } as any);

    // The drain is best-effort: a successful generation must still be returned.
    expect(result.success && result.value.output).toBe("a-resp");
    expect(counters.clearHistory).toBe(1);

    flags.failClearHistory = false;
  });

  it("skips native disposal when the drain fails (leak over crash)", async () => {
    const client = makeClient("m.gguf");
    await client._textSync({ messages: userMessages("a") } as any);

    flags.failClearHistory = true;
    await disposeAll(); // must not throw
    flags.failClearHistory = false;

    // A failed drain can't guarantee the checkpoint worker finished, so freeing
    // the context now would re-open the use-after-free. Leak instead of crash.
    expect(counters.contextDispose).toBe(0);
    expect(counters.modelDispose).toBe(0);
  });

  it("disposeAll frees native state and a later call reloads", async () => {
    const client = makeClient("m.gguf");
    await client._textSync({ messages: userMessages("a") } as any);
    expect(counters.loadModel).toBe(1);

    await disposeAll();
    expect(counters.contextDispose).toBe(1);
    expect(counters.modelDispose).toBe(1);

    reset();
    await client._textSync({ messages: userMessages("b") } as any);
    expect(counters.loadModel).toBe(1);
    expect(counters.createContext).toBe(1);
  });
});
