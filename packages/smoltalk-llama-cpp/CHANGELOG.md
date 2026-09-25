## version 0.7.2 (09/25/2026)
- A typed reply from a model told not to think is held to the schema from its first token. The grammar used to offer the thought block as an option, and Qwen3.5 and Gemma 4 took it: they opened the block, wrote their answer as prose inside, and never closed it, so the JSON never came. A wrapper that opens the block on every reply regardless (DeepSeek) still gets to close it first.
- A schema's `anyOf` is rewritten as `oneOf`, or as an `enum` when every alternative is a string constant, before the grammar is built. node-llama-cpp's grammar builder does not read `anyOf` and quietly treated the field as any JSON value, so a union of string literals, which is what zod writes for one, came back as `null`.
- A chain of tool calls is shown to the model as one turn. smoltalk's tool loop records each round as its own assistant message, and Gemma 4, shown its own chain as separate turns, ended the next turn at once and never answered.
- Gemma 4's wrapper gets the tool markers from the model's own chat template: `<|tool_response>response:name{value:...}<tool_response|>` around a result, and single braces around a call's parameters. node-llama-cpp 3.21.1 spells them differently, and the model stopped answering after a tool result written its way. A Gemma 4 model is always given a resolved wrapper for this, even when the call says nothing about thinking.

## version 0.7.1 (09/24/2026)
- `metadata.llamaCppChatWrapper` names the chat wrapper to use instead of the one node-llama-cpp detects, for a model whose template it gets wrong; the thinking settings and the typed-reply grammar follow it.

## version 0.7.0 (09/24/2026)
- `thinking` and `reasoningEffort` are honoured. `thinking.enabled: false` turns thinking off through the chat wrapper's own switch (Qwen, Gemma 4, Seed; Harmony gets its lowest effort; DeepSeek gets a zero budget). `thinking.budgetTokens` caps the thought block through node-llama-cpp's `budgets.thoughtTokens`, and an effort maps to the budgets the other clients use (2048, 8192, 16384). The grammar for a typed reply is built for the same wrapper the chat uses.
- Speculative decoding: `metadata.llamaCppDraftModel` names a smaller model of the same family to draft tokens for the main one, through node-llama-cpp's `DraftSequenceTokenPredictor`. First call per model wins, like the context size; the draft is disposed with the main model.
- A call that says nothing about thinking now passes an empty `budgets` object, so node-llama-cpp's own default thought budget (three quarters of the context) applies; before, `LlamaChat` had no budget at all without one. A budget that would leave no room for the answer is clamped, or `maxTokens` raised when the call set none, with a warning either way.
- The draft is checked against the main model when it loads (vocabulary type, BOS and EOS tokens, and whether they are added), so a mismatch fails the load instead of poisoning the cached model. The draft's context is sized like the main model's. A relative draft path resolves against the model directory. `metadata.llamaCppDraftOptions` passes `maxTokens` and `minConfidence` to the predictor, and the draft's validated and refuted counts are logged at debug level after each call.
- The chat wrapper a thinking setting resolves is kept per model, so the Jinja search runs once per setting rather than once per call.
- A call with a temperature above zero on a drafted Qwen3.5 model is refused with an error, since node-llama-cpp 3.21's draft predictor never returned when that family sampled. Other families get a warning once per model, because a Qwen3 pair returned as usual. `llamaCppDraftOptions.allowSampling: true` turns both off.

## version 0.6.0 (09/23/2026)
- A typed reply (`responseFormat`) from a thinking model now comes back as JSON. The grammar lets the model think up to the token that closes its thought block, then holds the rest to the schema (`lib/thinkingGrammar.ts`).
- Applies to the Qwen, DeepSeek, Seed, and Gemma 4 wrappers; other wrappers keep the plain schema grammar.
- An empty tool list no longer drops the grammar.
- Requires node-llama-cpp 3.21.1 or later.

## version 0.5.0 (09/14/2026)
- New `embed` export: embeddings computed in process through node-llama-cpp's `createEmbeddingContext`. smoltalk 0.14.0 registers it under the `llama-cpp` provider, so `embed(text, { provider: "llama-cpp", model: "/path/model.gguf" })` works with no wiring. One embedding context per model file, kept until `disposeAll()`/`disposeModel()` like the chat contexts; calls on one model run one at a time. `dimensions` truncates and renormalizes. Zero cost. A URI-shaped model is refused with the same `resolveModel()` hint the chat client gives.

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