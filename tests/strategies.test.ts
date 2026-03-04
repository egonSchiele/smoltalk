import { describe, it, expect, vi } from "vitest";
import { BaseStrategy } from "../lib/strategies/baseStrategy.js";
import { IDStrategy } from "../lib/strategies/idStrategy.js";
import { FallbackStrategy } from "../lib/strategies/fallbackStrategy.js";
import { RaceStrategy } from "../lib/strategies/raceStrategy.js";
import * as strategyIndex from "../lib/strategies/index.js";
import { Strategy } from "../lib/strategies/types.js";
import { Model } from "../lib/model.js";
import { SmolPromptConfig, PromptResult } from "../lib/types.js";
import { Result, Success } from "../lib/types/result.js";
import {
  SmolTimeoutError,
  SmolStructuredOutputError,
} from "../lib/smolError.js";

// Helper to create a mock strategy that returns a given result or throws
function mockStrategy(
  result?: Result<PromptResult>,
  error?: Error,
): Strategy {
  return {
    text: vi.fn(async () => {
      if (error) throw error;
      return result!;
    }),
    _text: vi.fn(async () => {
      if (error) throw error;
      return result!;
    }),
    textSync: vi.fn(async () => {
      if (error) throw error;
      return result!;
    }),
    _textSync: vi.fn(async () => {
      if (error) throw error;
      return result!;
    }),
    textStream: vi.fn(async () => {
      throw new Error("not implemented");
    }),
  };
}

function makeResult(output: string): Success<PromptResult> {
  return {
    success: true,
    data: {
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

  it("text() calls _text() with strategy stripped from config", async () => {
    const strategy = new BaseStrategy();
    const spy = vi
      .spyOn(strategy, "_text")
      .mockResolvedValue(makeResult("ok"));
    const configWithStrategy = {
      ...dummyConfig,
      strategy: strategy,
    };
    await strategy.text(configWithStrategy);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: undefined }),
    );
  });
});

