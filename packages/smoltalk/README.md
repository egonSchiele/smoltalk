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

Any result from a model response carries why the turn ended, normalized across
providers:

- `stopReason` — a unified value: `"stop"` (natural completion), `"length"` (hit
  max tokens), `"tool_use"` (model wants to call a tool), `"content_filter"`
  (safety/policy/refusal), `"stop_sequence"`, `"pause"`, or `"other"`.
- `rawStopReason` — the untouched provider value (e.g. `end_turn`, `MAX_TOKENS`,
  `tool_calls`), for when you need provider-specific nuance.

```ts
import { textSync, userMessage } from "smoltalk";

const r = await textSync({
  model: "claude-sonnet-4-6",
  maxTokens: 100,
  messages: [userMessage("Write a long essay about otters.")],
});
if (r.success && r.value.stopReason === "length") {
  // response was truncated — raise maxTokens or continue the turn
}
```

Both fields appear on the non-streaming result and on the streaming `done` chunk's
result. They are optional: a result produced without calling a provider (e.g. a
tool-loop halt) has neither.

Two provider notes:
- Google reports `STOP` even for tool-call turns, so `stopReason` is normalized to
  `"tool_use"` there when tool calls are present (`rawStopReason` still shows `STOP`).
- The OpenAI Responses API has no single finish-reason field, so its `rawStopReason`
  is the response *status* (`"completed"`) or the incomplete reason
  (`"max_output_tokens"`), rather than a chat-style `"stop"`.

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

## Custom models & pricing

If you use a model that isn't in smoltalk's baked-in catalog (a self-hosted
model, a brand-new release, an OpenAI-compatible endpoint), smoltalk has no
pricing for it and the `cost` field is simply omitted from the result — nothing
errors, you just get `usage` without `cost`. Teach it the price and cost
tracking starts working.

**One model — `registerTextModel` (recommended).** Register once at startup:

```ts
import { registerTextModel, textSync, userMessage } from "smoltalk";

registerTextModel({
  modelName: "my-model",
  provider: "openai-compat", // must match the provider you call with (see below)
  inputTokenCost: 0.5, // USD per 1M input tokens
  outputTokenCost: 1.5, // USD per 1M output tokens
  cachedInputTokenCost: 0.05, // optional
  cacheCreationInputTokenCost: 0.625, // optional
  maxInputTokens: 128000, // required by the type, even if you only want pricing
  maxOutputTokens: 8192,
});

const messages = [userMessage("hello")];
const res = await textSync({
  model: "my-model",
  provider: "openai-compat",
  baseUrl: { openAiCompat: "https://my-endpoint/v1" },
  messages,
});
// res.value.cost is now populated from the rates above.
```

**Per-call only — `config.modelData`.** When you can't register globally (e.g.
per-tenant rates), pass a minimal blob for a single call. It layers over the
baseline exactly like a refresh blob:

```ts
import { textSync, userMessage, type ModelDataBlob } from "smoltalk";

const modelData: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  hostedTools: [],
  models: [
    {
      type: "text",
      modelName: "my-model",
      provider: "openai-compat",
      maxInputTokens: 128000,
      maxOutputTokens: 8192,
      inputTokenCost: 0.5,
      outputTokenCost: 1.5,
    },
  ],
};

const messages = [userMessage("hello")];
await textSync({ model: "my-model", provider: "openai-compat", messages, modelData });
```

**The provider must match.** The registry is keyed by `provider:modelName`, so
the `provider` you register (or put in the blob) has to equal the `provider` you
pass at call time. Registering `my-model` under `"openai-compat"` but calling it
with `provider: "openrouter"` looks up a different key, finds no price, and
silently drops the `cost` field. When in doubt, register under the same provider
string you call with.

Overriding an entry that *is* in the catalog works the same way — merges are
field-by-field (see "Refreshing model data" above), so registering just
`inputTokenCost` / `outputTokenCost` for a known model updates only those fields
and leaves its limits and capabilities intact.

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

Smoltalk has one registration entry point per capability:

