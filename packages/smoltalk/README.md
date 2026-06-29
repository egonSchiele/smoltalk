# Smoltalk

Smoltalk exposes a common API to different LLM providers, with built-in cost tracking, structured output, tool calling, streaming, and observability hooks. Here is a simple example.

## Install

```bash 
pnpm install smoltalk
```

## Hello world example

```typescript
import { text, userMessage } from "smoltalk";

async function main() {
  const messages = [userMessage("Write me a 10 word story.")];
  const response = await text({
    messages,
    model: "gpt-5.4",
  });
  console.log(response);
}

main();
```

This is functionality that other packages allow.
<details>
  <summary>Response</summary>

```
{
  success: true,
  value: {
    output: 'Clock stopped; everyone smiled as tomorrow finally arrived before yesterday.',
    toolCalls: [],
    usage: {
      inputTokens: 14,
      outputTokens: 15,
      cachedInputTokens: 0,
      totalTokens: 29
    },
    cost: {
      inputCost: 0.000035,
      outputCost: 0.000225,
      cachedInputCost: undefined,
      totalCost: 0.00026,
      currency: 'USD'
    },
    model: 'gpt-5.4'
  }
}
```
</details>

## Longer tutorial

The top-level `text()` function is the recommended entry point — pass everything in a single config:

```ts
import { text, userMessage } from "smoltalk";

const messages = [
  userMessage("Please use the add function to add the following numbers: 3 and 5"),
];

const resp = await text({
  messages,
  model: "gemini-2.0-flash-lite",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "debug",
});
```

If you want to construct a client once and reuse it across many calls, use `getClient()`:

```ts
import { getClient, userMessage } from "smoltalk";

const client = getClient({
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GEMINI_API_KEY || "",
  model: "gemini-2.0-flash-lite",
});

const messages = [userMessage("hi")];
const resp = await client.text({ messages, model: "gemini-2.0-flash-lite" });
```

Here is an example with tool calling:

```ts
import { text, userMessage } from "smoltalk";
import { z } from "zod";

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

const messages = [userMessage("Add 3 and 5")];

const resp = await text({
  messages,
  model: "gemini-2.0-flash-lite",
  tools: [addTool],
});
```

Here is an example with structured output:

```ts
import { text, userMessage } from "smoltalk";
import { z } from "zod";

const messages = [userMessage("How many planets are in the solar system?")];

const resp = await text({
  messages,
  model: "gemini-2.0-flash-lite",
  responseFormat: z.object({
    result: z.number(),
  }),
});
```

A couple of design decisions to note:
- You specify different API keys using different parameter names. This means you could set a couple of different API keys and then be able to change the model name without worrying about the keys, which makes things easier for code generation.
- The schema for tools and structured outputs is defined using Zod.
- Parameter names are camel case, as that is the naming convention in TypeScript. They are converted to snake case for you if required by the APIs.

## Configuration Options

