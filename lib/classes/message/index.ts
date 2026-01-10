import { UserMessage } from "./UserMessage.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { DeveloperMessage } from "./DeveloperMessage.js";
import { SystemMessage } from "./SystemMessage.js";
import { ToolMessage } from "./ToolMessage.js";
import { TextPart } from "../../types.js";

export * from "./AssistantMessage.js";
export * from "./BaseMessage.js";
export * from "./DeveloperMessage.js";
export * from "./SystemMessage.js";
export * from "./ToolMessage.js";
export * from "./UserMessage.js";

export function userMessage(
  content: string,
  options: { name?: string; rawData?: any } = {}
) {
  return new UserMessage(content, options);
}

export function assistantMessage(
  content: string | Array<TextPart> | null,
  options: {
    name?: string;
    audio?: any | null;
    function_call?: any | null;
    refusal?: string | null;
    tool_calls?: Array<any>;
    rawData?: any;
  } = {}
) {
  return new AssistantMessage(content, options);
}

export function developerMessage(
  content: string | Array<TextPart>,
  options: { name?: string; rawData?: any } = {}
) {
  return new DeveloperMessage(content, options);
}

export function systemMessage(
  content: string | Array<TextPart>,
  options: { name?: string; rawData?: any } = {}
) {
  return new SystemMessage(content, options);
}

export function toolMessage(
  content: string | Array<TextPart>,
  options: { tool_call_id: string; rawData?: any; name: string }
) {
  return new ToolMessage(content, options);
}

export type Message =
  | ToolMessage
  | UserMessage
  | AssistantMessage
  | DeveloperMessage
  | SystemMessage;
