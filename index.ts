import { color } from "termcolors";
import { z } from "zod";
import {
  assistantMessage,
  Message,
  toolMessage,
  userMessage,
} from "./lib/classes/message/index.js";
import { getClient } from "./lib/client.js";

function add({ a, b }: { a: number; b: number }): number {
  return a + b;
}

// Define the function tool for OpenAI
const addTool = {
  type: "function" as const,
  function: {
    name: "add",
    description: "Adds two numbers together and returns the result.",
    parameters: {
      type: "object",
      properties: {
        a: {
          type: "number",
          description: "The first number to add",
        },
        b: {
          type: "number",
          description: "The second number to add",
        },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
  },
};

const client = getClient({
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "debug",
  model: "gpt-4o-mini",
});

const responseFormat = z.object({
  result: z.number(),
});

async function main() {
  let messages: Message[] = [];
  messages.push(
    userMessage(
      "Please use the add function to add the following numbers: 3 and 5"
    )
  );
  const resp = await client.text({
    messages,
    tools: [addTool],
    /*     responseFormat
     */ // Try without toolConfig to test basic function calling
  });
  console.log(color.green("--------------- Response ---------------"));
  console.log(JSON.stringify(resp, null, 2));

  if (resp.success && resp.value.toolCalls.length > 0) {
    const toolCall = resp.value.toolCalls[0];
    messages.push(assistantMessage(null, { toolCalls: [toolCall] }));
    if (toolCall.name === "add") {
      const result = JSON.stringify(add(toolCall.arguments as any));
      console.log(color.green("Function call result:"), result);
      messages.push(
        toolMessage(result, { tool_call_id: toolCall.id, name: toolCall.name })
      );
      const followupResp = await client.text({
        messages,
        //tools: [addTool],
        responseFormat,
      });
      console.log(
        color.green("Follow-up response:"),
        JSON.stringify(followupResp, null, 2)
      );
    }
  }
}

main();
