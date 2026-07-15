# Smoltalk

Smoltalk exposes a common API to different LLM providers, with built-in cost tracking, structured output, tool calling, streaming, and observability hooks. Here is a simple example.

## Install

```bash 
pnpm install smoltalk
```

> **Upgrading to 0.6.x?** The flat API-key/host fields on `SmolConfig` have
> been removed in favor of nested `apiKey` and `baseUrl` maps. Migration:
> ```diff
> -{ openAiApiKey: "sk-...",   googleApiKey: "...", ollamaHost: "http://..." }
> +{ apiKey: { openAi: "sk-...", google: "..." }, baseUrl: { ollama: "http://..." } }
> ```
> Env-var fallbacks are unchanged (`OPENAI_API_KEY`, `GEMINI_API_KEY`,
> `ANTHROPIC_API_KEY`, `OLLAMA_HOST`).

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
    model: 'gpt-5.4',
    stopReason: 'stop',
    rawStopReason: 'stop'
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
  apiKey: {
    openAi: process.env.OPENAI_API_KEY || "",
    google: process.env.GEMINI_API_KEY || "",
  },
  logLevel: "debug",
});
```

If you want to construct a client once and reuse it across many calls, use `getClient()`:

```ts
import { getClient, userMessage } from "smoltalk";