```ts
// example: skip-typecheck
import {
  success,                         // Result helper
  registerProvider,                // text generation (a class extending BaseClient)
  registerTranscriptionProvider,   // speech-to-text (a class extending BaseTranscriptionClient)
  registerSpeechProvider,          // text-to-speech (a class extending BaseSpeechClient)
  registerEmbeddingProvider,       // embeddings (a function)
  registerImageProvider,           // images (a function)
} from "smoltalk";

// Text: a class extending BaseClient (implements _textSync / _textStream)
registerProvider("my-llm", MyTextClient);

// STT/TTS: classes extending the audio base clients (see "Audio (STT/TTS)")
registerTranscriptionProvider("my-asr", MyTranscriptionClient);
registerSpeechProvider("my-tts", MySpeechClient);

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

Text, transcription, and speech are classes: a base class owns the shared
behavior (validation, cost, error handling) and the subclass implements only
the provider call. Embeddings and images are one-shot functions.

## Local models (llama-cpp)

Install the optional plugin and name the provider — no wiring code:

```bash
npm i smoltalk-llama-cpp
```

```typescript
import { textSync, userMessage } from "smoltalk";

const result = await textSync({
  provider: "llama-cpp",
  model: "/path/to/llama-3.gguf",
  messages: [userMessage("Hello!")],
});
```

smoltalk lazily imports and registers the plugin on the first `llama-cpp`
call; if the package is missing you get an install hint instead of a
resolution stack trace. Hosts with unusual layouts (e.g. a globally-installed
CLI with the plugin installed globally beside it) can hand smoltalk the
plugin's entry path explicitly and skip Node resolution:

```typescript
import { loadLlamaCpp } from "smoltalk";

