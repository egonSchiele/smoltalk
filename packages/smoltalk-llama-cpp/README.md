# smoltalk-llama-cpp

`node-llama-cpp` provider plugin for [smoltalk](https://github.com/egonSchiele/smoltalk).

## Install

```bash
pnpm add smoltalk smoltalk-llama-cpp
```

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