const client = getClient({
  apiKey: {
    openAi: process.env.OPENAI_API_KEY || "",
    google: process.env.GEMINI_API_KEY || "",
  },
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

> **`z.any()` in a structured-output schema.** Providers reject an unconstrained
> ("any") schema, since the point of structured output is that it's structured. A
> nested `z.any()` field is therefore coerced to a **string** (`{type:"string"}`) —
> so `z.object({ data: z.any() })` will have the model emit a string for `data`, not
> an arbitrary object. If the *entire* `responseFormat` is `z.any()`/`z.unknown()`,
> structured output is dropped and the model returns free text. Use a concrete Zod
> shape when you need a specific structure.

## Stop reason

Every result carries why the turn ended, normalized across providers:

- `stopReason` — a unified value: `"stop"` (natural completion), `"length"` (hit
  max tokens), `"tool_use"` (model wants to call a tool), `"content_filter"`
  (safety/policy/refusal), `"stop_sequence"`, `"pause"`, or `"other"`.
- `rawStopReason` — the untouched provider value (e.g. `end_turn`, `MAX_TOKENS`,
  `tool_calls`), for when you need provider-specific nuance.

```ts
const r = await text({ messages, model: "claude-sonnet-4-6", maxTokens: 100 });
if (r.success && r.value.stopReason === "length") {
  // response was truncated — raise maxTokens or continue the turn
}
```

Both fields are present on the non-streaming result and on the streaming `done`
chunk's result. Note Google reports `STOP` even for tool-call turns, so `stopReason`
is normalized to `"tool_use"` there when tool calls are present (`rawStopReason`
still shows `STOP`).

## Configuration Options

`SmolConfig` is a single config type passed to `text()`. It contains everything: API keys, model selection, request parameters, hooks, and observability options.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `ModelName` | **Required.** The model to use (e.g. `"gpt-4o"`, `"gemini-2.0-flash-lite"`). |
| `messages` | `Message[]` | **Required.** The conversation messages to send. |
| `apiKey` | `{ openAi?, google?, anthropic?, ollama?, openRouter?, deepInfra?, liteLlm?, openAiCompat? }` | API keys, nested by provider. Each falls back to its conventional env var (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `DEEPINFRA_API_KEY`, `LITELLM_API_KEY`, `OPENAI_COMPAT_API_KEY`). Ollama has no env-var fallback for the key. |
| `baseUrl` | `{ ollama?, openRouter?, deepInfra?, liteLlm?, openAiCompat? }` | Custom base URLs. `ollama` defaults to `$OLLAMA_HOST` then `http://localhost:11434`; `openRouter`/`deepInfra` defaults are baked in; `liteLlm`/`openAiCompat` require an explicit URL (or `LITELLM_BASE_URL` / `OPENAI_COMPAT_BASE_URL` env). |
| `provider` | `Provider` | Override provider detection. One of `"openai"`, `"openai-responses"`, `"google"`, `"ollama"`, `"anthropic"`, `"openrouter"`, `"deepinfra"`, `"litellm"`, `"openai-compat"`, or any provider registered via `registerProvider()`. |
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

## Hosted OpenAI-compatible providers

Smoltalk ships four built-in providers for hosted open-source models that all
speak the OpenAI chat-completions shape. Use these when you want to run a
Llama, GLM, Qwen, etc. via someone else's hosted infrastructure without
adding a new dependency. You must pass `provider:` explicitly because these
model ids aren't in the smoltalk registry.

| `provider:` | What it is | Required config | Cost source |
|-------------|------------|-----------------|-------------|
| `"openrouter"` | OpenRouter.ai aggregator | `apiKey.openRouter` (or `OPENROUTER_API_KEY`) | `usage.cost` (auto-enabled by injecting `usage:{include:true}`) |
| `"deepinfra"` | DeepInfra hosted models | `apiKey.deepInfra` (or `DEEPINFRA_API_KEY`) | `usage.estimated_cost` |
| `"litellm"`   | Your own LiteLLM proxy   | `apiKey.liteLlm` + `baseUrl.liteLlm` (or `LITELLM_API_KEY` / `LITELLM_BASE_URL`) | `x-litellm-response-cost` header (non-stream only) |
| `"openai-compat"` | Any OpenAI-shape backend (vLLM, TGI, LM Studio…) | `apiKey.openAiCompat` + `baseUrl.openAiCompat` (or `OPENAI_COMPAT_API_KEY` / `OPENAI_COMPAT_BASE_URL`) | Best-effort: reads `usage.cost`/`estimated_cost`/`cost_usd` if present |

```ts
import { textSync, userMessage } from "smoltalk";

const r = await textSync({
  model: "z-ai/glm-5.2",
  provider: "openrouter",
  apiKey: { openRouter: process.env.OPENROUTER_API_KEY! },
  messages: [userMessage("hi")],
});
// r.value.cost.totalCost is a real OpenRouter-reported USD cost.
```

**Capability matrix:**

|                 | chat | embeddings | image generation | `web_search` hosted tool |
|-----------------|------|------------|------------------|--------------------------|
| `openrouter`    | ✅   | ❌         | ❌               | ✅ (via `:online` / web plugin) |
| `deepinfra`     | ✅   | ✅         | ❌ (uses per-model endpoints, not OpenAI shape) | ❌ |
| `litellm`       | ✅   | ✅         | ✅ (if the upstream model supports it) | ✅ (if upstream supports it) |
| `openai-compat` | ✅   | ✅         | ✅ (backend-dependent) | depends on backend |

Smoltalk surfaces a clear `failure(...)` from `embed()`/`image()` for the
unsupported combinations rather than silently dropping the call.

**Running a local LiteLLM proxy:**

```bash
pip install 'litellm[proxy]'
litellm --model openai/gpt-4o
# In your code: baseUrl: { liteLlm: "http://localhost:4000" }
```

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
keeps it current. Local models (Ollama) have none.

### Using a hosted tool (web search)

Enable a provider's hosted web search on a call with `hostedTools` (a list of
capability names). It's separate from `tools` because hosted tools run
server-side — you can't intercept or gate them like your own functions.

```ts
import { textSync, type Message } from "smoltalk";

declare const messages: Message[];

const result = await textSync({
  model: "claude-opus-4-8",
  messages,
  hostedTools: ["web_search"],
});

// Normalized across providers, regardless of who ran the search:
if (result.success) {
  console.log(result.value.hostedToolResults);
  // [{ tool: "web_search", provider: "anthropic", queries: [...], sources: [...],
  //    citations: [...], callCount: 1, estimatedCost: 0.01 }]
}
```

Supported on Anthropic, Google, and OpenAI **Responses-API** models. Note that
smoltalk routes base GPT-5 / GPT-4o to Chat Completions, so on OpenAI hosted web
search is available only on the `openai-responses` models (the `*-pro` variants,
e.g. `gpt-5-pro`). Chat-only OpenAI models (`gpt-4o`, `gpt-5`) and local models
return a clear error — use a search *function* (e.g. the Brave/Tavily-backed
stdlib tools) as a regular `tool` instead.

`estimatedCost` is an upper-bound estimate (providers report usage counts, not
charges; free-tier allowances are ignored). Results are populated on `textSync`;
streaming text is unaffected but the streamed result does not include them yet.
On Google, web search can't be combined with structured output in one call.

## Registering custom providers

Smoltalk has three registration entry points — one per capability:

```ts
// example: skip-typecheck
import {
  success,                    // Result helper
  registerProvider,           // text generation (a class extending BaseClient)
  registerEmbeddingProvider,  // embeddings (a function)
  registerImageProvider,      // images (a function)
} from "smoltalk";

// Text: a class extending BaseClient (implements _textSync / _textStream)
registerProvider("my-llm", MyTextClient);

// Embeddings: a function
registerEmbeddingProvider("my-embed", async (inputs, config) => {
  // read credentials from config (e.g. config.metadata), call your service
  return success({ embeddings: [...], model: config.model });
});

// Images: a function
registerImageProvider("my-image", async (input, config) => {
  return success({ images: [...], model: config.model });
});
```

Select a custom provider by passing `provider` in the call config
(`embed(input, { provider: "my-embed", model })`,
`image(input, { provider: "my-image", model })`). Built-in providers always take
precedence; a registered name that collides with a built-in is ignored. Custom
providers receive the full `config` and read their own credentials from it
(e.g. `config.metadata`).

Text is a class (it needs retries, tool-loop detection, streaming); embeddings
and images are one-shot functions.

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