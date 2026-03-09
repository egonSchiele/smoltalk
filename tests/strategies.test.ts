import { describe, it, expect, vi } from "vitest";
import { BaseStrategy } from "../lib/strategies/baseStrategy.js";
import { IDStrategy } from "../lib/strategies/idStrategy.js";
import { FallbackStrategy } from "../lib/strategies/fallbackStrategy.js";
import { RaceStrategy } from "../lib/strategies/raceStrategy.js";
import * as strategyIndex from "../lib/strategies/index.js";
import { Strategy, StrategyJSON } from "../lib/strategies/types.js";
import { Model } from "../lib/model.js";
import { SmolPromptConfig, PromptResult } from "../lib/types.js";
import { Result, Success } from "../lib/types/result.js";
import {
  SmolTimeoutError,
  SmolStructuredOutputError,
} from "../lib/smolError.js";

// Helper to create a mock strategy that returns a given result or throws.
// Extends BaseStrategy so instanceof checks work in RaceStrategy/FallbackStrategy.
class MockStrategy extends BaseStrategy {
  private _result?: Result<PromptResult>;
  private _error?: Error;
  text: ReturnType<typeof vi.fn>;
  constructor(result?: Result<PromptResult>, error?: Error) {
    super();
    this._result = result;
    this._error = error;
    this.text = vi.fn(async () => {
      if (this._error) throw this._error;
      return this._result!;
    });
  }
  async _text() {
    if (this._error) throw this._error;
    return this._result!;
  }
  toJSON() {
    return { type: "id" as const, params: { model: "mock" } };
  }
  toString() { return "MockStrategy"; }
  toShortString() { return "Mock"; }
}

function mockStrategy(result?: Result<PromptResult>, error?: Error): MockStrategy {
  return new MockStrategy(result, error);
}

function makeResult(output: string): Success<PromptResult> {
  return {
    success: true,
    value: {
      output,
      toolCalls: [],
    },
  };
}

const dummyConfig = {
  model: "gpt-4o",
  messages: [],
} as unknown as SmolPromptConfig;

describe("BaseStrategy", () => {
  it("throws on unimplemented _text", async () => {
    const strategy = new BaseStrategy();
    await expect(strategy._text(dummyConfig)).rejects.toThrow(
      /not implemented/,
    );
  });

  it("throws on unimplemented _textSync", async () => {
    const strategy = new BaseStrategy();
    await expect(strategy._textSync(dummyConfig)).rejects.toThrow(
      /not implemented/,
    );
  });

  it("throws on unimplemented textStream", async () => {
    const strategy = new BaseStrategy();
    await expect(strategy.textStream(dummyConfig)).rejects.toThrow(
      /not implemented/,
    );
  });

  it("text() calls _text() with the config passed through", async () => {
    const strategy = new BaseStrategy();
    const spy = vi.spyOn(strategy, "_text").mockResolvedValue(makeResult("ok"));
    await strategy.text(dummyConfig);
    expect(spy).toHaveBeenCalledWith(dummyConfig);
  });
});

