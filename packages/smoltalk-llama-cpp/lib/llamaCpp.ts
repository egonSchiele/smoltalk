import { getLlama, LlamaChat, LlamaLogLevel } from "node-llama-cpp";
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
  TokenUsage,
  ToolCall,
  ToolMessage,
  UserMessage,
  getLogger,
  sanitizeAttributes,
  success,
} from "smoltalk";
import type { Message } from "smoltalk";
import path from "path";

export class LlamaCPP extends BaseClient {
  private llama: Awaited<ReturnType<typeof getLlama>> | null = null;
  private llamaModel: Awaited<
    ReturnType<Awaited<ReturnType<typeof getLlama>>["loadModel"]>
  > | null = null;
  private modelDir: string;
  private model: Model;
  private logger: ReturnType<typeof getLogger>;

  constructor(config: SmolConfig) {
    super(config);
    const modelDir = config.metadata?.llamaCppModelDir as string | undefined;
    if (!modelDir) {
      throw new Error(
        "smoltalk-llama-cpp: metadata.llamaCppModelDir is required. " +
          "Pass the directory containing your .gguf models in config.metadata, " +
          'e.g. text({ ..., metadata: { llamaCppModelDir: "./models" } }).',
      );
    }
    this.model = new Model(config.model);
    this.modelDir = modelDir;
    this.logger = getLogger();
  }

  async setup() {
    this.llama = await getLlama({ logLevel: LlamaLogLevel.error });
    this.llamaModel = await this.llama.loadModel({
      modelPath: path.join(this.modelDir, this.config.model),
    });
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
    if (!this.llama || !this.llamaModel) {
      await this.setup();
    }
    const setupLlama = this.llama!;
    const setupModel = this.llamaModel!;

    const { chatHistory } = this.convertMessages(config.messages);

    if (chatHistory.length === 0) {
      return success({
        output: "",
        toolCalls: [],
        model: this.getModelName(),
      });
    }

    // Create grammar for response format
    let grammar;
    if (config.responseFormat) {
      grammar = await setupLlama.createGrammarForJsonSchema(
        config.responseFormat.toJSONSchema() as any,
      );
    }

    // Create context and LlamaChat
    const context = await setupModel.createContext();
    const sequence = context.getSequence();
    const chat = new LlamaChat({
      contextSequence: sequence,
    });

    // Build tools if provided
    const functions = this.buildFunctions(config.tools);

    // Track token usage
    const meterBefore = sequence.tokenMeter.getState();

    // Build options
    const options: Record<string, any> = {};
    if (config.maxTokens !== undefined) {
      options.maxTokens = config.maxTokens;
    }
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
    Object.assign(options, sanitizeAttributes(config.rawAttributes));

    this.logger.debug("Sending request to llama.cpp");
    this.statelogClient?.promptRequest({
      model: this.getModelName(),
      messageCount: config.messages.length,
    } as any);

    let result;
    let meterAfter: TokenMeterState;
    try {
      result = await chat.generateResponse(chatHistory, options);
      meterAfter = sequence.tokenMeter.getState();
    } finally {
      chat.dispose();
      await context.dispose();
    }

    // Extract text output
    const output = result.response || null;

    // Extract tool calls — generateResponse returns them without executing handlers
    const toolCalls = this.extractToolCalls(
      result.functionCalls as
        | LlamaChatResponseFunctionCall<ChatModelFunctions>[]
        | undefined,
    );

    // Calculate usage and cost
    const { usage, cost } = this.calculateUsageAndCost(meterBefore, meterAfter);

    this.logger.debug("Response from llama.cpp:", output);
    this.statelogClient?.promptResponse({ output, usage, cost } as any);

    return success({
      output,
      toolCalls,
      usage,
      cost,
      model: this.getModelName(),
    });
  }

  async *_textStream(config: SmolConfig): AsyncGenerator<StreamChunk> {
    if (!this.llama || !this.llamaModel) {
      await this.setup();
    }
    const setupLlama = this.llama!;
    const setupModel = this.llamaModel!;

    const { chatHistory } = this.convertMessages(config.messages);

    if (chatHistory.length === 0) {
      yield {
        type: "done",
        result: { output: null, toolCalls: [], model: this.getModelName() },
      };
      return;
    }

    // Create grammar for response format
    let grammar;
    if (config.responseFormat) {
      grammar = await setupLlama.createGrammarForJsonSchema(
        config.responseFormat.toJSONSchema() as any,
      );
    }

    // Create context and LlamaChat
    const context = await setupModel.createContext();
    const sequence = context.getSequence();
    const chat = new LlamaChat({
      contextSequence: sequence,
    });

    const functions = this.buildFunctions(config.tools);

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
      onTextChunk: (text: string) => {
        pushChunk({ type: "text", text });
      },
    };
    if (config.maxTokens !== undefined) {
      options.maxTokens = config.maxTokens;
    }
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
    Object.assign(options, sanitizeAttributes(config.rawAttributes));

    this.logger.debug("Sending streaming request to llama.cpp");
    this.statelogClient?.promptRequest({
      model: this.getModelName(),
      messageCount: config.messages.length,
    } as any);

    // Run generateResponse in background, push chunks as they arrive
    const promptPromise = chat
      .generateResponse(chatHistory, options)
      .then((result) => {
        const meterAfter = sequence.tokenMeter.getState();

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

        this.logger.debug("Streaming response completed from llama.cpp");
        this.statelogClient?.promptResponse({ output, usage, cost } as any);

        pushChunk({
          type: "done",
          result: {
            output,
            toolCalls,
            usage,
            cost,
            model: this.getModelName(),
          },
        });
      })
      .catch((error) => {
        pushChunk({ type: "error", error: (error as Error).message });
      })
      .finally(() => {
        done = true;
        chat.dispose();
        context.dispose();
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

    await promptPromise;
  }
}
