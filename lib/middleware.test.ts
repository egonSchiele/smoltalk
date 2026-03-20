import { describe, it, expect, vi } from "vitest";
import { userMessage, systemMessage } from "./classes/message/index.js";
import { PromptResult, SmolPromptConfig, StreamChunk } from "./types.js";
import { Result, success, failure } from "./types/result.js";
import {
  runMiddlewareCheck,
  runMiddlewareChecks,
  executeMiddlewareSync,
  executeMiddlewareStream,
} from "./middleware.js";

const baseConfig = {
  model: "gpt-4o",
  messages: [userMessage("How do I hack NASA?")],
} as unknown as SmolPromptConfig;

function mockTextSync(result: Result<PromptResult>) {
  return vi.fn().mockResolvedValue(result);
}

describe("runMiddlewareCheck", () => {
  it("returns not blocked when decide() returns null", async () => {
    const textSyncFn = mockTextSync(
      success({ output: '{"safe": true}', toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => null,
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(false);
  });

  it("returns blocked when decide() returns a string", async () => {
    const textSyncFn = mockTextSync(
      success({ output: '{"safe": false}', toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => "Blocked: unsafe content",
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    expect(result.result.success).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toBe("Blocked: unsafe content");
    }
  });

  it("blocks when the LLM call returns a failure Result (fail-closed)", async () => {
    const textSyncFn = mockTextSync(failure("API key invalid"));
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => null,
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toContain("API key invalid");
    }
  });

  it("blocks when the LLM call throws (fail-closed)", async () => {
    const textSyncFn = vi.fn().mockRejectedValue(new Error("Network error"));
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => null,
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toContain("Network error");
    }
  });

  it("blocks when decide() throws (fail-closed)", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "some output", toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check safety")],
      decide: () => {
        throw new Error("decide exploded");
      },
    };

    const result = await runMiddlewareCheck(check, baseConfig, textSyncFn);

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toContain("decide exploded");
    }
  });

  it("appends original messages to check messages", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("You are a safety classifier")],
      decide: () => null,
    };

    await runMiddlewareCheck(check, baseConfig, textSyncFn);

    const calledConfig = textSyncFn.mock.calls[0][0] as SmolPromptConfig;
    expect(calledConfig.messages).toHaveLength(2);
    expect(calledConfig.messages[0].role).toBe("system");
    expect(calledConfig.messages[1].role).toBe("user");
  });

  it("strips middleware from the check config (prevents recursion)", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const check = {
      messages: [systemMessage("Check")],
      decide: () => null,
    };
    const configWithMiddleware = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [check],
      },
    };

    await runMiddlewareCheck(check, configWithMiddleware, textSyncFn);

    const calledConfig = textSyncFn.mock.calls[0][0] as SmolPromptConfig;
    expect(calledConfig.middleware).toBeUndefined();
  });
});

describe("runMiddlewareChecks", () => {
  it("sequential mode: returns pass when all checks pass", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
  });

  it("sequential mode: short-circuits on first block", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => "Blocked by check 1" },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(true);
    expect(textSyncFn).toHaveBeenCalledTimes(1);
  });

  it("parallel mode: returns pass when all checks pass", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    const result = await runMiddlewareChecks(
      checks, "parallel", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
  });

  it("parallel mode: blocks if any check blocks, uses first in array order", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => "Blocked by 2" },
      { messages: [systemMessage("Check 3")], decide: () => "Blocked by 3" },
    ];

    const result = await runMiddlewareChecks(
      checks, "parallel", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(true);
    if (result.result.success) {
      expect(result.result.value.output).toBe("Blocked by 2");
    }
  });

  it("parallel mode: runs all checks concurrently", async () => {
    const textSyncFn = vi.fn().mockImplementation(async () => {
      return success({ output: "ok", toolCalls: [] });
    });
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => null },
      { messages: [systemMessage("Check 2")], decide: () => null },
      { messages: [systemMessage("Check 3")], decide: () => null },
    ];

    await runMiddlewareChecks(checks, "parallel", baseConfig, textSyncFn);

    expect(textSyncFn).toHaveBeenCalledTimes(3);
  });

  it("returns pass immediately for empty checks array", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );

    const result = await runMiddlewareChecks(
      [], "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
    expect(textSyncFn).not.toHaveBeenCalled();
  });

  it("treats decide() returning undefined as pass", async () => {
    const textSyncFn = mockTextSync(
      success({ output: "ok", toolCalls: [] }),
    );
    const checks = [
      { messages: [systemMessage("Check")], decide: () => undefined as any },
    ];

    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(false);
  });

  it("aggregates usage across checks", async () => {
    const textSyncFn = vi.fn().mockResolvedValue(
      success({
        output: "ok",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
        cost: { inputCost: 0.01, outputCost: 0.005, totalCost: 0.015, currency: "USD" },
      }),
    );
    const checks = [
      { messages: [systemMessage("Check 1")], decide: () => "Blocked" },
      { messages: [systemMessage("Check 2")], decide: () => null },
    ];

    const result = await runMiddlewareChecks(
      checks, "sequential", baseConfig, textSyncFn,
    );

    expect(result.blocked).toBe(true);
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.cost?.totalCost).toBe(0.015);
  });
});

