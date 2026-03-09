import { color } from "termcolors";
import { z } from "zod";
import {
  assistantMessage,
  Message,
  messageFromJSON,
  toolMessage,
  userMessage,
} from "./lib/classes/message/index.js";
import { text } from "./lib/functions.js";
import { Model } from "./lib/model.js";
import { fallback, id, race, StrategyJSON } from "./lib/strategies/index.js";

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

const responseFormat = z.object({
  result: z.number(),
});

const model1 = new Model("gemini-2.5-flash");
const model2 = new Model("gemini-2.5-flash-lite");

// const strategy = race("gemini-2.5-flash", "gemini-2.5-flash-lite");
const strategy: StrategyJSON = {
  type: "race",
  params: {
    strategies: [
      {
        type: "fallback",
        params: {
          strategies: ["gemini-2.5-flash-lite", "gemini-2.5-pro"],
          config: {
            fallbackOn: ["error"],
          },
        },
      },
      {
        type: "fallback",
        params: {
          strategies: ["gpt-4o-mini", "gpt-4o"],
          config: {
            fallbackOn: ["error"],
          },
        },
      },
    ],
  },
};

async function main() {
  let messages: Message[] = [];
  messages.push(userMessage("Write me a 10 word fairy tale."));
  const resp = await text({
    messages,
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    googleApiKey: process.env.GEMINI_API_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    logLevel: "debug",
    model: strategy,
    hooks: {
      onStrategyStart: (strategy, config) => {
        console.log(
          color.blue(
            `Starting strategy ${strategy} with model ${config.model} and provider ${config.provider}`,
          ),
        );
      },
    },
    // provider: "openai-responses",
  });
  console.log(color.green("--------------- Response ---------------"));
  console.log(resp);

  /*   for await (const chunk of resp) {
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
  } */
}

main();
