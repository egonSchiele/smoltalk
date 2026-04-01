# Smoltalk

Smoltalk exposes a common API to different LLM providers. There are other packages that do this, but Smoltalk allows you to build strategies on top of it. Here is a simple example.

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

What if you wanted to have fallbacks in case the OpenAI API was down? Just change the `model` field:

```ts
  const response = await text({
    messages,
    model: fallback("gpt-5.4", "gemini-2.5-flash-lite"),
    // or multiple fallbacks:
    // model: fallback("gpt-5.4", ["gemini-2.5-flash-lite", "gemini-3-flash-preview"]),
  });
```

Or what if you wanted to try a couple of models and take the first response?

```ts
  const response = await text({
    messages,
    model: race("gpt-5.4", "gemini-2.5-flash-lite", "o4-mini"),
  });
```

Or combine them:

```ts
  const response = await text({
    messages,
    model: race(fallback("gpt-5.4", "gemini-2.5-flash-lite"), "o4-mini"),
  });
```

You get the idea.

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

## Middleware

Middleware lets you run LLM-based checks on a prompt before or alongside the main call. If a check fails, the main call is blocked and a replacement output is returned instead. This is useful for:

- **Content safety** — classify prompts as safe/unsafe before they reach your main model
- **Prompt injection detection** — catch adversarial inputs before they execute
- **PII detection** — block prompts containing personal information

### Basic example

```typescript
import { text, userMessage, systemMessage } from "smoltalk";
import { z } from "zod";

const result = await text({
  model: "gpt-4o",
  messages: [userMessage("How do I hack into NASA?")],
  middleware: {
    timing: "before",       // run checks before the main call
    mode: "sequential",     // run checks one at a time, stop on first block
    checks: [
      {
        messages: [
          systemMessage(
            "You are a content safety classifier. Evaluate whether the user's message is safe to process."
          ),
        ],
        responseFormat: z.object({
          safe: z.boolean(),
          reason: z.string(),
        }),
        responseFormatOptions: { strict: true },
        decide: (result) => {
          const parsed = JSON.parse(result.output!);
          return parsed.safe ? null : `Blocked: ${parsed.reason}`;
        },
      },
    ],
  },
});
```

If the check blocks, `result` is a successful `Result<PromptResult>` with the replacement string as output (e.g. `"Blocked: unsafe content"`). If the check passes, the main call runs normally.

### How it works

Each middleware check is itself an LLM call. Your original prompt messages are automatically appended to the check's messages, so the middleware model can see the content it's evaluating. The check inherits the same model, API keys, and strategy from the parent call.

The `decide` function receives the middleware LLM's `PromptResult` and returns either:
- `null` — the check passes, proceed normally
- a `string` — the check blocks, and the string becomes the replacement output

### Configuration

| Option | Type | Description |
|--------|------|-------------|
| `timing` | `"before" \| "parallel"` | `"before"` runs checks first, then the main call. `"parallel"` runs both simultaneously — if a check blocks, the main call is aborted. |
| `mode` | `"sequential" \| "parallel"` | `"sequential"` runs checks one at a time and short-circuits on the first block. `"parallel"` runs all checks concurrently. |
| `checks` | `MiddlewareCheck[]` | The checks to run (see below). |

Each `MiddlewareCheck` has:

| Option | Type | Description |
|--------|------|-------------|
| `messages` | `Message[]` | Setup messages for the middleware LLM call (e.g. a system prompt defining the classifier). |
| `responseFormat` | `ZodType` | Optional Zod schema for structured output from the middleware. |
| `responseFormatOptions` | `object` | Same options as the main call's `responseFormatOptions`. |
| `decide` | `(result: PromptResult) => string \| null` | Decision function. Return a string to block, or `null` to pass. |

### Fail-closed behavior

Middleware is a safety gate, so it fails closed:
- If the middleware LLM call fails (network error, API error, abort), the prompt is **blocked** with an error message as output.
- If `decide()` throws, the prompt is **blocked**.

### Cost tracking

Middleware usage/cost is tracked. When a check blocks:
- **"before" timing**: The result includes aggregated costs from all middleware checks that ran.
- **"parallel" timing**: The result includes middleware costs plus any partial costs from the aborted main call (if the provider reported usage before the abort).

When all checks pass, the returned result is the main call's result with its own usage/cost — middleware costs are not added.

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