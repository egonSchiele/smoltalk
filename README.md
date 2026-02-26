# Smoltalk

Smoltalk is a package that exposes a common interface across different LLM providers. It exists because I think it's important to have an npm package that allows users to try out different kinds of LLMs, and prevents vendor lock-in. Using a different LLM should be as simple as switching out a model name.

## Install

```bash 
pnpm install smoltalk
```

## Quickstart

```typescript
import { getClient } from "smoltalk";

const client = getClient({
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "debug",
  model: "gemini-2.0-flash-lite",
});

async function main() {
  const resp = await client.prompt("Hello, how are you?");
  console.log(resp);
}

main();
```

## Longer tutorial
To use Smoltak, you first create a client:

```ts
import { getClient } from "smoltalk";

const client = getClient({
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "debug",
  model: "gemini-2.0-flash-lite",
});
```

Then you can call different methods on the client. The simplest is `prompt`:

```ts
const resp = await client.prompt("Hello, how are you?");
```

If you want tool calling, structured output, etc., `text` may be a cleaner option:

```ts
let messages: Message[] = [];
  messages.push(
    userMessage(
      "Please use the add function to add the following numbers: 3 and 5"
    )
  );
  const resp = await client.text({
    messages,
  });
```

Here is an example with tool calling:

```ts
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

const resp = await client.text({
  messages,
  tools: [addTool]
});

```

Here is an example with structured output:

```ts
const resp = await client.text({
  messages,
  responseFormat: z.object({
    result: z.number(),
  });
});
```

A couple of design decisions to note:
- You specify different API keys using different parameter names. This means you could set a couple of different API keys and then be able to change the model name without worrying about the keys, which makes things easier for code generation.
- The schema for tools and structured outputs is defined using Zod.
- Parameter names are camel case, as that is the naming convention in TypeScript. They are converted to snake case for you if required by the APIs.

## Configuration Options

`SmolPromptConfig` is the union of client config (`SmolConfig`) and per-request config (`PromptConfig`). You can pass all options together to `text()`, or split them between `getClient()` and individual calls.

### Client options (`SmolConfig`)

| Option | Type | Description |
|--------|------|-------------|
| `model` | `ModelName \| ModelConfig` | **Required.** The model to use (e.g. `"gpt-4o"`, `"gemini-2.0-flash-lite"`). |
| `openAiApiKey` | `string` | OpenAI API key. |
| `googleApiKey` | `string` | Google Gemini API key. |
| `ollamaApiKey` | `string` | Ollama API key (only needed for cloud Ollama). |
| `ollamaHost` | `string` | Ollama host URL (for self-hosted or cloud Ollama). |
| `provider` | `Provider` | Override provider detection. One of `"openai"`, `"openai-responses"`, `"google"`, `"ollama"`, `"anthropic"`, `"replicate"`, `"modal"`, `"local"`. |
| `logLevel` | `LogLevel` | Logging verbosity: `"debug"`, `"info"`, `"warn"`, `"error"`, etc. |
| `toolLoopDetection` | `ToolLoopDetection` | Config to detect and break tool call loops. See below. |

### Request options (`PromptConfig`)

| Option | Type | Description |
|--------|------|-------------|
| `messages` | `Message[]` | **Required.** The conversation messages to send. |
| `instructions` | `string` | System-level instructions (system prompt). |
| `tools` | `{ name, description?, schema }[]` | Tool definitions. `schema` is a Zod object schema. |
| `responseFormat` | `ZodType` | Zod schema for structured output. The response will be parsed and validated against this schema. |
| `responseFormatOptions` | `object` | Fine-grained control over structured output (see below). |
| `maxTokens` | `number` | Maximum number of output tokens to generate. |
| `temperature` | `number` | Sampling temperature (0–2 for most providers). |
| `numSuggestions` | `number` | Number of completions to generate. |
| `parallelToolCalls` | `boolean` | Whether to allow the model to call multiple tools in parallel. |
| `stream` | `boolean` | If `true`, returns an `AsyncGenerator<StreamChunk>` instead of a `Promise`. |
| `maxMessages` | `number` | If the message list exceeds this count, returns a failure instead of calling the API. |
| `rawAttributes` | `Record<string, any>` | Pass provider-specific attributes directly to the API request. |

### `responseFormatOptions`

Used with `responseFormat` to control validation behavior (currently OpenAI only).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | | Name for the response format schema. |
| `strict` | `boolean` | | Whether to use strict schema validation. |
| `numRetries` | `number` | `2` | How many times to retry if the response fails schema validation. |
| `allowExtraKeys` | `boolean` | | If `true`, strips unexpected keys instead of failing validation. |

### `toolLoopDetection`

Detects when the model is stuck in a repetitive tool-call loop.

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | `boolean` | Whether loop detection is active. |
| `maxConsecutive` | `number` | Number of consecutive identical tool calls before triggering intervention. |
| `intervention` | `string` | Action to take: `"remove-tool"`, `"remove-all-tools"`, `"throw-error"`, or `"halt-execution"`. |
| `excludeTools` | `string[]` | Tool names to ignore when counting consecutive calls. |

## Prior art
- Langchain
OpenRouter
- Vercel AI

These are all good options, but they are quite heavy, and I wanted a lighter option. That said, you may be better off with one of the above alternatives:
- They are backed by a business and are more likely to be responsive.
- They support way more functionality and providers. Smoltalk currently supports just a subset of functionality for OpenAI and Google.

## Functionality
Smoltalk pretty much lets you generate text using an OpenAI or Google model, with support for function calling and structured output, and that's it. I will add functionality and providers sporadically when I have time and need.

## Contributing
This repo could use some help! Any of the following contributions would be helpful:
- Adding support for API parameters or endpoints
- Adding support for different providers
- Updating the list of models