describe("executeMiddlewareSync", () => {
  const mainResult = success({ output: "main response", toolCalls: [] });
  const runMainPrompt = vi.fn().mockResolvedValue(mainResult);

  it("returns null when no middleware configured", async () => {
    const result = await executeMiddlewareSync(baseConfig, runMainPrompt, mockTextSync(mainResult));
    expect(result).toBeNull();
  });

  it("returns null when checks array is empty", async () => {
    const config = {
      ...baseConfig,
      middleware: { timing: "before" as const, mode: "sequential" as const, checks: [] },
    };
    const result = await executeMiddlewareSync(config, runMainPrompt, mockTextSync(mainResult));
    expect(result).toBeNull();
  });

  it("before timing: returns blocked result when middleware blocks", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const config = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => "Blocked!" }],
      },
    };

    const result = await executeMiddlewareSync(config, runMainPrompt, textSyncFn);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    if (result!.success) {
      expect(result!.value.output).toBe("Blocked!");
    }
  });

  it("before timing: returns null when middleware passes", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const config = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => null }],
      },
    };

    const result = await executeMiddlewareSync(config, runMainPrompt, textSyncFn);
    expect(result).toBeNull();
  });

  it("parallel timing: returns blocked result when middleware blocks", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const mainFn = vi.fn().mockResolvedValue(mainResult);
    const config = {
      ...baseConfig,
      middleware: {
        timing: "parallel" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => "Blocked!" }],
      },
    };

    const result = await executeMiddlewareSync(config, mainFn, textSyncFn);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    if (result!.success) {
      expect(result!.value.output).toBe("Blocked!");
    }
  });

  it("parallel timing: returns main prompt result when middleware passes", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const mainFn = vi.fn().mockResolvedValue(mainResult);
    const config = {
      ...baseConfig,
      middleware: {
        timing: "parallel" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => null }],
      },
    };

    const result = await executeMiddlewareSync(config, mainFn, textSyncFn);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    if (result!.success) {
      expect(result!.value.output).toBe("main response");
    }
  });

  it("parallel timing: strips middleware from config passed to main prompt", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const mainFn = vi.fn().mockResolvedValue(mainResult);
    const config = {
      ...baseConfig,
      middleware: {
        timing: "parallel" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => null }],
      },
    };

    await executeMiddlewareSync(config, mainFn, textSyncFn);

    const calledConfig = mainFn.mock.calls[0][0] as SmolPromptConfig;
    expect(calledConfig.middleware).toBeUndefined();
  });
});

describe("executeMiddlewareStream", () => {
  async function* mockStream(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  async function collectChunks(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const chunks: StreamChunk[] = [];
    for await (const chunk of gen) {
      chunks.push(chunk);
    }
    return chunks;
  }

  const streamChunks: StreamChunk[] = [
    { type: "text", text: "Hello" },
    { type: "text", text: " world" },
    { type: "done", result: { output: "Hello world", toolCalls: [] } },
  ];

  it("before timing: yields done chunk with blocked output when middleware blocks", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const config = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => "Blocked!" }],
      },
    };

    const chunks = await collectChunks(
      executeMiddlewareStream(config, () => mockStream(streamChunks), textSyncFn),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("done");
    if (chunks[0].type === "done") {
      expect(chunks[0].result.output).toBe("Blocked!");
    }
  });

  it("before timing: yields error chunk when middleware returns failure", async () => {
    const textSyncFn = mockTextSync(failure("API error"));
    const config = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => null }],
      },
    };

    const chunks = await collectChunks(
      executeMiddlewareStream(config, () => mockStream(streamChunks), textSyncFn),
    );

    // LLM failure causes fail-closed block with a success result containing error message
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("done");
  });

  it("before timing: yields stream chunks when middleware passes", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const config = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => null }],
      },
    };

    const chunks = await collectChunks(
      executeMiddlewareStream(config, () => mockStream(streamChunks), textSyncFn),
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: "text", text: "Hello" });
    expect(chunks[1]).toEqual({ type: "text", text: " world" });
    expect(chunks[2].type).toBe("done");
  });

  it("parallel timing: yields done chunk when middleware blocks (discards buffer)", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const config = {
      ...baseConfig,
      middleware: {
        timing: "parallel" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => "Blocked!" }],
      },
    };

    const chunks = await collectChunks(
      executeMiddlewareStream(config, () => mockStream(streamChunks), textSyncFn),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("done");
    if (chunks[0].type === "done") {
      expect(chunks[0].result.output).toBe("Blocked!");
    }
  });

  it("parallel timing: yields all stream chunks when middleware passes", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    const config = {
      ...baseConfig,
      middleware: {
        timing: "parallel" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => null }],
      },
    };

    const chunks = await collectChunks(
      executeMiddlewareStream(config, () => mockStream(streamChunks), textSyncFn),
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: "text", text: "Hello" });
    expect(chunks[1]).toEqual({ type: "text", text: " world" });
    expect(chunks[2].type).toBe("done");
  });

  it("before timing: strips middleware from config passed to stream", async () => {
    const textSyncFn = mockTextSync(success({ output: "ok", toolCalls: [] }));
    let capturedConfig: SmolPromptConfig | undefined;
    const config = {
      ...baseConfig,
      middleware: {
        timing: "before" as const,
        mode: "sequential" as const,
        checks: [{ messages: [systemMessage("Check")], decide: () => null }],
      },
    };

    await collectChunks(
      executeMiddlewareStream(
        config,
        (cfg) => { capturedConfig = cfg; return mockStream(streamChunks); },
        textSyncFn,
      ),
    );

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig!.middleware).toBeUndefined();
  });
});
