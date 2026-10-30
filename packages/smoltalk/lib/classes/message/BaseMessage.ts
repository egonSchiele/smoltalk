import { Content, ContentListUnion } from "@google/genai";
import { Message } from "ollama";
import { ChatCompletionMessageParam } from "openai/resources";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";

/** The text a provider sees for a message's content: a string as is, any
 *  other value as its JSON text, nothing for null. Exported so a consumer
 *  that compares saved messages can apply the same rule. */
export function contentToString(content: unknown): string {
  if (content === null || content === undefined) return "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

export class BaseMessage {
  protected contentToString(content: unknown): string {
    return contentToString(content);
  }
}

export interface MessageClass {
  get content(): string;
  get role(): string;
  get name(): string | undefined;
  get rawData(): any;
  get metadata(): Record<string, unknown> | undefined;

  toOpenAIMessage(): ChatCompletionMessageParam;
  toOpenAIResponseInputItem(): ResponseInputItem | ResponseInputItem[];
  toGoogleMessage(): Content;
  toOllamaMessage(): Message;
  toJSON(): Record<string, any>;
}
