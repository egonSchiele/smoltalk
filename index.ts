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
  apiKey: process.env.OPENAI_API_KEY || "",
  logLevel: "debug",
  model: "gpt-4o-mini",
});

async function main() {
  const resp = await client.text("add 2 + 2", { tools: [addTool] });
  console.log(resp);
}

main();
