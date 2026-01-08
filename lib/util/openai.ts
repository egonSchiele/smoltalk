import {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageToolCall,
} from "openai/resources";

export function isFunctionToolCall(
  message: ChatCompletionMessageToolCall
): message is ChatCompletionMessageFunctionToolCall {
  return message.type === "function";
}
