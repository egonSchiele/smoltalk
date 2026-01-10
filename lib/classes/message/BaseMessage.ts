import { Content, ContentListUnion } from "@google/genai";
import { ChatCompletionMessageParam } from "openai/resources";

export class BaseMessage {}

export interface MessageClass {
  get content(): string;
  get role(): string;
  get name(): string | undefined;
  get rawData(): any;

  toOpenAIMessage(): ChatCompletionMessageParam;
  toGoogleMessage(): Content;
  toJSON(): Record<string, any>;
}
