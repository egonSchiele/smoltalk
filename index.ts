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

const client = getClient({
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "warn",
  model: "gpt-4o-mini",
});

async function main() {
  let messages: Message[] = [];
  messages.push(
    userMessage(
      "Please write me a children's fairy tale that is 300 words or less.",
    ),
  );
  const resp = client.textStream({
    messages,
    //     responseFormat
  });

  const stream = resp;

  for await (const chunk of stream) {
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

  // console.log(color.green("--------------- Response ---------------"));
  // console.log(JSON.stringify(resp, null, 2));
}

main();
