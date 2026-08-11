## version 0.2.0 (11/08/2026)
- `LlamaCPP` accepts a path-shaped `config.model` (e.g. `/models/llama-3.gguf`): the model directory is derived automatically, so `metadata.llamaCppModelDir` is only needed for bare filenames. URI-shaped models (`hf:…`, `https:…`) are rejected with an error pointing at `resolveModel()`.
- New `resolveModel(uriOrPath, cacheDir)` export — resolves/downloads a model reference to a local `.gguf` path via node-llama-cpp's `resolveModelFile`; existing file paths are returned as absolute paths (directly consumable as `config.model`).

## version 0.1.1 (07/08/2026)
- Fix SIGSEGV in smoltalk-llama-cpp: reuse native context per model