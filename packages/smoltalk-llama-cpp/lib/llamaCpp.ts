import {
  DeepSeekChatWrapper,
  Gemma4ChatWrapper,
  LlamaChat,
  LlamaText,
  QwenChatWrapper,
  SeedChatWrapper,
  isLlamaText,
  resolveChatWrapper,
} from "node-llama-cpp";
import type {
  ChatHistoryItem,
  ChatWrapper,
  ChatModelFunctions,
  ChatModelFunctionCall,
  TokenMeterState,
  LlamaChatResponseFunctionCall,
  LlamaGrammar,
  Token,
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
import path from "path";
import {
  acquireModelEntry,
  type DraftOptions,
  type ModelEntry,
} from "./nativeRegistry.js";
import { thinkingGrammar } from "./thinkingGrammar.js";

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
 * What a call asked about thinking, in one place. `on` and `off` are
 * `thinking.enabled`; both false when the call did not say. `budget` is the
 * most tokens the model may think for: the call's own `budgetTokens`, else
 * the budget the google client gives a `reasoningEffort`. Undefined leaves
 * node-llama-cpp's own default, three quarters of the context.
 */
type ThinkingChoice = {
  on: boolean;
  off: boolean;
  budget: number | undefined;
  effort: SmolConfig["reasoningEffort"];
};

/** Tokens of thinking for each effort, the google client's map. */
const EFFORT_BUDGETS = { low: 2048, medium: 8192, high: 16384 } as const;

/**
 * Tokens kept free for the answer after the thinking. A budget that meets
 * `maxTokens` lets the model think for the whole reply and answer with
 * nothing, so the budget is held this far under the cap, or the cap raised
 * this far over the budget when the call set none.
 */
const ANSWER_HEADROOM = 4096;

function thinkingChoice(config: SmolConfig): ThinkingChoice {
  const on = config.thinking?.enabled === true;
  const off = config.thinking?.enabled === false;
  const effort = config.reasoningEffort;
  let budget = config.thinking?.budgetTokens;
  if (budget === undefined && effort !== undefined) {
    budget = EFFORT_BUDGETS[effort];
  }
  return { on, off, budget, effort };
}

/**
 * The settings that tell a chat wrapper about the choice. Each wrapper
 * spells it its own way: Qwen and Gemma 4 have a switch, Seed has a budget,
 * and Harmony (gpt-oss) only takes an effort, so "off" is its lowest effort.
 * DeepSeek always thinks; the budget below is what bounds it. The settings
 * name every wrapper, and node-llama-cpp reads the one it picks for the
 * model. Undefined when the call said nothing, so the default wrapper
 * applies.
 */
function wrapperSettingsFor(choice: ThinkingChoice) {
  if (choice.off) {
    return {
      qwen: { thoughts: "discourage" as const },
      gemma4: { reasoning: false },
      seed: { thinkingBudget: 0 },
      harmony: { reasoningEffort: "low" as const },
    };
  }
  const harmony =
    choice.effort === undefined ? {} : { harmony: { reasoningEffort: choice.effort } };
  if (choice.on) {
    // Asked for: a wrapper whose detected default leaves thinking to the
    // model is told to open the block.
    return {
      qwen: { thoughts: "auto" as const },
      gemma4: { reasoning: true },
      ...(choice.budget === undefined ? {} : { seed: { thinkingBudget: choice.budget } }),
      ...harmony,
    };
  }
  if (choice.effort !== undefined) {
    return harmony;
  }
  return undefined;
}

/**
 * The wrapper the chat and the grammar both use. `"auto"` is LlamaChat's own
 * default, kept when the call said nothing about thinking, so the model's
 * usual wrapper applies. The two have to agree: a grammar built for a
 * wrapper that opens a thought block on every reply is wrong for one that
 * has been told not to.
 *
 * Resolving a wrapper renders the model's chat template against every
 * candidate, which is slow, so each setting's wrapper is kept on the model
 * entry. A wrapper holds no conversation state, so sharing one is safe.
 */
function chatWrapperFor(
  entry: ModelEntry,
  choice: ThinkingChoice,
): "auto" | ChatWrapper {
  const settings = wrapperSettingsFor(choice);
  if (settings === undefined) {
    return "auto";
  }
  const key = JSON.stringify(settings);
  let wrapper = entry.wrappers[key];
  if (wrapper === undefined) {
    wrapper = resolveChatWrapper(entry.model, { customWrapperSettings: settings });
    entry.wrappers[key] = wrapper;
  }
  return wrapper;
}

/**
 * The generation options that bound thinking. A budget of 0 when thinking
 * is off, so a wrapper with no switch (DeepSeek) closes its thought block
 * at once; the call's budget otherwise; and an empty `budgets` when the call
 * said nothing, which is what makes LlamaChat apply its own default at all.
 * node-llama-cpp closes the block for the model when the budget runs out,
 * so the answer still follows.
 *
 * The budget and `maxTokens` come out of one pool. When the call set no
 * cap, the cap grows to leave room for the answer; when it set one, the
 * budget shrinks to fit under it.
 */
function applyThinking(
  options: Record<string, any>,
  choice: ThinkingChoice,
  capWasSet: boolean,
  logger: ReturnType<typeof getLogger>,
): void {
  if (choice.off) {
    options.budgets = { thoughtTokens: 0 };
    return;
  }
  if (choice.budget === undefined) {
    options.budgets = {};
    return;
  }
  let budget = choice.budget;
  if (!capWasSet && options.maxTokens < budget + ANSWER_HEADROOM) {
    options.maxTokens = budget + ANSWER_HEADROOM;
  } else if (options.maxTokens < budget + ANSWER_HEADROOM) {
    budget = Math.max(0, options.maxTokens - ANSWER_HEADROOM);
    logger.warn(
      `llama.cpp: thinking budget of ${choice.budget} tokens leaves no room for the answer ` +
        `under maxTokens ${options.maxTokens}; using ${budget}.`,
    );
  }
  options.budgets = { thoughtTokens: budget };
}

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

/** A marker's text without the newlines the wrappers pad it with. */
function markerText(marker: string | LlamaText): string {
  return LlamaText(marker).toString().trim();
}

/** Whether one token spells a whole tag that starts the marker, such as
 *  `</think>` or `<|channel>`. */
function isTagToken(entry: ModelEntry, token: number, marker: string): boolean {
  const text = entry.model.detokenize([token as Token], true);
  return text.startsWith("<") && text.endsWith(">") && marker.startsWith(text);
}

/** The grammar for a typed reply: the schema alone, or the schema after a
 *  thought block for a wrapper whose reply is laid out that way (see
 *  thinkingGrammar.ts). The wrapper resolved here is the one `LlamaChat`
 *  picks for the same model, so the grammar and the chat agree on how the
 *  block is spelled. Its token ids come from the wrapper's own prefix and
 *  suffix, and each has to be one token that spells a whole tag: a marker
 *  the tokenizer splits into pieces would leave the grammar treating the
 *  last piece, say `>`, as the end of the block wherever the model wrote
 *  it. (node-llama-cpp's `isSpecialToken` is no use here: Qwen's `</think>`
 *  is an added token, not a control token, and it reports false.) */
async function grammarForReply(
  entry: ModelEntry,
  schema: object,
  chatWrapper: "auto" | ChatWrapper,
): Promise<LlamaGrammar> {
  const jsonGrammar = await entry.llama.createGrammarForJsonSchema(
    schema as any,
  );
  // The wrappers whose reply is one thought block, then the answer, which
  // is the layout the thinking grammar assumes. Harmony (gpt-oss) and Muse
  // put the answer in a second channel after its own header, so they keep
  // the plain schema grammar, as does the template fallback for an unknown
  // model.
  const blockThenAnswer = [
    QwenChatWrapper,
    DeepSeekChatWrapper,
    SeedChatWrapper,
    Gemma4ChatWrapper,
  ];
  const wrapper =
    chatWrapper === "auto" ? resolveChatWrapper(entry.model) : chatWrapper;
  if (!blockThenAnswer.some((cls) => wrapper instanceof cls)) {
    return jsonGrammar;
  }
  const thought = wrapper.settings.segments?.thought;
  if (thought === undefined || thought.suffix === undefined) {
    return jsonGrammar;
  }
  const closeTokens = LlamaText(thought.suffix).tokenize(entry.model.tokenizer);
  const close = closeTokens[closeTokens.length - 1];
  if (
    close === undefined ||
    !isTagToken(entry, close, markerText(thought.suffix))
  ) {
    return jsonGrammar;
  }
  // The block is already open when the wrapper opens it at the start of
  // every reply, or when its prefix is part of the prompt.
  const openedAlready =
    thought.openOnResponseStart === true ||
    (typeof thought.prefix === "object" && !isLlamaText(thought.prefix));
  let open: number | null = null;
  if (!openedAlready) {
    const openTokens = LlamaText(thought.prefix as string).tokenize(
      entry.model.tokenizer,
    );
    const first = openTokens[0];
    if (
      first === undefined ||
      !isTagToken(entry, first, markerText(thought.prefix as string))
    ) {
      return jsonGrammar;
    }
    open = first as number;
  }
  return entry.llama.createGrammar({
    grammar: thinkingGrammar(jsonGrammar.grammar, close as number, open),
  });
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
  /** Optional path to a smaller model of the same family
   *  (`metadata.llamaCppDraftModel`) that drafts tokens for this one to
   *  verify, which is speculative decoding. First call per model wins, like
   *  the context size. */
  private draftModel: string | undefined;
  /** How much the draft guesses at a time and how sure it must be
   *  (`metadata.llamaCppDraftOptions`), for tuning on the machine. */
  private draftOptions: DraftOptions | undefined;

  constructor(config: SmolConfig) {
    super(config);
    let modelDir = config.metadata?.llamaCppModelDir as string | undefined;
    let modelFile = config.model;
    this.contextSize = config.metadata?.llamaCppContextSize as
      | number
      | undefined;
    this.draftModel = config.metadata?.llamaCppDraftModel as
      | string
      | undefined;
    this.draftOptions = config.metadata?.llamaCppDraftOptions as
      | DraftOptions
      | undefined;
    if (this.draftModel !== undefined && URI_SCHEME.test(this.draftModel)) {
      throw new Error(
        `smoltalk-llama-cpp: llamaCppDraftModel needs a local .gguf path. ` +
          `To download or resolve "${this.draftModel}", call resolveModel() first ` +
          `and pass its result.`,
      );
    }

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
    // A relative draft path is next to the models, like a relative model.
    if (this.draftModel !== undefined && !path.isAbsolute(this.draftModel)) {
      this.draftModel = path.join(this.modelDir, this.draftModel);
    }
  }

  /**
   * Warm the shared native state for this model (load + context allocation).
   * Optional — the generation paths load lazily on first use — but callers can
   * pay the cost up front. The context is created once and reused; it is never
   * torn down here (see nativeRegistry.ts / bug.md).
   */
  async setup() {
    await this.entry();
  }

  private entry(): Promise<ModelEntry> {
    return acquireModelEntry(
      this.modelDir,
      this.modelFile,
      this.contextSize,
      this.draftModel,
      this.draftOptions,
    );
  }

  /** How the draft did on this call, at debug level, since node-llama-cpp
   *  says to measure a predictor before trusting it. */
  private logDraft(entry: ModelEntry): void {
    if (entry.draft === undefined) {
      return;
    }
    const stats = entry.sequence.tokenPredictions;
    this.logger.debug(
      `llama.cpp draft: ${stats.validated} tokens accepted, ${stats.refuted} rejected`,
    );
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
    // An empty list is no tools. It matters: node-llama-cpp cannot apply a
    // grammar and functions together, so a typed call whose caller sends
    // `tools: []` would otherwise lose its grammar.
    if (!tools || tools.length === 0) return undefined;
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
    const entry = await this.entry();

    const thinking = thinkingChoice(config);
    const chatWrapper = chatWrapperFor(entry, thinking);

    // Create grammar for response format (independent of the sequence, so it's
    // fine outside the lock).
    let grammar;
    if (config.responseFormat) {
      grammar = await grammarForReply(
        entry,
        config.responseFormat.toJSONSchema(),
        chatWrapper,
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

    applyThinking(options, thinking, config.maxTokens !== undefined, this.logger);

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
      const chat = new LlamaChat({ contextSequence: entry.sequence, chatWrapper });
      const meterBefore = entry.sequence.tokenMeter.getState();
      let genResult;
      let meterAfter: TokenMeterState;
      try {
        genResult = await chat.generateResponse(chatHistory, options);
        meterAfter = entry.sequence.tokenMeter.getState();
        this.logDraft(entry);
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
    const entry = await this.entry();

    const thinking = thinkingChoice(config);
    const chatWrapper = chatWrapperFor(entry, thinking);

    // Create grammar for response format
    let grammar;
    if (config.responseFormat) {
      grammar = await grammarForReply(
        entry,
        config.responseFormat.toJSONSchema(),
        chatWrapper,
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
      const chat = new LlamaChat({ contextSequence: sequence, chatWrapper });
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
      applyThinking(options, thinking, config.maxTokens !== undefined, this.logger);
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
          this.logDraft(entry);

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
