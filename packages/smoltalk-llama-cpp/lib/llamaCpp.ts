import { LlamaChat } from "node-llama-cpp";
import type {
  ChatHistoryItem,
  ChatModelFunctions,
  ChatModelFunctionCall,
  TokenMeterState,
  LlamaChatResponseFunctionCall,
} from "node-llama-cpp";
import {
  AssistantMessage,
  BaseClient,
  CostEstimate,
  Model,
  ModelName,
  PromptResult,
  Result,
  SmolConfig,
  StreamChunk,
  ThinkingBlock,
  TokenUsage,
  ToolCall,
  ToolMessage,
  UserMessage,
  failure,
  getLogger,
  sanitizeAttributes,
  success,
} from "smoltalk";
import type { Message } from "smoltalk";
import { acquireModelEntry } from "./nativeRegistry.js";

/**
 * Two-plus characters before the colon, so Windows drive-letter paths
 * (C:\models\x.gguf) are classified as paths, not URIs.
 */
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

/**
 * Backstop when the caller sets no maxTokens. Local thinking models
 * (Qwen3, DeepSeek-R1) burn thousands of hidden reasoning tokens per answer
 * (~6.6k measured for a 100-word story) and, given a degenerate prompt, can
 * spiral without terminating — unbounded, one such call generated 169k tokens
 * over 100 minutes before an external timeout killed it. 16384 clears normal
 * reasoning several times over while bounding a runaway to minutes. An
 * explicit `maxTokens` or a `rawAttributes.maxTokens` always wins.
 */
const DEFAULT_MAX_TOKENS = 16384;

/**
 * Merge sanitized rawAttributes over the built options, skipping keys whose
 * value is `undefined`. sanitizeAttributes preserves present-but-undefined
 * keys, so a plain Object.assign would let `rawAttributes: { maxTokens:
 * undefined }` silently clobber the default cap back to unbounded. Only a
 * DEFINED raw attribute is an override.
 */
function applyRawAttributes(
  options: Record<string, any>,
  rawAttributes: SmolConfig["rawAttributes"],
): void {
  const raw = sanitizeAttributes(rawAttributes);
  for (const key of Object.keys(raw)) {
    if (raw[key] !== undefined) {
      options[key] = raw[key];
    }
  }
}

/**
 * Collect thought segments (hidden reasoning on thinking models like Qwen3 /
 * DeepSeek-R1) from `result.fullResponse` into smoltalk ThinkingBlocks.
 * `result.response` deliberately excludes them, so without this mapping the
 * reasoning — often the majority of the generated tokens — is invisible to
 * callers. llama.cpp has no signed reasoning, so `signature` is always `""`
 * (the same convention the google client uses when no signature is present).
 */
function extractThinkingBlocks(
  fullResponse: Array<string | Record<string, any>> | undefined,
): ThinkingBlock[] {
  const blocks: ThinkingBlock[] = [];
  for (const part of fullResponse ?? []) {
    if (
      typeof part !== "string" &&
      part.type === "segment" &&
      part.segmentType === "thought" &&
      part.text
    ) {
      blocks.push({ text: part.text, signature: "" });
    }
  }
  return blocks;
}

export class LlamaCPP extends BaseClient {
  private modelDir: string;
  private modelFile: string;
  private model: Model;
  private logger: ReturnType<typeof getLogger>;
  /** Optional exact context size (`metadata.llamaCppContextSize`), overriding
   *  the registry's default 32k cap for hardware where a larger KV cache is
   *  worth its memory. First call per model wins (see acquireModelEntry). */
  private contextSize: number | undefined;