`SmolConfig` is a single config type passed to `text()`. It contains everything: API keys, model selection, request parameters, hooks, and observability options.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `ModelName` | **Required.** The model to use (e.g. `"gpt-4o"`, `"gemini-2.0-flash-lite"`). |
| `messages` | `Message[]` | **Required.** The conversation messages to send. |
| `openAiApiKey` | `string` | OpenAI API key. |
| `googleApiKey` | `string` | Google Gemini API key. |
| `anthropicApiKey` | `string` | Anthropic API key. |
| `ollamaApiKey` | `string` | Ollama API key (only needed for cloud Ollama). |
| `ollamaHost` | `string` | Ollama host URL (for self-hosted or cloud Ollama). |
| `provider` | `Provider` | Override provider detection. One of `"openai"`, `"openai-responses"`, `"google"`, `"ollama"`, `"anthropic"`, or any provider registered via `registerProvider()`. |
| `logLevel` | `LogLevel` | Logging verbosity: `"debug"`, `"info"`, `"warn"`, `"error"`. |
| `tools` | `{ name, description?, schema }[]` | Tool definitions. `schema` is a Zod object schema. |
| `responseFormat` | `ZodType` | Zod schema for structured output. The response is parsed and validated against this schema. |
| `responseFormatOptions` | `object` | Fine-grained control over structured output (see below). |
| `maxTokens` | `number` | Maximum number of output tokens to generate. |
| `temperature` | `number` | Sampling temperature (0–2). |
| `numSuggestions` | `number` | Number of completions to generate. |
| `parallelToolCalls` | `boolean` | Whether to allow the model to call multiple tools in parallel. |
| `stream` | `boolean` | If `true`, returns an `AsyncGenerator<StreamChunk>` instead of a `Promise`. |
| `thinking` | `{ enabled, budgetTokens? }` | Enable extended thinking / thought signatures (Anthropic and Google). |
| `reasoningEffort` | `"low" \| "medium" \| "high"` | Provider-agnostic reasoning effort level. |
| `maxMessages` | `number` | If the message list exceeds this count, returns a failure instead of calling the API. |
| `abortSignal` | `AbortSignal` | Cancel an in-flight request. |
| `toolLoopDetection` | `ToolLoopDetection` | Detect and break tool-call loops. See below. |
| `rawAttributes` | `Record<string, any>` | Pass provider-specific attributes directly to the API request. |
| `hooks` | `{ onStart?, onToolCall?, onEnd?, onError? }` | Lifecycle hooks. |
| `statelog` | `object` | Configuration for Statelog observability/tracing integration. |
| `metadata` | `Record<string, any>` | Arbitrary metadata. |

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
| `maxCalls` | `number` | Number of calls to a specific tool before triggering intervention. |
| `intervention` | `string` | Action to take: `"remove-tool"`, `"remove-all-tools"`, `"throw-error"`, or `"halt-execution"`. |
| `excludeTools` | `string[]` | Tool names to ignore when counting calls. |

## Refreshing model data

Smoltalk ships a baked-in model registry (pricing, context limits, capabilities).
Because that data goes stale between releases, you can pull a fresh copy at
runtime and layer it over the built-ins. **You decide where to store it** —
smoltalk never writes to disk.

```ts
import { refreshModels, registerModelData } from "smoltalk";

// Fetch the latest data (from a URL smoltalk controls by default).
const result = await refreshModels();
if (result.success) {
  // Persist result.value however you like (file, KV store, etc.),
  // then register it once at startup:
  registerModelData(result.value);
}
```

Precedence is **per-call `config.modelData` > `registerModelData` (global) >
baked-in baseline**, merged field-by-field (a refreshed field wins; missing
fields never erase built-in values). Per-call override:

```ts
import { textSync, type Message, type ModelDataBlob } from "smoltalk";

declare const messages: Message[];
declare const modelData: ModelDataBlob;

await textSync({ model: "claude-opus-4-8", messages, modelData });
```

Override the source URL with the `SMOLTALK_MODEL_DATA_URL` env var or
`refreshModels({ url })`. The URL may be remote (`https://`, e.g. your own
self-hosted catalog) or local (`file://…/model-data.json`). The blob also carries
a `hostedTools` catalog (`getHostedTools()`); the published file is kept current
by a daily CI job that translates [models.dev](https://models.dev) into
smoltalk's shape.

## Hosted tools catalog

Each cloud provider offers server-side "hosted" tools (web search, code
execution, file search, image generation). Smoltalk ships a catalog of what's
available and what it costs — query it with `getHostedTools()`:

```ts
import { getHostedTools, hostedToolPricingFor } from "smoltalk";

// Hosted tools usable with a given model (respects provider + model allowlists):
console.log(getHostedTools({ model: "claude-opus-4-8" }));

// All web-search tools across providers:
const search = getHostedTools({ category: "web_search" });

// Effective pricing for a tool on a specific model (applies per-model overrides):
const first = search[0];
if (first) {
  console.log(hostedToolPricingFor(first, "gemini-2.5-pro"));
}
```

The catalog rides in the same refresh blob as model data, so `refreshModels()`
keeps it current. It's informational (catalog/pricing only) — smoltalk does not
yet invoke hosted tools on your behalf. Local models (Ollama) have none.

## Limitations
Smoltalk has support for a limited number of providers right now, and is mostly focused on the stateless APIs for text completion, though I plan to add support for more providers as well as image and speech models later. Smoltalk is also a personal project, and there are alternatives backed by companies:

- Langchain
- OpenRouter
- Vercel AI

## Contributing
Contributions are welcome. Any of the following contributions would be helpful:
- Adding support for API parameters or endpoints
- Adding support for different providers
- Updating the list of models