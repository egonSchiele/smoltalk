export class BaseMessage {}

export interface MessageClass {
  get content(): string;
  get role(): string;
  get name(): string | undefined;
  get rawData(): any;

  toOpenAIMessage(): { role: string; content: string; name?: string };
  toGoogleMessage(): { author: string; content: string };
}