  constructor(config: SmolConfig) {
    super(config);
    let modelDir = config.metadata?.llamaCppModelDir as string | undefined;
    let modelFile = config.model;
    this.contextSize = config.metadata?.llamaCppContextSize as
      | number
      | undefined;

    // Explicit metadata wins: when llamaCppModelDir is present, config.model
    // is used as-is and no classification happens at all.
    if (!modelDir) {
      if (URI_SCHEME.test(modelFile)) {
        throw new Error(
          `smoltalk-llama-cpp: llama-cpp needs a local .gguf path. ` +
            `To download or resolve "${modelFile}", call resolveModel() first ` +
            `and pass its result as the model.`,
        );
      }
      // Manual split (not path.dirname/basename) so \-separated paths split
      // identically on every platform — POSIX path.basename won't split on \.
      const sepIndex = Math.max(
        modelFile.lastIndexOf("/"),
        modelFile.lastIndexOf("\\"),
      );
      if (sepIndex !== -1) {
        modelDir = modelFile.slice(0, sepIndex);
        if (modelDir === "") {
          modelDir = "/";
        }
        // A bare drive prefix ("C:" from "C:\model.gguf") is drive-relative;
        // keep the separator so joining yields C:\model.gguf, not C:model.gguf.
        if (/^[A-Za-z]:$/.test(modelDir)) {
          modelDir = modelDir + "\\";
        }
        modelFile = modelFile.slice(sepIndex + 1);
      }
    }

    if (!modelDir) {
      throw new Error(
        "smoltalk-llama-cpp: metadata.llamaCppModelDir is required. " +
          "Pass the directory containing your .gguf models in config.metadata, " +
          'e.g. text({ ..., metadata: { llamaCppModelDir: "./models" } }), ' +
          "or pass a full .gguf path as the model.",
      );
    }
    this.model = new Model(modelFile);
    this.modelDir = modelDir;
    this.modelFile = modelFile;
    this.logger = getLogger();
  }

  /**
   * Warm the shared native state for this model (load + context allocation).
   * Optional — the generation paths load lazily on first use — but callers can
   * pay the cost up front. The context is created once and reused; it is never
   * torn down here (see nativeRegistry.ts / bug.md).
   */
  async setup() {
    await acquireModelEntry(this.modelDir, this.modelFile, this.contextSize);
  }

  private getModelName(): ModelName {
    return this.model.getModel();
  }

  /**
   * Converts smoltalk messages to node-llama-cpp's ChatHistoryItem format.
   * Builds the full history including the last user message (LlamaChat.generateResponse
   * expects the complete history, unlike LlamaChatSession which takes the last message separately).
   */
  private convertMessages(messages: Message[]): {
    systemPrompt?: string;
    chatHistory: ChatHistoryItem[];
  } {
    let systemPrompt: string | undefined;
    const chatHistory: ChatHistoryItem[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === "system" || msg.role === "developer") {
        if (!systemPrompt) {
          systemPrompt = msg.content;
        } else {
          systemPrompt += "\n" + msg.content;
        }
      } else if (msg.role === "user") {
        if (msg instanceof UserMessage && msg.getContentParts() !== null) {
          const hasAttachment = msg
            .getContentParts()!
            .some((part) => part.type === "image" || part.type === "file");
          if (hasAttachment) {
            getLogger().warn(
              "node-llama-cpp does not support image/file attachments; dropping them and sending text only.",
            );
          }
        }
        chatHistory.push({ type: "user", text: msg.content });
      } else if (msg.role === "assistant") {
        const assistantMsg = msg as AssistantMessage;
        const response: (string | ChatModelFunctionCall)[] = [];

        if (assistantMsg.content) {
          response.push(assistantMsg.content);
        }

        // Handle tool calls: pair them with their results from subsequent tool messages
        if (assistantMsg.toolCalls?.length) {
          for (const tc of assistantMsg.toolCalls) {
            // Find the corresponding tool result message
            const toolResultMsg = messages
              .slice(i + 1)
              .find(
                (m) =>
                  m.role === "tool" &&
                  (m as ToolMessage).tool_call_id === tc.id,
              ) as ToolMessage | undefined;

            response.push({
              type: "functionCall",
              name: tc.name,
              params: tc.arguments,
              result: toolResultMsg ? toolResultMsg.content : undefined,
            } as ChatModelFunctionCall);
          }
        }

        chatHistory.push({ type: "model", response });
      }
      // Tool messages are handled as part of assistant messages above
    }

