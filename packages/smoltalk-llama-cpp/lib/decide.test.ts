import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DecisionQuestion } from "smoltalk";

/**
 * The `decide` export: the two translations on plain values, and the
 * provider against a mocked node-llama-cpp (a real GGUF can't load in CI;
 * decide.integration.test.ts loads one when asked).
 */

const h = vi.hoisted(() => {
  const counters = { loadModel: 0, createDecisionContext: 0, decideWithMeta: 0 };
  const calls: { document: string; questions: unknown; options: unknown }[] = [];
  const flags = {
    failLoadModelOnce: false,
    decideError: undefined as Error | undefined,
    decideDelayMs: 0,
  };
  const reset = () => {
    for (const k of Object.keys(counters)) (counters as any)[k] = 0;
    calls.length = 0;
    flags.failLoadModelOnce = false;
    flags.decideError = undefined;
    flags.decideDelayMs = 0;
  };
  return { counters, calls, flags, reset };
});

vi.mock("node-llama-cpp", () => {
  const { counters, calls, flags } = h;
  class FakeDecisionContext {
    async decideWithMeta(document: string, questions: unknown, options: unknown) {
      counters.decideWithMeta += 1;
      calls.push({ document, questions, options });
      if (flags.decideDelayMs > 0) {
        await new Promise((r) => setTimeout(r, flags.decideDelayMs));
      }
      if (flags.decideError !== undefined) {
        throw flags.decideError;
      }
      return {
        answers: {
          team: {
            type: "choice",
            choice: "billing",
            confidence: 0.3,
            probabilities: { billing: 0.6, support: 0.4 },
          },
          urgency: { type: "score", score: 1.5, confidence: 0.9, probabilities: [0.1, 0.3, 0.6] },
          churn: { type: "noul", value: 0.2 },
        },
        tokenUsage: { input: 170, output: 3 },
      };
    }
    async dispose() {}
  }
  class FakeModel {
    async createDecisionContext() {
      counters.createDecisionContext += 1;
      return new FakeDecisionContext();
    }
    async dispose() {}
  }
  return {
    getLlama: async () => ({
      loadModel: async () => {
        counters.loadModel += 1;
        if (flags.failLoadModelOnce) {
          flags.failLoadModelOnce = false;
          throw new Error("file is not a GGUF");
        }
        return new FakeModel();
      },
    }),
    LlamaLogLevel: { error: "error" },
    LlamaVocabularyType: {},
  };
});

import { decide, toLlamaQuestions, fromLlamaAnswers } from "./decide.js";
import { disposeAll } from "./nativeRegistry.js";

const questions: Record<string, DecisionQuestion> = {
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { billing: "payments, refunds", support: "help, bugs" },
  },
  urgency: {
    type: "score",
    instructions: "How urgent?",
    criteria: ["not urgent", "urgent", "critical"],
  },
  churn: {
    type: "noul",
    instructions: "Likely to cancel?",
    criteria: { true: "says they will leave", false: "anything else" },
  },
};

beforeEach(() => h.reset());
afterEach(async () => {
  await disposeAll();
});

describe("toLlamaQuestions", () => {
  it("renames instructions to instruction and keeps criteria for every type", () => {
    expect(toLlamaQuestions(questions)).toEqual({
      team: {
        type: "choice",
        instruction: "Which team?",
        criteria: { billing: "payments, refunds", support: "help, bugs" },
      },
      urgency: {
        type: "score",
        instruction: "How urgent?",
        criteria: ["not urgent", "urgent", "critical"],
      },
      churn: {
        type: "noul",
        instruction: "Likely to cancel?",
        criteria: { true: "says they will leave", false: "anything else" },
      },
    });
  });

  it("leaves out a noul's criteria when it has none", () => {
    expect(toLlamaQuestions({ q: { type: "noul", instructions: "Yes?" } })).toEqual({
      q: { type: "noul", instruction: "Yes?" },
    });
  });
});

describe("fromLlamaAnswers", () => {
  it("turns each answer type into smoltalk's", () => {
    const answers = fromLlamaAnswers(questions, {
      team: { type: "choice", choice: "billing", confidence: 0.3, probabilities: { billing: 0.6, support: 0.4 } },
      urgency: { type: "score", score: 1.5, confidence: 0.9, probabilities: [0.1, 0.3, 0.6] },
      churn: { type: "noul", value: 0.2 },
    });
    expect(answers).toEqual({
      team: { type: "choice", choice: "billing", confidence: 0.3, probabilities: { billing: 0.6, support: 0.4 } },
      urgency: {
        type: "score",
        score: 1.5,
        confidence: 0.9,
        legend: { "0": "not urgent", "1": "urgent", "2": "critical" },
        probabilities: { "0": 0.1, "1": 0.3, "2": 0.6 },
      },
      churn: { type: "noul", noul: 0.2 },
    });
  });
});

