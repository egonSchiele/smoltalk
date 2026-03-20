import { describe, it, expect, vi } from "vitest";
import { userMessage, systemMessage } from "./classes/message/index.js";
import { PromptResult, SmolPromptConfig } from "./types.js";
import { Result, success, failure } from "./types/result.js";
import { runMiddlewareCheck } from "./middleware.js";

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