    // Prepend system message if present
    if (systemPrompt) {
      chatHistory.unshift({ type: "system", text: systemPrompt });
    }

    return { systemPrompt, chatHistory };
  }

  /**
   * Builds node-llama-cpp function definitions from smoltalk tool configs.
   * Uses ChatModelFunctions (no handler) — LlamaChat.generateResponse() returns
   * function calls without executing them, which matches smoltalk's tool loop model.
   */
  private buildFunctions(
    tools: SmolConfig["tools"],
  ): ChatModelFunctions | undefined {
    if (!tools) return undefined;
    const functions: Record<string, { description?: string; params?: any }> =
      {};

    for (const tool of tools) {
      const jsonSchema = tool.schema.toJSONSchema();
      functions[tool.name] = {
        description: tool.description,
        params: jsonSchema as any,
      };
    }

    return functions as ChatModelFunctions;
  }

  private calculateUsageAndCost(
    meterBefore: TokenMeterState,
    meterAfter: TokenMeterState,
  ): {
    usage?: TokenUsage;
    cost?: CostEstimate;
  } {
    const inputTokens =
      meterAfter.usedInputTokens - meterBefore.usedInputTokens;
    const outputTokens =
      meterAfter.usedOutputTokens - meterBefore.usedOutputTokens;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    const cost = this.model.calculateCost(usage) ?? undefined;

    return { usage, cost };
  }

  private extractToolCalls(
    functionCalls:
      | LlamaChatResponseFunctionCall<ChatModelFunctions>[]
      | undefined,
  ): ToolCall[] {
    if (!functionCalls?.length) return [];
    return functionCalls.map(
      (fc) =>
        new ToolCall(
          fc.functionName,
          fc.functionName,
          (fc.params ?? {}) as Record<string, any>,
        ),
    );
  }

  async _textSync(config: SmolConfig): Promise<Result<PromptResult>> {
    const { chatHistory } = this.convertMessages(config.messages);

    if (chatHistory.length === 0) {
      return success({
        output: "",
        toolCalls: [],
        model: this.getModelName(),
      });
    }

    // Long-lived, shared native state for this model. The context/sequence are
    // created once and reused — never disposed here (bug.md: per-call context
    // disposal races the checkpoint worker => SIGSEGV on SWA models).
    const entry = await acquireModelEntry(this.modelDir, this.modelFile, this.contextSize);

    // Create grammar for response format (independent of the sequence, so it's
    // fine outside the lock).
    let grammar;
    if (config.responseFormat) {
      grammar = await entry.llama.createGrammarForJsonSchema(
        config.responseFormat.toJSONSchema() as any,
      );
    }

    // Build tools if provided
    const functions = this.buildFunctions(config.tools);

    // Build options
    const options: Record<string, any> = {};
    options.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    if (config.temperature !== undefined) {
      options.temperature = config.temperature;
    }
    if (config.abortSignal) {
      options.signal = config.abortSignal;
      options.stopOnAbortSignal = true;
    }
    if (grammar && !functions) {
      options.grammar = grammar;
    }
    if (functions) {
      options.functions = functions;
    }

    // Apply raw attributes
    applyRawAttributes(options, config.rawAttributes);

    this.logger.debug("Sending request to llama.cpp");
    this.statelogClient?.promptRequest({
      model: this.getModelName(),
      messageCount: config.messages.length,
    } as any);

    // Serialize generation on the shared sequence. Token-meter reads must be
    // inside the lock so deltas are attributable to this call.
    const { result, usage, cost } = await entry.lock.runExclusive(async () => {
      const chat = new LlamaChat({ contextSequence: entry.sequence });
      const meterBefore = entry.sequence.tokenMeter.getState();
      let genResult;
      let meterAfter: TokenMeterState;
      try {
        genResult = await chat.generateResponse(chatHistory, options);
        meterAfter = entry.sequence.tokenMeter.getState();
      } finally {
        // Both cleanup steps are best-effort: neither may mask the generation
        // result or its error. The lock is released by runExclusive regardless.
        try {
          chat.dispose();
        } catch (error) {
          this.logger.warn(
            "llama.cpp: chat.dispose after generation failed:",
            (error as Error).message,
          );
        }
        // Reset KV state for the next call AND drain pending checkpoint work
        // under the context lock before the next call reuses the sequence.
        try {
          await entry.sequence.clearHistory();
        } catch (error) {
          this.logger.warn(
            "llama.cpp: clearHistory after generation failed:",
            (error as Error).message,
          );
        }
      }
      const { usage: u, cost: c } = this.calculateUsageAndCost(
        meterBefore,
        meterAfter,
      );
      return { result: genResult, usage: u, cost: c };
    });

    // An aborted generation must be a failure, never a success.
    // `stopOnAbortSignal` makes generateResponse RESOLVE with the partial
    // response on abort (a response still inside its thinking segment drains
    // to empty), so without this check a cancelled or timed-out call would
    // surface as `success(output: null)` — callers record a null assistant
    // turn and their timeout/retry handling never engages. The partial output
    // is truncated garbage either way; usage is still reported to statelog so
    // the spend stays visible. Checked on `options.signal` — the signal
    // generation actually listened to — not config.abortSignal, which
    // rawAttributes may have replaced.
    if ((options.signal as AbortSignal | undefined)?.aborted) {
      this.logger.debug("llama.cpp generation aborted");
      this.statelogClient?.promptResponse({ output: null, usage, cost } as any);
      return failure("Request was aborted");
    }

    // Extract text output
    const output = result.response || null;

    // Extract tool calls — generateResponse returns them without executing handlers
    const toolCalls = this.extractToolCalls(
      result.functionCalls as
        | LlamaChatResponseFunctionCall<ChatModelFunctions>[]
        | undefined,
    );

    const thinkingBlocks = extractThinkingBlocks(result.fullResponse);

    this.logger.debug("Response from llama.cpp:", output);
    this.statelogClient?.promptResponse({ output, usage, cost } as any);

    return success({
      output,
      toolCalls,
      ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
      usage,
      cost,
      model: this.getModelName(),
    });
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    const { chatHistory } = this.convertMessages(config.messages);

    if (chatHistory.length === 0) {
      yield {
        type: "done",
        result: { output: null, toolCalls: [], model: this.getModelName() },
      };
      return;
    }

    // Long-lived, shared native state for this model (see _textSync).
    const entry = await acquireModelEntry(this.modelDir, this.modelFile, this.contextSize);

    // Create grammar for response format
    let grammar;
    if (config.responseFormat) {
      grammar = await entry.llama.createGrammarForJsonSchema(
        config.responseFormat.toJSONSchema() as any,
      );
    }

    const functions = this.buildFunctions(config.tools);

    // Serialize the whole stream on the shared sequence: hold the per-model
    // lock from before generation until the stream is fully drained. Released
    // in the finally below even on error/abort so the lock never wedges.
    const release = await entry.lock.acquire();
    let promptPromise: Promise<void> | undefined;
    try {
      const sequence = entry.sequence;
      const chat = new LlamaChat({ contextSequence: sequence });
      const meterBefore = sequence.tokenMeter.getState();

      // Bridge callback-based streaming to async generator using a queue
      const chunks: StreamChunk[] = [];
      let resolveWaiter: (() => void) | null = null;
      let done = false;

      const pushChunk = (chunk: StreamChunk) => {
        chunks.push(chunk);
        if (resolveWaiter) {
          resolveWaiter();
          resolveWaiter = null;
        }
      };

      // Build options
      const options: Record<string, any> = {
        // onTextChunk streams ONLY main-response text (no segments), so the
        // two callbacks never deliver the same content twice: thought
        // segments arrive exclusively via onResponseChunk below.
        onTextChunk: (text: string) => {
          pushChunk({ type: "text", text });
        },
        onResponseChunk: (chunk: Record<string, any>) => {
          if (
            chunk.type === "segment" &&
            chunk.segmentType === "thought" &&
            chunk.text
          ) {
            pushChunk({ type: "thinking", text: chunk.text });
          }
        },
      };
      options.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
      if (config.temperature !== undefined) {
        options.temperature = config.temperature;
      }
      if (config.abortSignal) {
        options.signal = config.abortSignal;
        options.stopOnAbortSignal = true;
      }
      if (grammar && !functions) {
        options.grammar = grammar;
      }
      if (functions) {
        options.functions = functions;
      }
      applyRawAttributes(options, config.rawAttributes);

      this.logger.debug("Sending streaming request to llama.cpp");
      this.statelogClient?.promptRequest({
        model: this.getModelName(),
        messageCount: config.messages.length,
      } as any);

      // Run generateResponse in background, push chunks as they arrive
      promptPromise = chat
        .generateResponse(chatHistory, options)
        .then((result) => {
          const meterAfter = sequence.tokenMeter.getState();

          // Same contract as _textSync: an aborted generation ends the stream
          // with an error chunk, never a done chunk — `stopOnAbortSignal`
          // resolves the truncated partial instead of rejecting, and passing
          // that on as `done` would let a cancelled call masquerade as a
          // completed one. Checked on `options.signal` (the effective signal;
          // rawAttributes may have replaced config.abortSignal).
          if ((options.signal as AbortSignal | undefined)?.aborted) {
            const { usage, cost } = this.calculateUsageAndCost(
              meterBefore,
              meterAfter,
            );
            this.logger.debug("llama.cpp streaming generation aborted");
            this.statelogClient?.promptResponse({
              output: null,
              usage,
              cost,
            } as any);
            pushChunk({ type: "error", error: "Request was aborted" });
            return;
          }

          const toolCalls = this.extractToolCalls(
            result.functionCalls as
              | LlamaChatResponseFunctionCall<ChatModelFunctions>[]
              | undefined,
          );
          for (const tc of toolCalls) {
            pushChunk({ type: "tool_call", toolCall: tc });
          }

          const { usage, cost } = this.calculateUsageAndCost(
            meterBefore,
            meterAfter,
          );
          const output = result.response || null;
          const thinkingBlocks = extractThinkingBlocks(result.fullResponse);

          this.logger.debug("Streaming response completed from llama.cpp");
          this.statelogClient?.promptResponse({ output, usage, cost } as any);

          pushChunk({
            type: "done",
            result: {
              output,
              toolCalls,
              ...(thinkingBlocks.length > 0 && { thinkingBlocks }),
              usage,
              cost,
              model: this.getModelName(),
            },
          });
        })
        .catch((error) => {
          pushChunk({ type: "error", error: (error as Error).message });
        })
        .finally(async () => {
          // Every cleanup step is guarded: a throw here would both wedge the
          // per-model lock (release() is skipped below) and hang the generator
          // (done/wake never run). Cleanup must always complete.
          try {
            chat.dispose();
          } catch (error) {
            this.logger.warn(
              "llama.cpp: chat.dispose after stream failed:",
              (error as Error).message,
            );
          }
          // Reset KV state and drain pending checkpoint work under the context
          // lock. NEVER context.dispose() here — that is the SIGSEGV (bug.md).
          try {
            await sequence.clearHistory();
          } catch (error) {
            this.logger.warn(
              "llama.cpp: clearHistory after stream failed:",
              (error as Error).message,
            );
          }
          done = true;
          // Wake up the generator if it's waiting
          if (resolveWaiter) {
            resolveWaiter();
            resolveWaiter = null;
          }
        });

      // Yield chunks as they arrive
      while (!done || chunks.length > 0) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
        }
      }
    } finally {
      // Wait for generation (and its clearHistory drain) to fully settle before
      // releasing the lock — even if the consumer broke out of the loop early —
      // so the next queued call never runs concurrently on the shared sequence.
      // The .catch guarantees release() always runs: a wedged per-model lock
      // would hang every later call to this model for the process lifetime.
      if (promptPromise) {
        await promptPromise.catch(() => {});
      }
      release();
    }
  }
}
