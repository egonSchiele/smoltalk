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
