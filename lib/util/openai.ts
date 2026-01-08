import {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageToolCall,
} from "openai/resources";
import { ToolCall } from "../types.js";

export function openAIToToolCall(
  toolCall: ChatCompletionMessageFunctionToolCall
): ToolCall {
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: JSON.parse(toolCall.function.arguments),
  };
}

export function isFunctionToolCall(
  message: ChatCompletionMessageToolCall
): message is ChatCompletionMessageFunctionToolCall {
  return message.type === "function";
}
