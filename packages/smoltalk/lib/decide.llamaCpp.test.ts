import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  decide,
  registerDecisionProvider,
  unregisterDecisionProvider,
  type DecideProvider,
  type DecisionQuestion,
} from "./decide.js";
import { _setImportForTests } from "./clients/llamaCppLoader.js";
import { unregisterProvider } from "./client.js";
import { TestProvider } from "./testing/index.js";
import { success } from "./types/result.js";

const fakeResolveModel = async (uriOrPath: string, _cacheDir: string) => uriOrPath;

const questions: Record<string, DecisionQuestion> = {
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { billing: "refunds", support: "bugs" },
  },
};

const config = { provider: "llama-cpp", model: "/models/qwen.gguf" };

function pluginDecide(choice: string): DecideProvider {
  return async () =>
    success({
      answers: { team: { type: "choice", choice, confidence: 0.4, probabilities: { billing: 0.7, support: 0.3 } } },
      usage: { inputTokens: 170, outputTokens: 3 },
    });
}

beforeEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
  unregisterDecisionProvider("llama-cpp");
});

afterEach(() => {
  _setImportForTests(undefined);
  unregisterProvider("llama-cpp");
  unregisterDecisionProvider("llama-cpp");
});

describe("decide with provider llama-cpp", () => {
  it("loads the plugin and returns its decide's answers, with no cost", async () => {
    let received: unknown;
    _setImportForTests(async () => ({
      LlamaCPP: TestProvider,
      resolveModel: fakeResolveModel,
      decide: async (state: unknown, qs: unknown, cfg: { model: string }) => {
        received = { state, model: cfg.model };
        return pluginDecide("billing")(state as string, qs as typeof questions, cfg);
      },
    }));
    const r = await decide("refund please", questions, config);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.answers.team).toMatchObject({ type: "choice", choice: "billing" });
    expect(r.value.usage).toEqual({ inputTokens: 170, outputTokens: 3 });
    expect(r.value.cost).toBeUndefined();
    expect(received).toEqual({ state: "refund please", model: "/models/qwen.gguf" });
  });

  it("answers with a chat model the caller has in the catalog as a text model", async () => {
    // For llama-cpp the decision model is an ordinary chat model, which a
    // caller may have registered as text to get its limits and pricing.
    _setImportForTests(async () => ({
      LlamaCPP: TestProvider,
      resolveModel: fakeResolveModel,
      decide: pluginDecide("billing"),
    }));
    const r = await decide("refund please", questions, {
      ...config,
      modelData: {
        schemaVersion: 1,
        generatedAt: "2026-11-09T00:00:00Z",
        models: [
          {
            type: "text",
            modelName: "/models/qwen.gguf",
            provider: "llama-cpp",
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
          },
        ],
        hostedTools: [],
      },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.value.answers.team).toMatchObject({ choice: "billing" });
  });

  it("says the plugin is too old when it has no decide", async () => {
    _setImportForTests(async () => ({ LlamaCPP: TestProvider, resolveModel: fakeResolveModel }));
    const r = await decide("hi", questions, config);
    expect(r).toEqual({
      success: false,
      error:
        "Your installed smoltalk-llama-cpp has no decision support. Upgrade it (npm i smoltalk-llama-cpp@latest).",
    });
  });

  it("returns a failed import as a failure", async () => {
    _setImportForTests(async () => {
      const err = new Error("Cannot find package 'smoltalk-llama-cpp'");
      (err as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
      throw err;
    });
    const r = await decide("hi", questions, config);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("npm i smoltalk-llama-cpp");
  });

  it("uses a hand-registered llama-cpp provider and does not load the plugin", async () => {
    let imports = 0;
    _setImportForTests(async () => {
      imports += 1;
      return { LlamaCPP: TestProvider, resolveModel: fakeResolveModel };
    });
    registerDecisionProvider("llama-cpp", pluginDecide("support"));
    const r = await decide("hi", questions, config);
    expect(r.success).toBe(true);
    if (r.success) expect(r.value.answers.team).toMatchObject({ choice: "support" });
    expect(imports).toBe(0);
  });

  it("checks the plugin's answers", async () => {
    _setImportForTests(async () => ({
      LlamaCPP: TestProvider,
      resolveModel: fakeResolveModel,
      decide: pluginDecide("sales"),
    }));
    const r = await decide("hi", questions, config);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/answered "sales", which is not one of its options/);
  });

  it("is listed among the built-in providers", async () => {
    const r = await decide("hi", questions, { provider: "acme", model: "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("llama-cpp");
  });
});
