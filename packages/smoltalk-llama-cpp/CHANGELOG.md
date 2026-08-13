## version 0.4.0 (08/12/2026)
- Thought segments from thinking models (Qwen3, DeepSeek-R1) are now mapped into `PromptResult.thinkingBlocks` (sync and streaming `done` results) and streamed live as `{type: "thinking"}` chunks. Previously the hidden reasoning — often the majority of the generated tokens — was silently dropped. `signature` is always `""` (llama.cpp has no signed reasoning).

## version 0.3.0 (08/12/2026)
- Aborted generations now resolve as `failure("Request was aborted")` instead of a success. `stopOnAbortSignal` makes node-llama-cpp resolve with the truncated partial response, so a cancelled or timed-out call previously surfaced as `success(output: null)` — callers recorded a null assistant turn and their timeout/retry handling never engaged. The streaming path now ends such calls with an `error` chunk instead of `done`.
- `maxTokens` defaults to 16384 when the caller sets none, as a backstop against unbounded generation: a thinking model given a degenerate prompt can spiral without terminating (169k tokens over 100 minutes observed). An explicit `maxTokens` or a defined `rawAttributes.maxTokens` overrides the default (a `rawAttributes` key set to `undefined` no longer clobbers built options).
- The shared context is created with `contextSize: { max: 32768 }`. The KV cache is allocated up front at the model's full advertised context: 9.2 GB for a 262k-context model (Qwen3.5) versus 1.7 GB at 32k, at measurably identical speed. Models advertising 32k or less (e.g. Gemma 3) are unaffected, and the `{max}` form still shrinks automatically under memory pressure. `metadata.llamaCppContextSize` overrides the cap with an exact size for hardware where a larger KV cache is worth its memory; the context is created once per model, so the first call's value wins (later mismatches warn).

## version 0.2.0 (08/11/2026)
- `LlamaCPP` accepts a path-shaped `config.model` (e.g. `/models/llama-3.gguf`): the model directory is derived automatically, so `metadata.llamaCppModelDir` is only needed for bare filenames. URI-shaped models (`hf:…`, `https:…`) are rejected with an error pointing at `resolveModel()`.
- New `resolveModel(uriOrPath, cacheDir)` export — resolves/downloads a model reference to a local `.gguf` path via node-llama-cpp's `resolveModelFile`; existing file paths are returned as absolute paths (directly consumable as `config.model`).

## version 0.1.1 (07/08/2026)
- Fix SIGSEGV in smoltalk-llama-cpp: reuse native context per model