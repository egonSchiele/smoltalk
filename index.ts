import { color } from "termcolors";
import { z } from "zod";
import {
  assistantMessage,
  Message,
  messageFromJSON,
  toolMessage,
  userMessage,
} from "./lib/classes/message/index.js";
import { getClient } from "./lib/client.js";

function add({ a, b }: { a: number; b: number }): number {
  return a + b;
}

const addTool = {
  name: "add",
  description: "Adds two numbers together and returns the result.",
  schema: z.object({
    a: z.number().describe("The first number to add"),
    b: z.number().describe("The second number to add"),
  }),
};

const client = getClient({
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "warn",
  model: "gpt-4o-mini",
  provider: "openai-responses",
});

const responseFormat = z.object({
  result: z.number(),
});

async function main() {
  let messages: Message[] = [];
  messages.push(userMessage("Write me a 500 word fairy tale."));
  const resp = client.text({
    messages,
    //tools: [addTool],
    stream: true,
  });
  console.log(color.green("--------------- Response ---------------"));
  console.log(resp);

  for await (const chunk of resp) {
    switch (chunk.type) {
      case "text":
        process.stdout.write(chunk.text); // print tokens as they arrive
        break;
      case "tool_call":
        console.log(
          "\nTool call:",
          chunk.toolCall.name,
          chunk.toolCall.arguments,
        );
        break;
      case "done":
        console.log("\n\nFinal result:", chunk.result);
        break;
    }
  }
}

main();