describe("FallbackStrategy", () => {
  // Sentinel JSON used as fallback targets in tests.
  // We mock fromJSON (via the strategy index) so it returns a mock strategy
  // instead of trying to resolve a real model.
  const fallbackJSON: StrategyJSON = { type: "id", params: { model: "gpt-4o" } };
  const fallbackJSON2: StrategyJSON = { type: "id", params: { model: "gpt-4o-mini" } };
  const fallbackJSON3: StrategyJSON = { type: "id", params: { model: "o3-mini" } };

  it("returns result from first strategy on success", async () => {
    const result = makeResult("first");
    const s1 = mockStrategy(result);

    const fallback = new FallbackStrategy(s1, {});
    const out = await fallback.text(dummyConfig);
    expect(out).toBe(result);
  });

  it("falls back on generic error when configured", async () => {
    const result = makeResult("second");
    const s1 = mockStrategy(undefined, new Error("boom"));
    const s2 = mockStrategy(result);

    vi.spyOn(strategyIndex, "fromJSON").mockReturnValueOnce(s2);
    const fallback = new FallbackStrategy(s1, {
      error: [fallbackJSON],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toEqual(result);
    vi.restoreAllMocks();
  });

  it("falls back on timeout when configured", async () => {
    const result = makeResult("second");
    const s1 = mockStrategy(undefined, new SmolTimeoutError("timed out"));
    const s2 = mockStrategy(result);

    vi.spyOn(strategyIndex, "fromJSON").mockReturnValueOnce(s2);
    const fallback = new FallbackStrategy(s1, {
      timeout: [fallbackJSON],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toEqual(result);
    vi.restoreAllMocks();
  });

  it("falls back on structured output failure when configured", async () => {
    const result = makeResult("second");
    const s1 = mockStrategy(
      undefined,
      new SmolStructuredOutputError("bad format"),
    );
    const s2 = mockStrategy(result);

    vi.spyOn(strategyIndex, "fromJSON").mockReturnValueOnce(s2);
    const fallback = new FallbackStrategy(s1, {
      structuredOutputFailure: [fallbackJSON],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toEqual(result);
    vi.restoreAllMocks();
  });

  it("'error' should handle all errors and trigger a fallback", async () => {
    const s1 = mockStrategy(undefined, new SmolTimeoutError("timed out"));
    const s2 = mockStrategy(makeResult("second"));

    // 'error' is a catch-all that handles any error type
    vi.spyOn(strategyIndex, "fromJSON").mockReturnValueOnce(s2);
    const fallback = new FallbackStrategy(s1, {
      error: [fallbackJSON],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toEqual(makeResult("second"));
    vi.restoreAllMocks();
  });

  it("does NOT fall back on generic error when only 'timeout' is configured", async () => {
    const s1 = mockStrategy(undefined, new Error("generic"));

    const fallback = new FallbackStrategy(s1, {
      timeout: [fallbackJSON],
    });
    await expect(fallback.text(dummyConfig)).rejects.toThrow("generic");
  });

  it("throws when all strategies fail", async () => {
    const s1 = mockStrategy(undefined, new Error("fail1"));
    const s2 = mockStrategy(undefined, new Error("fail2"));

    vi.spyOn(strategyIndex, "fromJSON").mockReturnValueOnce(s2);
    const fallback = new FallbackStrategy(s1, {
      error: [fallbackJSON],
    });
    await expect(fallback.text(dummyConfig)).rejects.toThrow("fail2");
    vi.restoreAllMocks();
  });

  it("tries strategies in order, stopping at first success", async () => {
    const s1 = mockStrategy(undefined, new Error("fail"));
    const s2 = mockStrategy(makeResult("second"));
    const s3 = mockStrategy(makeResult("third"));

    vi.spyOn(strategyIndex, "fromJSON")
      .mockReturnValueOnce(s2)
      .mockReturnValueOnce(s3);
    const fallback = new FallbackStrategy(s1, {
      error: [fallbackJSON, fallbackJSON2],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toEqual(makeResult("second"));
    vi.restoreAllMocks();
  });
});

describe("RaceStrategy", () => {
  it("returns the result of whichever strategy resolves first", async () => {
    // s1 resolves immediately, s2 takes longer
    const s1 = mockStrategy(makeResult("fast"));
    const s2 = new MockStrategy();
    s2.text = vi.fn(
      () =>
        new Promise<Result<PromptResult>>((resolve) =>
          setTimeout(() => resolve(makeResult("slow")), 100),
        ),
    );

    const race = new RaceStrategy([s1, s2]);
    const out = await race.text(dummyConfig);
    expect(out).toEqual(makeResult("fast"));
  });

  it("calls all strategies concurrently", async () => {
    const s1 = mockStrategy(makeResult("a"));
    const s2 = mockStrategy(makeResult("b"));

    const race = new RaceStrategy([s1, s2]);
    await race.text(dummyConfig);
    // Both should have been called
    expect(s1.text).toHaveBeenCalled();
    expect(s2.text).toHaveBeenCalled();
  });

  it("rejects if the first-to-settle rejects", async () => {
    const s1 = new MockStrategy();
    s1.text = vi.fn(async () => {
      throw new Error("fast fail");
    });
    const s2 = new MockStrategy();
    s2.text = vi.fn(
      () =>
        new Promise<Result<PromptResult>>((resolve) =>
          setTimeout(() => resolve(makeResult("slow")), 100),
        ),
    );

    const race = new RaceStrategy([s1, s2]);
    await expect(race.text(dummyConfig)).rejects.toThrow("fast fail");
  });

  it("aborts losing strategies when the winner resolves", async () => {
    const receivedSignals: AbortSignal[] = [];

    const s1 = new MockStrategy();
    s1.text = vi.fn(async (config: SmolPromptConfig) => {
      receivedSignals.push(config.abortSignal!);
      return makeResult("winner");
    });
    const s2 = new MockStrategy();
    s2.text = vi.fn((config: SmolPromptConfig) => {
      receivedSignals.push(config.abortSignal!);
      return new Promise<Result<PromptResult>>((resolve) =>
        setTimeout(() => resolve(makeResult("loser")), 500),
      );
    });

    const race = new RaceStrategy([s1, s2]);
    const out = await race.text(dummyConfig);
    expect(out).toEqual(makeResult("winner"));
    // The winner's signal should not be aborted
    expect(receivedSignals[0].aborted).toBe(false);
    // The loser's signal should be aborted
    expect(receivedSignals[1].aborted).toBe(true);
  });

  it("passes abort signals that each strategy receives", async () => {
    const receivedSignals: AbortSignal[] = [];

    const s1 = new MockStrategy();
    s1.text = vi.fn(async (config: SmolPromptConfig) => {
      receivedSignals.push(config.abortSignal!);
      return makeResult("a");
    });
    const s2 = new MockStrategy();
    s2.text = vi.fn(async (config: SmolPromptConfig) => {
      receivedSignals.push(config.abortSignal!);
      return makeResult("b");
    });

    const race = new RaceStrategy([s1, s2]);
    await race.text(dummyConfig);
    // Each strategy should get its own distinct signal
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals[0]).not.toBe(receivedSignals[1]);
  });

  it("propagates external abort signal to all strategies", async () => {
    const externalController = new AbortController();
    const receivedSignals: AbortSignal[] = [];

    const s1 = new MockStrategy();
    s1.text = vi.fn((config: SmolPromptConfig) => {
      receivedSignals.push(config.abortSignal!);
      return new Promise<Result<PromptResult>>((resolve) =>
        setTimeout(() => resolve(makeResult("a")), 500),
      );
    });
    const s2 = new MockStrategy();
    s2.text = vi.fn((config: SmolPromptConfig) => {
      receivedSignals.push(config.abortSignal!);
      return new Promise<Result<PromptResult>>((resolve) =>
        setTimeout(() => resolve(makeResult("b")), 500),
      );
    });

    const race = new RaceStrategy([s1, s2]);
    const promise = race.text({
      ...dummyConfig,
      abortSignal: externalController.signal,
    });

    // Abort externally
    externalController.abort();

    // Both strategy signals should be aborted
    expect(receivedSignals[0].aborted).toBe(true);
    expect(receivedSignals[1].aborted).toBe(true);
  });
});

describe("IDStrategy", () => {
  it("stores the model and exposes it", async () => {
    const { Model } = await import("../lib/model.js");
    const model = new Model("gpt-4o");
    const strategy = new IDStrategy(model);
    expect(strategy.model).toBe(model);
    expect(strategy.model.getResolvedModel()).toBe("gpt-4o");
  });
});

describe("factory functions", () => {
  describe("id()", () => {
    it("creates an IDStrategy from a model name string", () => {
      const strategy = strategyIndex.id("gpt-4o");
      expect(strategy).toBeInstanceOf(IDStrategy);
      expect((strategy as IDStrategy).model.getResolvedModel()).toBe("gpt-4o");
    });

    it("creates an IDStrategy from a Model instance", () => {
      const model = new Model("gpt-4o");
      const strategy = strategyIndex.id(model);
      expect(strategy).toBeInstanceOf(IDStrategy);
      expect((strategy as IDStrategy).model).toBe(model);
    });
  });

  describe("race()", () => {
    it("creates a RaceStrategy from model name strings", () => {
      const strategy = strategyIndex.race("gpt-4o", "gpt-4o-mini");
      expect(strategy).toBeInstanceOf(RaceStrategy);
      const inner = (strategy as RaceStrategy).strategies;
      expect(inner).toHaveLength(2);
      expect(inner[0]).toBeInstanceOf(IDStrategy);
      expect(inner[1]).toBeInstanceOf(IDStrategy);
    });

    it("passes through existing Strategy instances", () => {
      const idStrat = strategyIndex.id("gpt-4o");
      const strategy = strategyIndex.race(idStrat, "gpt-4o-mini");
      const inner = (strategy as RaceStrategy).strategies;
      expect(inner[0]).toBe(idStrat);
      expect(inner[1]).toBeInstanceOf(IDStrategy);
    });

    it("wraps a mix of strings, Models, and Strategies", () => {
      const model = new Model("gpt-4o-mini");
      const idStrat = strategyIndex.id("gpt-4o");
      const strategy = strategyIndex.race(idStrat, model, "o3-mini");
      const inner = (strategy as RaceStrategy).strategies;
      expect(inner).toHaveLength(3);
      expect(inner[0]).toBe(idStrat);
      expect(inner[1]).toBeInstanceOf(IDStrategy);
      expect(inner[2]).toBeInstanceOf(IDStrategy);
    });
  });

  describe("fallback()", () => {
    it("creates a FallbackStrategy from a primary strategy and config", () => {
      const strategy = strategyIndex.fallback("gpt-4o", {
        error: [{ type: "id", params: { model: "gpt-4o-mini" } }],
      });
      expect(strategy).toBeInstanceOf(FallbackStrategy);
      expect(
        (strategy as FallbackStrategy).primaryStrategy,
      ).toBeInstanceOf(IDStrategy);
    });

    it("passes through existing Strategy instances as primary", () => {
      const idStrat = strategyIndex.id("gpt-4o");
      const strategy = strategyIndex.fallback(idStrat, {
        timeout: [{ type: "id", params: { model: "gpt-4o-mini" } }],
      });
      expect((strategy as FallbackStrategy).primaryStrategy).toBe(idStrat);
    });

    it("preserves the fallback config", () => {
      const config = {
        error: [{ type: "id" as const, params: { model: "gpt-4o-mini" } }],
        timeout: [{ type: "id" as const, params: { model: "o3-mini" } }],
      };
      const strategy = strategyIndex.fallback("gpt-4o", config);
      expect((strategy as FallbackStrategy).config).toEqual(config);
    });
  });
});

describe("JSON serialization", () => {
  describe("toJSON()", () => {
    it("IDStrategy serializes to id JSON", () => {
      const strategy = strategyIndex.id("gpt-4o");
      expect(strategy.toJSON()).toEqual({
        type: "id",
        params: { model: "gpt-4o" },
      });
    });

    it("RaceStrategy serializes recursively", () => {
      const strategy = strategyIndex.race("gpt-4o", "gpt-4o-mini");
      expect(strategy.toJSON()).toEqual({
        type: "race",
        params: {
          strategies: [
            { type: "id", params: { model: "gpt-4o" } },
            { type: "id", params: { model: "gpt-4o-mini" } },
          ],
        },
      });
    });

    it("FallbackStrategy serializes with config", () => {
      const strategy = strategyIndex.fallback("gpt-4o", {
        error: [{ type: "id", params: { model: "gpt-4o-mini" } }],
        timeout: [{ type: "id", params: { model: "o3-mini" } }],
      });
      expect(strategy.toJSON()).toEqual({
        type: "fallback",
        params: {
          primaryStrategy: { type: "id", params: { model: "gpt-4o" } },
          config: {
            error: [{ type: "id", params: { model: "gpt-4o-mini" } }],
            timeout: [{ type: "id", params: { model: "o3-mini" } }],
          },
        },
      });
    });

    it("BaseStrategy toJSON throws", () => {
      const strategy = new BaseStrategy();
      expect(() => strategy.toJSON()).toThrow(/not implemented/);
    });
  });

  describe("fromJSON()", () => {
    it("parses a string as model name → IDStrategy", () => {
      const strategy = strategyIndex.fromJSON("gpt-4o");
      expect(strategy).toBeInstanceOf(IDStrategy);
      expect((strategy as IDStrategy).model.getResolvedModel()).toBe("gpt-4o");
    });

    it("parses id JSON", () => {
      const strategy = strategyIndex.fromJSON({
        type: "id",
        params: { model: "gpt-4o-mini" },
      });
      expect(strategy).toBeInstanceOf(IDStrategy);
      expect((strategy as IDStrategy).model.getResolvedModel()).toBe(
        "gpt-4o-mini",
      );
    });

    it("parses race JSON recursively", () => {
      const strategy = strategyIndex.fromJSON({
        type: "race",
        params: {
          strategies: [
            "gpt-4o",
            { type: "id", params: { model: "gpt-4o-mini" } },
          ],
        },
      });
      expect(strategy).toBeInstanceOf(RaceStrategy);
      const inner = (strategy as RaceStrategy).strategies;
      expect(inner).toHaveLength(2);
      expect(inner[0]).toBeInstanceOf(IDStrategy);
      expect(inner[1]).toBeInstanceOf(IDStrategy);
    });

    it("parses fallback JSON with config", () => {
      const strategy = strategyIndex.fromJSON({
        type: "fallback",
        params: {
          primaryStrategy: { type: "id", params: { model: "gpt-4o" } },
          config: {
            error: [{ type: "id", params: { model: "gpt-4o-mini" } }],
          },
        },
      });
      expect(strategy).toBeInstanceOf(FallbackStrategy);
      const fb = strategy as FallbackStrategy;
      expect(fb.primaryStrategy).toBeInstanceOf(IDStrategy);
      expect(fb.config.error).toHaveLength(1);
    });

    it("throws on unknown type", () => {
      expect(() =>
        strategyIndex.fromJSON({ type: "unknown", params: {} } as any),
      ).toThrow(/Unknown strategy/);
    });
  });

  describe("round-trip", () => {
    it("IDStrategy survives toJSON → fromJSON", () => {
      const original = strategyIndex.id("gpt-4o");
      const restored = strategyIndex.fromJSON(original.toJSON());
      expect(restored).toBeInstanceOf(IDStrategy);
      expect(restored.toJSON()).toEqual(original.toJSON());
    });

    it("RaceStrategy survives toJSON → fromJSON", () => {
      const original = strategyIndex.race("gpt-4o", "gpt-4o-mini");
      const restored = strategyIndex.fromJSON(original.toJSON());
      expect(restored).toBeInstanceOf(RaceStrategy);
      expect(restored.toJSON()).toEqual(original.toJSON());
    });

    it("FallbackStrategy survives toJSON → fromJSON", () => {
      const original = strategyIndex.fallback("gpt-4o", {
        error: [{ type: "id", params: { model: "o3-mini" } }],
        timeout: [{ type: "id", params: { model: "gpt-4o-mini" } }],
      });
      const restored = strategyIndex.fromJSON(original.toJSON());
      expect(restored).toBeInstanceOf(FallbackStrategy);
      expect(restored.toJSON()).toEqual(original.toJSON());
    });

    it("nested race-containing-fallback survives round-trip", () => {
      const fb = strategyIndex.fallback("gpt-4o", {
        error: [{ type: "id", params: { model: "gpt-4o-mini" } }],
      });
      const original = strategyIndex.race(fb, "o3-mini");
      const json = original.toJSON();
      const restored = strategyIndex.fromJSON(json);
      expect(restored).toBeInstanceOf(RaceStrategy);
      expect(restored.toJSON()).toEqual(json);
    });
  });

  describe("strategy in model field", () => {
    it("Strategy instance is accepted in model field", () => {
      const strategy = strategyIndex.id("gpt-4o");
      const config: SmolPromptConfig = {
        ...dummyConfig,
        model: strategy,
      };
      expect(config.model).toBe(strategy);
    });

    it("StrategyJSON object is accepted in model field", () => {
      const config: SmolPromptConfig = {
        ...dummyConfig,
        model: { type: "id", params: { model: "gpt-4o" } },
      };
      expect(config.model).toEqual({
        type: "id",
        params: { model: "gpt-4o" },
      });
    });
  });
});