const { resolveModel } = await loadLlamaCpp({
  entryPath: "/path/to/smoltalk-llama-cpp/dist/index.js",
});
// resolveModel downloads hf: URIs (and returns local paths unchanged):
const modelPath = await resolveModel("hf:org/repo/model.gguf", "/models/cache");
```

## Audio (STT/TTS)

Three audio primitives. `transcribe()` (speech-to-text) and `speak()`
(text-to-speech) are async and return `Result<T>` (never throw). `audioPart()`
(attach audio to a chat message) is different: it's a synchronous plain-object
constructor, not a `Result`-returning call — see "Audio in chat" below.

`transcribe()` and `speak()` support **OpenAI**, **Groq** (OpenAI-compatible
endpoints), and **Google Gemini** (native multimodal). For any other provider
that exposes OpenAI-shaped `/audio/*` endpoints, use the generic
**`openai-compat`** provider with `baseUrl` (mirrors the chat client). Anthropic,
OpenRouter, and Ollama have no audio endpoints and return a `Failure`.

```ts
// example: skip-typecheck
// Groq STT (OpenAI-compatible; provider inferred from the model)
await transcribe(src, { model: "whisper-large-v3" });

// Gemini STT (native multimodal — a general Gemini model transcribes)
await transcribe(src, { model: "gemini-2.5-flash", provider: "google" });

// Groq TTS → WAV by default
await speak("Hello", { model: "canopylabs/orpheus-v1-english", voice: "troy" });

// Gemini TTS → raw PCM by default; format: "wav" wraps it in a WAV header.
// Gemini has no numeric `speed` (rejected) and produces PCM/WAV only.
await speak("Hello", {
  model: "gemini-2.5-flash-preview-tts", voice: "Kore",
  provider: "google", format: "wav",
});

// Any OpenAI-compatible /audio endpoint (vLLM, LiteLLM, a proxy, …)
await transcribe(src, {
  model: "whisper-1",
  provider: "openai-compat",
  apiKey: { openAiCompat: "..." },       // or OPENAI_COMPAT_API_KEY
  baseUrl: { openAiCompat: "https://my-proxy/v1" }, // or OPENAI_COMPAT_BASE_URL
});
```

### Speech-to-text

```ts
import { transcribe } from "smoltalk";

const result = await transcribe(
  { kind: "path", path: "./meeting.mp3" },
  { model: "whisper-1" },
);
if (result.success) {
  console.log(result.value.text);
}
```

Baked-in STT models: `whisper-1` (OpenAI) and `whisper-large-v3` /
`whisper-large-v3-turbo` (Groq); Gemini transcribes with a general model such as
`gemini-2.5-flash`. Options: `language`, `prompt`,
`timestampGranularity` (`"segment"` | `"word"`), `maxBytes` (a safety limit —
the effective cap is the smaller of your limit and the model's declared upload
cap, 25 MB for `whisper-1`). The result carries `text` plus optional
`language`, `durationSeconds`, `segments`, `words`, `usage`, and `cost`.

Model constraints (accepted MIME types, upload cap, per-minute price) live in
the model registry, not in code — a model you add via `registerModelData` /
`config.modelData` is validated against whatever its data block declares, and
a model with no registry entry skips validation entirely (the provider is then
the authority).

Register a custom provider as a class:

```ts
// example: skip-typecheck
import { BaseTranscriptionClient, registerTranscriptionProvider, success } from "smoltalk";

class AcmeTranscription extends BaseTranscriptionClient {
  protected async _transcribe(data: Uint8Array, mimeType: string) {
    // call your API with this.config.apiKey; map the response
    return success({ text: "..." });
  }
}
registerTranscriptionProvider("acme", AcmeTranscription);

// then: transcribe(source, { model: "acme-1", provider: "acme", apiKey: { acme: "..." } })
```

The base class owns blob loading, model-data validation, cost, and the
redacting error boundary; `_transcribe()` is only the SDK call + response
mapping.

### Text-to-speech

```ts
import { speak } from "smoltalk";
import { writeFile } from "node:fs/promises";

const result = await speak("Hello from smoltalk.", {
  model: "tts-1",
  voice: "alloy",
});
if (result.success) {
  await writeFile("out.mp3", result.value.audio); // caller owns the bytes
}
```

`tts-1` and `tts-1-hd` are the only baked-in models in v1. `voice` is
required. Options: `format` (OpenAI accepts `"mp3"` | `"opus"` | `"aac"` |
`"flac"` | `"wav"` | `"pcm"`, default `"mp3"`; a custom provider may accept
other strings) and `speed`. Limits are declared per model in the registry —
for `tts-1`/`tts-1-hd` that's a 4096-code-point input cap, a 0.25–4.0 speed
range, and the format list above; exceeding any of them returns a `Failure`
before the request is sent. The returned `audio` is a `Uint8Array` you own —
write it to disk, stream it, whatever you like. When `format` is `"pcm"`,
`result.pcm` describes the raw stream (for OpenAI:
`{ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 }`).

Register a custom provider as a class, mirroring transcription:

```ts
// example: skip-typecheck
import { BaseSpeechClient, registerSpeechProvider, success } from "smoltalk";

class AcmeSpeech extends BaseSpeechClient {
  protected async _speak(text: string) {
    // call your API with this.config.apiKey / this.config.voice
    return success({ audio: new Uint8Array(), mimeType: "audio/mpeg" });
  }
}
registerSpeechProvider("acme", AcmeSpeech);
```

As with transcription, per-model constraints come from the model registry
(`registerModelData` / `config.modelData`), so a custom model's caps, speed
range, and formats are data, not code.

### Audio in chat

`audioPart()` attaches an audio clip to a `userMessage`, for models that
accept audio input directly (as opposed to transcribing it first).
`audioPart()` itself is a synchronous constructor that builds a content part
— it always returns an `AudioPart`, never a `Result`, and it can't fail:

```ts
import { textSync, userMessage, audioPart } from "smoltalk";

const messages = [
  userMessage([
    "What's being said in this clip?",
    audioPart({ kind: "path", path: "./clip.wav" }),
  ]),
];

const resp = await textSync({ messages, model: "gpt-audio-1.5" });
```

In v1 this only works with `gpt-audio-1.5` on the OpenAI Chat Completions
provider (not `openai-responses`, and not other providers). Validation
happens later, when the message is sent via `textSync`/`textStream` — an
unsupported provider, a model without audio input, or audio that isn't
`mp3`/`wav` surfaces as a `Failure` from that call, not from `audioPart()`
itself. Audio is inlined as base64, not uploaded via the Files API.

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