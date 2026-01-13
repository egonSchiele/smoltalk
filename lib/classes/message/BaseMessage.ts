import { Content, ContentListUnion } from "@google/genai";
import { Message } from "ollama";
import { ChatCompletionMessageParam } from "openai/resources";

export class BaseMessage {}

export interface MessageClass {
  get content(): string;
  get role(): string;
  get name(): string | undefined;
  get rawData(): any;

  toOpenAIMessage(): ChatCompletionMessageParam;
  toGoogleMessage(): Content;
  toOllamaMessage(): Message;
  toJSON(): Record<string, any>;
}
