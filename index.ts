import { z } from "zod";
import { Message, userMessage } from "./lib/classes/message/index.js";
import { text } from "./lib/functions.js";
import { race, StrategyJSON } from "./lib/strategies/index.js";
import {
  PromptConfig,
  promptResult,
  PromptResult,
  Result,
  success,
} from "./lib/types.js";
import { BaseClient } from "./lib/clients/baseClient.js";
import { registerProvider } from "./lib/client.js";
import { registerTextModel } from "./lib/models.js";

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

class ConsoleLogger extends BaseClient {
  async _textSync(config: PromptConfig): Promise<Result<PromptResult>> {
    return success(promptResult({ output: JSON.stringify(config.messages) }));
  }
}

registerProvider("console-logger", ConsoleLogger);

registerTextModel({
  modelName: "foo",
  provider: "console-logger",
  maxInputTokens: 1000,
  maxOutputTokens: 1000,
});

const strategy: StrategyJSON = {
  type: "race",
  params: {
    strategies: [
      "gemini-2.5-flash-lite",
      {
        type: "fallback",
        params: {
          primaryStrategy: "gemini-3.1-flash-lite-preview",
          config: {
            error: ["gemini-3-flash-preview"],
          },
        },
      },
      {
        type: "fallback",
        params: {
          primaryStrategy: "gpt-4o-mini",
          config: {
            error: ["gpt-4o"],
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
    model: race("gemini-2.5-flash-lite", "foo"),
    hooks: {
      onStrategyStart: (strategy, config) => {
        console.log(
          `Starting strategy ${strategy} with model ${config.model} and provider ${config.provider}`,
        );
      },
    },
    // provider: "openai-responses",
  });
  console.log("--------------- Response ---------------");
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