describe("FallbackStrategy", () => {
  it("returns result from first strategy on success", async () => {
    const result = makeResult("first");
    const s1 = mockStrategy(result);
    const s2 = mockStrategy(makeResult("second"));

    const fallback = new FallbackStrategy([s1, s2], {
      fallbackOn: ["error"],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toBe(result);
    expect(s2.text).not.toHaveBeenCalled();
  });

  it("falls back on generic error when configured", async () => {
    const result = makeResult("second");
    const s1 = mockStrategy(undefined, new Error("boom"));
    const s2 = mockStrategy(result);

    const fallback = new FallbackStrategy([s1, s2], {
      fallbackOn: ["error"],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toBe(result);
  });

  it("falls back on timeout when configured", async () => {
    const result = makeResult("second");
    const s1 = mockStrategy(undefined, new SmolTimeoutError("timed out"));
    const s2 = mockStrategy(result);

    const fallback = new FallbackStrategy([s1, s2], {
      fallbackOn: ["timeout"],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toBe(result);
  });

  it("falls back on structured output failure when configured", async () => {
    const result = makeResult("second");
    const s1 = mockStrategy(
      undefined,
      new SmolStructuredOutputError("bad format"),
    );
    const s2 = mockStrategy(result);

    const fallback = new FallbackStrategy([s1, s2], {
      fallbackOn: ["structuredOutputFailure"],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toBe(result);
  });

  it("does NOT fall back on timeout when only 'error' is configured", async () => {
    const s1 = mockStrategy(undefined, new SmolTimeoutError("timed out"));
    const s2 = mockStrategy(makeResult("second"));

    const fallback = new FallbackStrategy([s1, s2], {
      fallbackOn: ["error"],
    });
    await expect(fallback.text(dummyConfig)).rejects.toThrow(SmolTimeoutError);
    expect(s2.text).not.toHaveBeenCalled();
  });

  it("does NOT fall back on generic error when only 'timeout' is configured", async () => {
    const s1 = mockStrategy(undefined, new Error("generic"));
    const s2 = mockStrategy(makeResult("second"));

    const fallback = new FallbackStrategy([s1, s2], {
      fallbackOn: ["timeout"],
    });
    await expect(fallback.text(dummyConfig)).rejects.toThrow("generic");
    expect(s2.text).not.toHaveBeenCalled();
  });

  it("throws when all strategies fail", async () => {
    const s1 = mockStrategy(undefined, new Error("fail1"));
    const s2 = mockStrategy(undefined, new Error("fail2"));

    const fallback = new FallbackStrategy([s1, s2], {
      fallbackOn: ["error"],
    });
    await expect(fallback.text(dummyConfig)).rejects.toThrow(
      /All fallback strategies failed/,
    );
  });

  it("tries strategies in order, stopping at first success", async () => {
    const s1 = mockStrategy(undefined, new Error("fail"));
    const s2 = mockStrategy(makeResult("second"));
    const s3 = mockStrategy(makeResult("third"));

    const fallback = new FallbackStrategy([s1, s2, s3], {
      fallbackOn: ["error"],
    });
    const out = await fallback.text(dummyConfig);
    expect(out).toEqual(makeResult("second"));
    expect(s3.text).not.toHaveBeenCalled();
  });
});

describe("RaceStrategy", () => {
  it("returns the result of whichever strategy resolves first", async () => {
    // s1 resolves immediately, s2 takes longer
    const s1: Strategy = {
      ...mockStrategy(),
      text: vi.fn(async () => makeResult("fast")),
    };
    const s2: Strategy = {
      ...mockStrategy(),
      text: vi.fn(
        () =>
          new Promise<Result<PromptResult>>((resolve) =>
            setTimeout(() => resolve(makeResult("slow")), 100),
          ),
      ),
    };

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
    const s1: Strategy = {
      ...mockStrategy(),
      text: vi.fn(async () => {
        throw new Error("fast fail");
      }),
    };
    const s2: Strategy = {
      ...mockStrategy(),
      text: vi.fn(
        () =>
          new Promise<Result<PromptResult>>((resolve) =>
            setTimeout(() => resolve(makeResult("slow")), 100),
          ),
      ),
    };

    const race = new RaceStrategy([s1, s2]);
    await expect(race.text(dummyConfig)).rejects.toThrow("fast fail");
  });

  it("aborts losing strategies when the winner resolves", async () => {
    const receivedSignals: AbortSignal[] = [];

    const s1: Strategy = {
      ...mockStrategy(),
      text: vi.fn(async (config: SmolPromptConfig) => {
        receivedSignals.push(config.abortSignal!);
        return makeResult("winner");
      }),
    };
    const s2: Strategy = {
      ...mockStrategy(),
      text: vi.fn((config: SmolPromptConfig) => {
        receivedSignals.push(config.abortSignal!);
        return new Promise<Result<PromptResult>>((resolve) =>
          setTimeout(() => resolve(makeResult("loser")), 500),
        );
      }),
    };

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

    const s1: Strategy = {
      ...mockStrategy(),
      text: vi.fn(async (config: SmolPromptConfig) => {
        receivedSignals.push(config.abortSignal!);
        return makeResult("a");
      }),
    };
    const s2: Strategy = {
      ...mockStrategy(),
      text: vi.fn(async (config: SmolPromptConfig) => {
        receivedSignals.push(config.abortSignal!);
        return makeResult("b");
      }),
    };

    const race = new RaceStrategy([s1, s2]);
    await race.text(dummyConfig);
    // Each strategy should get its own distinct signal
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals[0]).not.toBe(receivedSignals[1]);
  });

  it("propagates external abort signal to all strategies", async () => {
    const externalController = new AbortController();
    const receivedSignals: AbortSignal[] = [];

    const s1: Strategy = {
      ...mockStrategy(),
      text: vi.fn((config: SmolPromptConfig) => {
        receivedSignals.push(config.abortSignal!);
        return new Promise<Result<PromptResult>>((resolve) =>
          setTimeout(() => resolve(makeResult("a")), 500),
        );
      }),
    };
    const s2: Strategy = {
      ...mockStrategy(),
      text: vi.fn((config: SmolPromptConfig) => {
        receivedSignals.push(config.abortSignal!);
        return new Promise<Result<PromptResult>>((resolve) =>
          setTimeout(() => resolve(makeResult("b")), 500),
        );
      }),
    };

    const race = new RaceStrategy([s1, s2]);
    const promise = race.text({ ...dummyConfig, abortSignal: externalController.signal });

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
      const existing = mockStrategy(makeResult("ok"));
      // existing is not a BaseStrategy instance, so it gets wrapped
      // Use a real IDStrategy to test passthrough
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
    it("creates a FallbackStrategy from model name strings", () => {
      const strategy = strategyIndex.fallback(["gpt-4o", "gpt-4o-mini"], {
        fallbackOn: ["error"],
      });
      expect(strategy).toBeInstanceOf(FallbackStrategy);
      const inner = (strategy as FallbackStrategy).strategies;
      expect(inner).toHaveLength(2);
      expect(inner[0]).toBeInstanceOf(IDStrategy);
      expect(inner[1]).toBeInstanceOf(IDStrategy);
    });

    it("passes through existing Strategy instances", () => {
      const idStrat = strategyIndex.id("gpt-4o");
      const strategy = strategyIndex.fallback([idStrat, "gpt-4o-mini"], {
        fallbackOn: ["timeout"],
      });
      const inner = (strategy as FallbackStrategy).strategies;
      expect(inner[0]).toBe(idStrat);
      expect(inner[1]).toBeInstanceOf(IDStrategy);
    });

    it("preserves the fallback config", () => {
      const config = { fallbackOn: ["error", "timeout"] as const };
      const strategy = strategyIndex.fallback(["gpt-4o"], {
        fallbackOn: [...config.fallbackOn],
      });
      expect((strategy as FallbackStrategy).config.fallbackOn).toEqual([
        "error",
        "timeout",
      ]);
    });
  });
});
