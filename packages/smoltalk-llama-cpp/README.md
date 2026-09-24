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
// No thought block at all: the answer comes straight away.
await text({ ..., thinking: { enabled: false } });

// Think for at most 2048 tokens, then answer.
await text({ ..., thinking: { enabled: true, budgetTokens: 2048 } });

// The budgets the google client uses for each effort: 2048, 8192, 16384.
await text({ ..., reasoningEffort: "low" });
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
budget. When the call sets one that the budget would fill, the budget is cut
to leave that room, and a warning says so.

## Speculative decoding

A smaller model of the same family can draft tokens for the main model to
check, which is speculative decoding. The main model checks a whole draft in
one pass, at about the cost of producing one token, and keeps every token it
agrees with. The reply is what the main model would have written on its own,
only sooner. Typical gains are 1.5x to 2x on decode; a grammar-constrained
reply gains less, because the draft guesses wrong more often.

```ts
await text({
  model: "/models/Qwen3-32B-Q4_K_M.gguf",
  metadata: { llamaCppDraftModel: "/models/Qwen3-0.6B-Q4_K_M.gguf" },
  ...
});
```

The draft must share the main model's tokenizer, so pick the smallest member
of the same family. The pair is checked when the draft loads (vocabulary
type, start and end tokens, and whether they are added), and a mismatch
fails the load with the reason rather than failing every later call. A
relative draft path is resolved against `llamaCppModelDir`, like the model.

Two limits, both node-llama-cpp 3.21's. A drafted model has to run greedy:
its draft predictor never returns when the main model samples, so a call
with a temperature above zero on a drafted model is refused with an error
rather than left to hang. And measure before relying on it. In testing on
Apple Silicon, a Qwen3.5 2B drafting for the 4B reported no predictions
used and ran slower than the 4B alone. After each call the accepted and
rejected counts are logged at debug level, and `metadata.llamaCppDraftOptions`
tunes how many tokens the draft guesses at a time (`maxTokens`, default 16)
and how sure it must be of each (`minConfidence`, default 0.6).

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
