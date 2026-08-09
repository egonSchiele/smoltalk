import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textStream, textSync } from "../functions.js";
import { audioPart, userMessage } from "../classes/message/index.js";
import { registerProvider, unregisterProvider } from "../client.js";
import { BaseClient } from "./baseClient.js";
import type { ModelDataBlob } from "../modelData.js";
import type { PromptResult, Result, SmolConfig, StreamChunk } from "../types.js";
import { promptResult, success } from "../types.js";

const create = vi.fn();
vi.mock("openai", () => {
  class FakeOpenAI {
    chat = { completions: { create } };
  }
  return { default: FakeOpenAI };
});

const audioMd = {
  schemaVersion: 1,
  generatedAt: "t",
  hostedTools: [],
  models: [
    {
      type: "text",
      modelName: "gpt-audio-1.5",
      provider: "openai",
      maxInputTokens: 128000,
      maxOutputTokens: 16384,
      modalities: { input: ["text", "audio"], output: ["text", "audio"] },
      inputTokenCost: 2.5,
      outputTokenCost: 10,
      inputAudioTokenCost: 32,
      outputAudioTokenCost: 64,
    },
  ],
} satisfies ModelDataBlob;

const usage = {
  prompt_tokens: 2_000_000,
  prompt_tokens_details: { audio_tokens: 1_000_000 },
  completion_tokens: 2_000_000,
  completion_tokens_details: { audio_tokens: 1_000_000 },
  total_tokens: 4_000_000,
};

