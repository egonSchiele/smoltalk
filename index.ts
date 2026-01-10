import { FunctionCallingConfigMode, FunctionDeclaration } from "@google/genai";
import { Message, toolMessage, userMessage } from "./lib/classes/message/index.js";
import { getClient } from "./lib/client.js";

const aditify = ({ text }: { text: string }) => {
  return `Adit says: ${text}`;
};

const aditifyDeclaration: FunctionDeclaration = {
  name: "aditify",
  description: "Aditify the given text",
  parametersJsonSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to aditify",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

const client = getClient({
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "debug",
  model: "gemini-2.5-flash",
});

async function main() {
  let messages: Message[] = [];
  messages.push(userMessage("Please aditify the following text: Hello World"));
  const resp = await client.text({
    messages,
    tools: [{ functionDeclarations: [aditifyDeclaration] }],
    // Try without toolConfig to test basic function calling
  });
  console.log(resp);

  if (resp.success && resp.value.toolCalls.length > 0) {
    const toolCall = resp.value.toolCalls[0];
    if (toolCall.name === "aditify") {
      const result = aditify(toolCall.arguments as any);
      console.log("Function call result:", result);
      messages.push(toolMessage(result, { tool_call_id: toolCall.id, name: toolCall.name }));
      const followupResp = await client.text({ messages });
      console.log("Follow-up response:", followupResp);
    }
  }
}

main();
