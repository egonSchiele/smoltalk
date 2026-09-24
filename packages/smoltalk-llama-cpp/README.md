# smoltalk-llama-cpp

`node-llama-cpp` provider plugin for [smoltalk](https://github.com/egonSchiele/smoltalk).

## Install

```bash
pnpm add smoltalk smoltalk-llama-cpp
```

## Zero-wiring use from smoltalk (>= 0.11.0)

Install this package next to smoltalk and call:

```typescript
import { textSync, userMessage } from "smoltalk";

await textSync({
  provider: "llama-cpp",
  model: "/path/to/model.gguf",
  messages: [userMessage("Hello!")],
});
```

smoltalk auto-loads and registers this provider on first use. Manual
`registerProvider` wiring is no longer needed (but still works and takes
precedence over the auto-loader).

## Downloading models

This package depends on [`node-llama-cpp`](https://node-llama-cpp.withcat.ai/), which ships a CLI with a `pull` command for downloading `.gguf` model files. Because `node-llama-cpp` is already installed as a dependency of `smoltalk-llama-cpp`, you can run its CLI through `npx` without installing anything else:

```bash
# Download a model into ./models
npx --no node-llama-cpp pull --dir ./models <model-file-url>
```

The `--no` flag tells `npx` to use the already-installed copy rather than fetching one. Pass a direct URL to a `.gguf` file (e.g. a Hugging Face download link). The `--dir` flag controls where the file is saved — point it at the same directory you pass as `metadata.llamaCppModelDir` below.

Not sure which model to grab? Run the interactive picker, which lists recommended models:

```bash
npx --no node-llama-cpp chat
```

See the [node-llama-cpp getting-a-model guide](https://node-llama-cpp.withcat.ai/guide/#getting-a-model-file) for more.

## Structured output and thinking models

Pass `responseFormat` as usual and the reply is held to the schema with a
llama.cpp grammar. A thinking model such as Qwen3.5 is left free inside its
`<think>` block, and only the text after it has to fit the schema, so the
thought still arrives in `thinkingBlocks` and `output` holds the JSON. When
tools are passed as well, the schema is not enforced, because node-llama-cpp
cannot apply a grammar and functions together.

`thinking` and `reasoningEffort` work here the way they do on the hosted
providers:

```ts
import { text, userMessage } from "smoltalk";

const call = {
  model: "Qwen3.5-4B-Q4_K_M.gguf",
  provider: "llama-cpp",
  metadata: { llamaCppModelDir: "./models" },
  messages: [userMessage("What is 17 times 23?")],
};

// No thought block at all: the answer comes straight away.
await text({ ...call, thinking: { enabled: false } });

// Think for at most 2048 tokens, then answer.
await text({ ...call, thinking: { enabled: true, budgetTokens: 2048 } });

// The budgets the google client uses for each effort: 2048, 8192, 16384.
await text({ ...call, reasoningEffort: "low" });
```

Turning thinking off uses the chat wrapper's own switch where it has one:
Qwen, Gemma 4, and Seed. Harmony (gpt-oss) takes an effort instead, so off
is its lowest effort. DeepSeek always thinks, so off is a budget of zero,
which closes the block as soon as it opens. `thinking: { enabled: true }`
asks a wrapper that would otherwise leave it to the model to open the block.
A call that says nothing gets node-llama-cpp's default budget, three
quarters of the context.

The budget and `maxTokens` come out of one pool. When the call sets no
`maxTokens`, it is raised to leave 4096 tokens for the answer after the
budget. When the call sets one, an eighth of it (at least 256 tokens) is kept
for the answer, and a budget that would take that is cut down, with a
warning. That is the rule Agency's MLX server applies too.

## Speculative decoding

A smaller model of the same family can draft tokens for the main model to
check, which is speculative decoding. The main model checks a whole draft in
one pass, at about the cost of producing one token, and keeps every token it
agrees with. The reply is what the main model would have written on its own,
only sooner. Typical gains are 1.5x to 2x on decode; a grammar-constrained
reply gains less, because the draft guesses wrong more often.

```ts
import { text, userMessage } from "smoltalk";

await text({
  model: "Qwen3-32B-Q4_K_M.gguf",
  provider: "llama-cpp",
  metadata: {
    llamaCppModelDir: "./models",
    llamaCppDraftModel: "Qwen3-0.6B-Q4_K_M.gguf",
  },
  messages: [userMessage("Hello")],
});
```

The draft must share the main model's tokenizer, so pick the smallest member
of the same family. The pair is checked when the draft loads (vocabulary
type, start and end tokens, and whether they are added), and a mismatch
fails the load with the reason rather than failing every later call. A
relative draft path is resolved against `llamaCppModelDir`, like the model.

The draft has to be much smaller than the model it drafts for: a 0.6B for
a 30B is the shape this is for. A draft half the size of its model costs
nearly what it saves and is rarely ready before the main step needs it, so
it cannot win. In testing on Apple Silicon a Qwen3.5 2B drafting for the 4B,
which is that shape, reported no predictions used and ran slower than the
4B alone. Measure before relying on a draft: after each call the accepted
and rejected counts are logged at debug level, and
`metadata.llamaCppDraftOptions` tunes how many tokens the draft guesses at a
time (`maxTokens`, default 16) and how sure it must be of each
(`minConfidence`, default 0.6).

### Choosing the chat wrapper

node-llama-cpp picks a chat wrapper for a model by reading its template, and
the thinking controls above go through that wrapper. For a model it gets
wrong, such as a fine-tune with a changed template, name the wrapper
yourself with `metadata.llamaCppChatWrapper`, using node-llama-cpp's name for
it (`qwen`, `gemma4`, `harmony`, `chatML`, and the rest of
`resolvableChatWrapperTypeNames`). The thinking settings still apply to the
wrapper you name, and the typed-reply grammar is built for it. A name
node-llama-cpp does not know is refused when the client is made.

```ts
import { text, userMessage } from "smoltalk";

await text({
  model: "my-qwen-finetune.gguf",
  provider: "llama-cpp",
  metadata: { llamaCppModelDir: "./models", llamaCppChatWrapper: "qwen" },
  messages: [userMessage("Hello")],
  thinking: { enabled: false },
});
```

## Speculative decoding: sampling

A drafted model is safest run greedy (`temperature: 0`). With node-llama-cpp
3.21.1, a Qwen3.5 model that samples on a draft never returns from the call,
so a call with a temperature above zero on a drafted Qwen3.5 model is refused
with an error. On a Qwen3 pair (0.6B drafting for the 8B) the same call
returned as usual, so other families get a warning, once per model, that a
hang has been seen. `llamaCppDraftOptions.allowSampling: true` turns off both
the refusal and the warning. In that Qwen3 test the predictor reported no
predictions used at any temperature and was slower than the 8B alone, so a
draft on llama.cpp is not a speed-up today; measure your own pair.

Like the context size, the first call for a model decides whether it has a
draft, and smoltalk makes a new client per call. A call without the setting
before the first call with it locks the draft out for the process, with a
warning that says how to change it. When a program should always draft,
call `new LlamaCPP(config).setup()` at startup. The draft's memory is added
to the main model's for as long as the model stays loaded.

## Usage

Register the provider before your first call, then use `smoltalk` normally:

```ts
import { registerProvider, text, userMessage } from "smoltalk";
import { LlamaCPP } from "smoltalk-llama-cpp";

registerProvider("llama-cpp", LlamaCPP);

const result = await text({
  model: "your-local-model.gguf",
  provider: "llama-cpp",
  metadata: { llamaCppModelDir: "./models" },
  messages: [userMessage("Hello")],
});
```

`metadata.llamaCppModelDir` points to a directory containing your `.gguf` model files.

## Embeddings

With smoltalk >= 0.14.0, `embed()` works the same zero-wiring way:

```ts
import { embed } from "smoltalk";

const result = await embed("some text", {
  provider: "llama-cpp",
  model: "/path/to/nomic-embed-text.gguf",
});
```

The vector is computed in process by node-llama-cpp. `model` must be a local
`.gguf` path; `resolveModel` turns an `hf:` URI into one. A few caveats:

- `dimensions` truncates the vector and renormalizes it. That is only
  meaningful for models trained for it (nomic-embed-text v1.5, the Qwen3
  embedding family); any other model returns a degraded vector with no error.
- Chat and embedding contexts are held separately. Passing the same `.gguf`
  to both `text()` and `embed()` loads it twice; use a dedicated embedding
  model.
- Embedding contexts follow the lifecycle rules below: one per model file,
  calls serialized, freed by `disposeAll()` / `disposeModel()`.

## Lifecycle & concurrency

Native model state is expensive to allocate and cannot be safely torn down
mid-request, so this plugin keeps it alive and reuses it:

- Each model is loaded **once per process** and cached (keyed by its resolved
  path). The context and sequence are created once and reused across every
  `text()` / `textStream()` call — smoltalk constructs a fresh client per call,
  but the heavy native state is shared behind the scenes.
- Requests to the **same model are serialized** (one generation at a time on
  the shared sequence). Concurrent `text()` calls are safe but run one after
  another; different models run independently.
- Native state is retained until process exit. For long-lived embedders (and
  tests), call `disposeAll()` when nothing is in flight to free every loaded
  model, or `disposeModel(modelKey(dir, file))` for a single one:

  ```ts
  import { disposeAll } from "smoltalk-llama-cpp";
  await disposeAll();
  ```

> Why reuse instead of a fresh context per call: disposing a `LlamaContext`
> immediately after generation races `node-llama-cpp`'s internal checkpoint
> worker on SWA/hybrid models (Qwen3, Gemma), causing a native use-after-free
> crash (`SIGSEGV`). Reusing the context removes that crash class entirely.