function wavConfig(): SmolConfig {
  return {
    model: "gpt-audio-1.5",
    provider: "openai",
    modelData: audioMd,
    apiKey: { openAi: "test-key" },
    messages: [
      userMessage([
        "describe",
        audioPart({ kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" }),
      ]),
    ],
  } satisfies SmolConfig;
}

function syncResponse() {
  return {
    data: {
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage,
    },
    response: new Response(null, { status: 200 }),
  };
}

async function* streamResponse() {
  yield { choices: [{ delta: { content: "ok" }, finish_reason: null }] };
  yield { choices: [{ delta: {}, finish_reason: "stop" }], usage };
}

async function collectStream(config: SmolConfig): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of textStream(config)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("audio-in-chat (public sync/stream API)", () => {
  beforeEach(() => create.mockReset());

  it("sends exact input_audio and gives identical four-bucket sync/stream usage and cost", async () => {
    const config = wavConfig();

    create.mockReturnValueOnce({ withResponse: async () => syncResponse() });
    const sync = await textSync(config);
    expect(sync.success).toBe(true);
    expect(create.mock.calls[0][0].messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "input_audio", input_audio: { data: "AQID", format: "wav" } },
    ]);

    create.mockResolvedValueOnce(streamResponse());
    const chunks = await collectStream(wavConfig());
    expect(create.mock.calls[1][0]).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "input_audio", input_audio: { data: "AQID", format: "wav" } },
          ],
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });

    const done = chunks.find((chunk) => chunk.type === "done");
    if (!sync.success || done?.type !== "done") {
      throw new Error("expected successful sync and stream results");
    }
    expect(done.result.usage).toEqual(sync.value.usage);
    expect(done.result.cost).toEqual(sync.value.cost);
    expect(sync.value.usage).toMatchObject({
      inputTokens: 1_000_000,
      inputAudioTokens: 1_000_000,
      outputTokens: 1_000_000,
      outputAudioTokens: 1_000_000,
    });
    expect(sync.value.cost).toMatchObject({ inputCost: 34.5, outputCost: 74, totalCost: 108.5 });
  });

  it("sends the exact MP3 wire format", async () => {
    const config: SmolConfig = {
      model: "gpt-audio-1.5",
      provider: "openai",
      modelData: audioMd,
      apiKey: { openAi: "test-key" },
      messages: [
        userMessage([
          "describe",
          audioPart({ kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" }),
        ]),
      ],
    } satisfies SmolConfig;

    create.mockReturnValueOnce({ withResponse: async () => syncResponse() });
    const sync = await textSync(config);
    expect(sync.success).toBe(true);
    expect(create.mock.calls[0][0].messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "input_audio", input_audio: { data: "AQID", format: "mp3" } },
    ]);
  });

  describe("mocked audio URL", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("fetches and base64-encodes the bytes; the URL never reaches the request", async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const config: SmolConfig = {
        model: "gpt-audio-1.5",
        provider: "openai",
        modelData: audioMd,
        apiKey: { openAi: "test-key" },
        messages: [
          userMessage([
            "describe",
            audioPart({ kind: "url", url: "https://example.test/clip.wav" }),
          ]),
        ],
      } satisfies SmolConfig;

      create.mockReturnValueOnce({ withResponse: async () => syncResponse() });
      const sync = await textSync(config);
      expect(sync.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const sentContent = create.mock.calls[0][0].messages[0].content;
      expect(sentContent).toEqual([
        { type: "text", text: "describe" },
        { type: "input_audio", input_audio: { data: "AQID", format: "wav" } },
      ]);
      const sentJson = JSON.stringify(sentContent);
      expect(sentJson).not.toContain("example.test");
    });
  });

  it("rejects an invalid/text-only model via textSync with create not called", async () => {
    const config: SmolConfig = {
      model: "gpt-4o-mini",
      provider: "openai",
      apiKey: { openAi: "test-key" },
      messages: [
        userMessage([
          "describe",
          audioPart({ kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" }),
        ]),
      ],
    } satisfies SmolConfig;

    const result = await textSync(config);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected a Failure");
    }
    expect(result.error).toMatch(/does not support audio input/);
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves existing behavior: a wholly unknown model without an explicit provider rejects at client construction", async () => {
    const config: SmolConfig = {
      model: "totally-unknown-model",
      apiKey: { openAi: "test-key" },
      messages: [
        userMessage([
          "describe",
          audioPart({ kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" }),
        ]),
      ],
    } satisfies SmolConfig;

    await expect(textSync(config)).rejects.toThrow(/not recognized/);
    expect(create).not.toHaveBeenCalled();
  });

  it("yields exactly one error chunk and no done for OGG through a consumed textStream, with create not called", async () => {
    const config: SmolConfig = {
      model: "gpt-audio-1.5",
      provider: "openai",
      modelData: audioMd,
      apiKey: { openAi: "test-key" },
      messages: [
        userMessage([
          "describe",
          audioPart({ kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" }),
        ]),
      ],
    } satisfies SmolConfig;

    const chunks = await collectStream(config);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    expect(chunks.find((chunk) => chunk.type === "done")).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  describe("custom text provider vs. the audio provider gate", () => {
    class FakeCustomClient extends BaseClient {
      static syncSpy = vi.fn(async (): Promise<Result<PromptResult>> => success(promptResult({ output: "custom" })));
      static streamSpy = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "done", result: promptResult({ output: "custom" }) };
      });

      async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
        return FakeCustomClient.syncSpy(config);
      }

      async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
        yield* FakeCustomClient.streamSpy(config);
      }
    }

    beforeEach(() => {
      FakeCustomClient.syncSpy.mockClear();
      FakeCustomClient.streamSpy.mockClear();
    });

    afterEach(() => {
      unregisterProvider("custom-text");
      unregisterProvider("custom-text-dup");
    });

    function audioConfig(provider: string): SmolConfig {
      return {
        model: "any-model",
        provider,
        apiKey: { openAi: "test-key" },
        messages: [
          userMessage([
            "describe",
            audioPart({ kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" }),
          ]),
        ],
      } satisfies SmolConfig;
    }

    it("gates an audio message on a custom provider before dispatch, leaving both the custom spies and OpenAI create untouched", async () => {
      registerProvider("custom-text", FakeCustomClient as unknown as typeof BaseClient);

      const result = await textSync(audioConfig("custom-text"));
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("expected a Failure");
      }
      expect(result.error).toMatch(/only supported on the "openai" provider/);
      expect(FakeCustomClient.syncSpy).not.toHaveBeenCalled();
      expect(FakeCustomClient.streamSpy).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("repeats the zero-dispatch assertion when the provider name is re-registered (conflicting duplicate-name case)", async () => {
      class FirstCustomClient extends FakeCustomClient {}
      const firstSyncSpy = vi.fn(async (): Promise<Result<PromptResult>> => success(promptResult({ output: "first" })));
      class SecondCustomClient extends BaseClient {
        async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
          return firstSyncSpy(config);
        }
        async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
          yield* FakeCustomClient.streamSpy(config);
        }
      }

      registerProvider("custom-text-dup", FirstCustomClient as unknown as typeof BaseClient);
      registerProvider("custom-text-dup", SecondCustomClient as unknown as typeof BaseClient);

      const result = await textSync(audioConfig("custom-text-dup"));
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("expected a Failure");
      }
      expect(result.error).toMatch(/only supported on the "openai" provider/);
      expect(firstSyncSpy).not.toHaveBeenCalled();
      expect(FakeCustomClient.syncSpy).not.toHaveBeenCalled();
      expect(FakeCustomClient.streamSpy).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
