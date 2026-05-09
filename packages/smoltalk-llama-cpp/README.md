# smoltalk-llama-cpp

`node-llama-cpp` provider plugin for [smoltalk](https://github.com/egonSchiele/smoltalk).

## Install

```bash
pnpm add smoltalk smoltalk-llama-cpp
```

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
