import { Content, ContentListUnion } from "@google/genai";
import { Message } from "ollama";
import { ChatCompletionMessageParam } from "openai/resources";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";

export class BaseMessage {}

export interface MessageClass {
  get content(): string;
  get role(): string;
  get name(): string | undefined;
  get rawData(): any;

  toOpenAIMessage(): ChatCompletionMessageParam;
  toOpenAIResponseInputItem(): ResponseInputItem | ResponseInputItem[];
  toGoogleMessage(): Content;
  toOllamaMessage(): Message;
  toJSON(): Record<string, any>;
}
