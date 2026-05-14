# smoltalk-webllm

WebGPU-accelerated browser provider for [smoltalk](../smoltalk). Runs LLMs locally in the user's browser via [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm).

## Install

```bash
pnpm add smoltalk smoltalk-webllm
```

## Usage

Register the provider before your first call, then use `smoltalk` normally:

```ts
import { registerProvider, text, userMessage } from "smoltalk";
import { WebLLMClient, loadModel } from "smoltalk-webllm";

registerProvider("webllm", WebLLMClient);

await loadModel("Llama-3.2-3B-Instruct-q4f32_1-MLC", {
  onProgress: (p) => console.log(p.text, p.loaded, p.total),
});

const result = await text({
  model: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
  provider: "webllm",
  messages: [userMessage("Hello")],
});
```

The model id must match a record in WebLLM's `prebuiltAppConfig.model_list`. To see all available models:

```ts
import { listModels } from "smoltalk-webllm";
console.log(await listModels()); // ["Llama-3.2-1B-Instruct-q4f32_1-MLC", ...]
```

## Custom models

Pass a `CustomModel` object to `loadModel` to load a model not in the prebuilt list:

```ts
await loadModel({
  id: "MyLlama-3b",
  modelUrl: "https://huggingface.co/.../resolve/main/",
  modelLibUrl: "https://.../mymodel.wasm",
  contextWindow: 4096,
});
```

## Limitations

- **WebGPU required**: throws `SmolError` at `loadModel()` time if `navigator.gpu` is undefined.
- **AbortSignal**: passing a `signal` to `loadModel` will reject the returned promise on abort, but the underlying download/compile may continue in the background. The engine will be unloaded if it eventually arrives so GPU memory is released.
