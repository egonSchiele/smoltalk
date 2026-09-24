## version 0.7.0 (09/24/2026)
- `thinking` and `reasoningEffort` are honoured. `thinking.enabled: false` turns thinking off through the chat wrapper's own switch (Qwen, Gemma 4, Seed; Harmony gets its lowest effort; DeepSeek gets a zero budget). `thinking.budgetTokens` caps the thought block through node-llama-cpp's `budgets.thoughtTokens`, and an effort maps to the budgets the other clients use (2048, 8192, 16384). The grammar for a typed reply is built for the same wrapper the chat uses.
- Speculative decoding: `metadata.llamaCppDraftModel` names a smaller model of the same family to draft tokens for the main one, through node-llama-cpp's `DraftSequenceTokenPredictor`. First call per model wins, like the context size; the draft is disposed with the main model.

