import { z } from "zod";
import { BaseMessage, MessageClass } from "./BaseMessage.js";
import {
  CostEstimate,
  CostEstimateSchema,
  TextPart,
  TextPartSchema,
  ThinkingBlock,
  ThinkingBlockSchema,
  TokenUsage,
  TokenUsageSchema,
} from "../../types.js";
import { ChatCompletionMessageParam } from "openai/resources";
import { Content, Part } from "@google/genai";
import { ToolCall, ToolCallJSON, ToolCallJSONSchema } from "../ToolCall.js";
import { Message } from "ollama";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";

export const AssistantMessageJSONSchema = z.object({
  role: z.literal("assistant"),
  content: z.union([z.string(), z.array(TextPartSchema), z.null()]),
  name: z.string().optional(),
  audio: z.any().optional(),
  refusal: z.string().nullable().optional(),
  toolCalls: z.array(ToolCallJSONSchema).optional(),
  thinkingBlocks: z.array(ThinkingBlockSchema).optional(),
  rawData: z.any().optional(),
  usage: TokenUsageSchema.optional(),
  cost: CostEstimateSchema.optional(),
});

export type AssistantMessageJSON = z.infer<typeof AssistantMessageJSONSchema>;

export class AssistantMessage extends BaseMessage implements MessageClass {
  public _role = "assistant" as const;
  public _content: string | Array<TextPart> | null;
  public _name?: string;
  public _audio?: any | null;
  public _refusal?: string | null;
  public _toolCalls?: ToolCall[];
  public _thinkingBlocks?: ThinkingBlock[];
  public _rawData?: any;
  public _usage?: TokenUsage;
  public _cost?: CostEstimate;

  constructor(
    content: string | Array<TextPart> | null,
    options: {
      name?: string;
      audio?: any | null;
      refusal?: string | null;
      toolCalls?: ToolCall[];
      thinkingBlocks?: ThinkingBlock[];
      rawData?: any;
      usage?: TokenUsage;
      cost?: CostEstimate;
    } = {},
  ) {
    super();
    this._content = content;
    this._name = options.name;
    this._audio = options.audio;
    this._refusal = options.refusal;
    this._toolCalls = options.toolCalls;
    this._thinkingBlocks = options.thinkingBlocks;
    this._rawData = options.rawData;
    this._usage = options.usage;
    this._cost = options.cost;
  }

  get content(): string {
    return this.contentToString(this._content);
  }

  set content(value: string) {
    this._content = value;
  }

  get role() {
    return this._role;
  }

  get name(): string | undefined {
    return this._name;
  }

  get audio(): any | null | undefined {
    return this._audio;
  }

  get refusal(): string | null | undefined {
    return this._refusal;
  }

  get toolCalls(): ToolCall[] | undefined {
    return this._toolCalls;
  }

  get rawData(): any {
    return this._rawData;
  }

  get thinkingBlocks(): ThinkingBlock[] | undefined {
    return this._thinkingBlocks;
  }

  get usage(): TokenUsage | undefined {
    return this._usage;
  }

  get cost(): CostEstimate | undefined {
    return this._cost;
  }

  toJSON(): AssistantMessageJSON {
    return {
      role: this.role,
      content: this._content,
      name: this.name,
      audio: this.audio,
      refusal: this.refusal,
      toolCalls: this.toolCalls?.map((tc) => tc.toJSON()),
      thinkingBlocks: this._thinkingBlocks,
      usage: this._usage,
      cost: this._cost,
    };
  }

  static fromJSON(json: unknown): AssistantMessage {
    const parsed = AssistantMessageJSONSchema.parse(json);
    return new AssistantMessage(parsed.content, {
      name: parsed.name,
      audio: parsed.audio,
      refusal: parsed.refusal,
      toolCalls: parsed.toolCalls?.map((tc) => ToolCall.fromJSON(tc)),
      thinkingBlocks: parsed.thinkingBlocks,
      rawData: parsed.rawData,
      usage: parsed.usage,
      cost: parsed.cost,
    });
  }

  toOpenAIMessage(): ChatCompletionMessageParam {
    return {
      role: this.role,
      content: this.content,
      name: this.name,
      tool_calls: this.toolCalls?.map((tc) => tc.toOpenAI()),
    };
  }

  toOpenAIResponseInputItem(): ResponseInputItem | ResponseInputItem[] {
    const items: ResponseInputItem[] = [];

    // If there's text content, add it as a message
    if (this.content) {
      items.push({
        type: "message",
        role: "assistant",
        content: this.content,
      } as ResponseInputItem);
    }

    if (this.toolCalls) {
      // Add each tool call as a function_call item
      for (const tc of this.toolCalls) {
        items.push(tc.toOpenAIResponseInputItem());
      }
    }

    return items;
  }

  toGoogleMessage(): Content {
    const parts: Part[] = [];
    // Prepend thought parts with their signatures so Gemini can resume reasoning
    if (this._thinkingBlocks) {
      for (const block of this._thinkingBlocks) {
        parts.push({ thought: true, text: block.text, thoughtSignature: block.signature } as any);
      }
    }
    if (this.content) {
      parts.push({ text: this.content });
    }
    if (this.toolCalls) {
      for (const tc of this.toolCalls) {
        parts.push(tc.toGoogle());
      }
    }
    return { role: "model", parts };
  }

  toOllamaMessage(): Message {
    return {
      role: this.role,
      content: this.content,
      tool_calls: this.toolCalls?.map((tc) => tc.toOpenAI()),
    };
  }

  toAnthropicMessage(): {
    role: "assistant";
    content:
      | string
      | Array<
          | { type: "thinking"; thinking: string; signature: string }
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: Record<string, any> }
        >;
  } {
    const hasText =
      this._content !== null &&
      this._content !== undefined &&
      (typeof this._content === "string"
        ? this._content.length > 0
        : this._content.length > 0);
    const hasToolCalls = this._toolCalls && this._toolCalls.length > 0;
    const hasThinking = this._thinkingBlocks && this._thinkingBlocks.length > 0;

    // If only text and no thinking/tool calls, use string shorthand
    if (!hasToolCalls && !hasThinking) {
      return { role: "assistant", content: this.content };
    }

    const blocks: Array<
      | { type: "thinking"; thinking: string; signature: string }
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, any> }
    > = [];

    // Thinking blocks must come first (Anthropic requires this ordering)
    if (hasThinking) {
      for (const block of this._thinkingBlocks ?? []) {
        blocks.push({ type: "thinking", thinking: block.text, signature: block.signature });
      }
    }

    if (hasText) {
      const text =
        typeof this._content === "string"
          ? this._content
          : this._content!.map((p) => p.text).join("");
      if (text) {
        blocks.push({ type: "text", text });
      }
    }

    for (const tc of this._toolCalls ?? []) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
    }

    return { role: "assistant", content: blocks };
  }
}