describe("decide", () => {
  it("sends a string state as the document and returns the answers and usage", async () => {
    const r = await decide("I was charged twice.", questions, { model: "/m/qwen.gguf" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(h.calls[0].document).toBe("I was charged twice.");
    expect(h.calls[0].questions).toEqual(toLlamaQuestions(questions));
    expect(r.value.usage).toEqual({ inputTokens: 170, outputTokens: 3 });
    expect(r.value.answers.churn).toEqual({ type: "noul", noul: 0.2 });
  });

  it("sends an object state as indented JSON", async () => {
    await decide({ subject: "refund" }, questions, { model: "/m/qwen.gguf" });
    expect(h.calls[0].document).toBe('{\n  "subject": "refund"\n}');
  });

  it("passes the abort signal to the library", async () => {
    const controller = new AbortController();
    await decide("hi", questions, { model: "/m/qwen.gguf", abortSignal: controller.signal });
    expect(h.calls[0].options).toEqual({ signal: controller.signal });
  });

  it("returns a state that cannot be turned into JSON as a failure instead of throwing", async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const r = await decide(circular, questions, { model: "/m/qwen.gguf" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toMatch(/^smoltalk-llama-cpp: the state could not be turned into JSON: /);
    }
    expect(h.counters.loadModel).toBe(0);
  });

  it("fails before any load for a URI model", async () => {
    const r = await decide("hi", questions, { model: "hf:unsloth/Qwen3.5-0.8B-GGUF:Q8_0" });
    expect(r).toEqual({
      success: false,
      error:
        'smoltalk-llama-cpp: decisions need a local .gguf path. To download or resolve "hf:unsloth/Qwen3.5-0.8B-GGUF:Q8_0", call resolveModel() first and pass its result as the model.',
    });
    expect(h.counters.loadModel).toBe(0);
  });

  it("fails and names the path when the model does not load", async () => {
    h.flags.failLoadModelOnce = true;
    const r = await decide("hi", questions, { model: "/m/broken.gguf" });
    expect(r).toEqual({
      success: false,
      error: "smoltalk-llama-cpp: could not load /m/broken.gguf for decisions: file is not a GGUF",
    });
  });

  it("fails without evaluating when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await decide("hi", questions, { model: "/m/qwen.gguf", abortSignal: controller.signal });
    expect(r).toEqual({ success: false, error: "Request was aborted" });
    expect(h.counters.decideWithMeta).toBe(0);
  });

  it("fails without evaluating when the signal fires while waiting for the lock", async () => {
    h.flags.decideDelayMs = 30;
    const first = decide("first", questions, { model: "/m/qwen.gguf" });
    // Let the first call take the lock before the second one queues.
    await new Promise((r) => setTimeout(r, 5));
    const controller = new AbortController();
    const second = decide("second", questions, { model: "/m/qwen.gguf", abortSignal: controller.signal });
    controller.abort();
    const [a, b] = await Promise.all([first, second]);
    expect(a.success).toBe(true);
    expect(b).toEqual({ success: false, error: "Request was aborted" });
    expect(h.counters.decideWithMeta).toBe(1);
  });

  it("returns the library's error as a failure instead of throwing", async () => {
    h.flags.decideError = new Error("A score question can have at most 10 criteria levels");
    const r = await decide("hi", questions, { model: "/m/qwen.gguf" });
    expect(r).toEqual({
      success: false,
      error:
        "smoltalk-llama-cpp: deciding with /m/qwen.gguf failed: A score question can have at most 10 criteria levels",
    });
  });

  it("reports an abort during evaluation as aborted", async () => {
    // The fake evaluates for 30 ms and then throws, as the library does when
    // its signal fires; the abort lands while it is evaluating.
    h.flags.decideDelayMs = 30;
    h.flags.decideError = new Error("This operation was aborted");
    const controller = new AbortController();
    const pending = decide("hi", questions, { model: "/m/qwen.gguf", abortSignal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.counters.decideWithMeta).toBe(1);
    controller.abort();
    const r = await pending;
    expect(r).toEqual({ success: false, error: "Request was aborted" });
  });
});
