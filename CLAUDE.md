# CLAUDE.md

## Project Overview

Smoltalk is a TypeScript npm package providing a unified interface across multiple LLM providers (OpenAI, Google Gemini, Anthropic, Ollama). It prevents vendor lock-in by letting users switch providers with minimal code changes.

## Quick Reference

```bash
pnpm install      # Install all workspace deps
pnpm --filter smoltalk build   # Required first on a clean checkout — see below
pnpm build        # Build all workspace packages
pnpm test         # Run vitest across packages
pnpm typecheck    # tsc --noEmit across packages

# Make shortcuts (recurse into each package)
make              # Build all packages (alias for `make all`)
make test         # Run tests in all packages
make publish      # Build then `pnpm publish` in each package
```

`pnpm test` and `pnpm typecheck` need `packages/smoltalk/dist/` to exist: the
plugin packages and the site all resolve smoltalk's types through it, and
`dist` is gitignored. Build smoltalk once after cloning. Do **not** add
`pretest`/`pretypecheck` hooks to the dependent packages to automate this —
smoltalk's build starts with `rm -rf dist`, and under a parallel `pnpm -r`
that races with smoltalk-llama-cpp's loader test importing `dist/index.js`.
CI builds smoltalk explicitly first for this reason.

This repo is a pnpm workspace monorepo:

- `packages/smoltalk/` — core library (cloud providers: OpenAI, Anthropic, Google, Ollama)
- `packages/smoltalk-llama-cpp/` — `node-llama-cpp` plugin for local models
- `packages/smoltalk-webllm/` — `@mlc-ai/web-llm` plugin for browser/WebGPU inference
- `site/` — static Vite/React site listing the model registry (deployed to Vercel).
  It imports the catalog from the `smoltalk/models` entry point; see `site/README.md`.

## Project Structure (within `packages/smoltalk/`)

```
lib/
├── clients/           # Provider implementations
│   ├── baseClient.ts  # Abstract base with shared logic (retries, tool loop detection)
│   ├── openai.ts      # OpenAI Chat Completions API
│   ├── openaiResponses.ts  # OpenAI Responses API
│   ├── google.ts      # Google Gemini via @google/genai
│   └── ollama.ts      # Ollama (local or cloud)
├── classes/
│   ├── ToolCall.ts    # Tool call representation
│   └── message/       # Polymorphic message classes (User, Assistant, System, Developer, Tool)
├── types.ts           # Core types (SmolConfig, PromptResult, StreamChunk)
├── models.ts          # Model registry with pricing/token limits
├── functions.ts       # Public wrapper functions (text, textSync, textStream)
├── client.ts          # getClient() factory + registerProvider() for plugins
├── types/result.ts    # Result<T> = Success<T> | Failure discriminated union
├── util/tool.ts       # Zod-to-provider schema conversion
├── util/logger.ts     # Logging (EgonLog class, inlined — no external dep)
├── smolError.ts       # Custom error class
└── util.ts            # Small utilities (rounding)
```

## Architecture

- **SmolClient interface** (`types.ts`): Contract all providers implement — `text()`, `textSync()`, `textStream()`
- **BaseClient** (`baseClient.ts`): Abstract class with shared behavior — response format validation/retries, tool loop detection, stream/sync dispatching
- **Provider clients**: Each extends BaseClient, overrides `_textSync()` and `_textStream()`
- **Message classes**: Each message type (UserMessage, AssistantMessage, etc.) has `toOpenAIMessage()`, `toOpenAIResponseInputItem()`, `toGoogleMessage()`, `toOllamaMessage()` — format conversion is encapsulated in the message, not the client
- **Tool/schema conversion**: Zod schemas are the single source of truth; `lib/util/tool.ts` converts them to each provider's format

## Key Patterns

- **Result type**: Operations return `Result<T>` (success/failure union) instead of throwing
- **Streaming**: All providers yield `AsyncGenerator<StreamChunk>` with chunk types: `text`, `thinking`, `tool_call`, `done`, `error`
- **Cost tracking**: Every response includes token usage and cost estimates from `models.ts` pricing data
- **ES Modules**: Package uses `"type": "module"` — all internal imports use `.js` extensions
- **Strict TypeScript**: `strict: true`, target ESNext, module nodenext

## Thought Signatures / Extended Thinking

Two providers support returning encrypted reasoning state alongside responses:

- **Anthropic** (`claude-opus-4-5`, `claude-sonnet-*`, etc.): Enable via `thinking: { enabled: true, budgetTokens: 5000 }` in `SmolConfig`. Returns `ThinkingBlock[]` in `PromptResult.thinkingBlocks`. Each block has `text` (the visible reasoning) and `signature` (encrypted verification token).
- **Google Gemini** (Gemini 3+ models): Thought signatures are returned automatically on thinking models. Parts with `thought: true` are captured into `PromptResult.thinkingBlocks`.
- **OpenAI**: No equivalent — o1/o3 reasoning is fully hidden.

**Round-tripping**: `AssistantMessage` stores `thinkingBlocks` and passes them back per provider:
- `toAnthropicMessage()` prepends `{ type: "thinking", thinking, signature }` blocks (required by Anthropic during tool use)
- `toGoogleMessage()` prepends `{ thought: true, text, thoughtSignature }` parts (required by Gemini 3+ during tool use)

**Usage**:
```typescript
const result = await textSync("Solve this step by step", {
  model: "claude-opus-4-5",
  thinking: { enabled: true, budgetTokens: 8000 },
});
// result.thinkingBlocks → [{ text: "Let me think...", signature: "WaUj..." }]
```

## Logprobs

`logprobs: { top? }` on `SmolConfig` asks for each generated token's log
probability. OpenAI Chat Completions (`logprobs`/`top_logprobs`), OpenAI
Responses (`include: ["message.output_text.logprobs"]`/`top_logprobs`),
and Google (`responseLogprobs`/`logprobs`) honour it; every other provider
ignores it and returns no field. The result is `PromptResult.logprobs`, an
array of `TokenLogprob` (`{ token, logprob, top? }`), the same shape from
every provider. Every translation from a wire shape lives in
`lib/clients/logprobs.ts`; a client only collects raw pieces and calls in.
The streaming path accumulates per-chunk pieces and puts the whole array
on the `done` result. Gemini's streamed `logprobsResult` pieces are treated
as **deltas** (each chunk covers only its own tokens, like OpenAI's chat
stream) — this is assumed, **not yet verified against a real streamed Gemini
call** (no key available at implementation time, 2026-09-26); if a real run
shows the pieces are cumulative, `mergeGoogleLogprobs` must instead keep the
last piece. `AssistantMessage.logprobs` carries it and `toJSON` and
`AssistantMessageJSONSchema` both know it, so it survives a checkpoint.

## Decision models

`decide(state, questions, config)` in `lib/decide.ts` asks a decision model
(TypeSafe's Jev, or a Laya server) typed `noul`/`choice`/`score` questions and
returns answers with probabilities. It follows the `embed()` shape: payload
first, config last, provider/key/base URL through `lib/util/provider.ts`. The
one provider is `typesafe`, which is the wire protocol; a Laya server is
reached with `baseUrl.typesafe`. Cost is priced by the requested model's
registry entry (`decisionModels` in `lib/models.ts`), so an unknown model has
no cost. `PromptResult.rawData` exists so a caller can carry the full answers
onto an assistant message.

## Files API

`uploadFile(source, { provider })` uploads a file to a provider's Files API and
returns a `ProviderFileRef` usable directly as an attachment (`filePart(ref)` /
`imagePart(ref)`). `deleteFile(ref)` removes it. `registerFileProvider(name, impl)`
adds a custom provider. Built-ins: openai, anthropic, google (others → Failure).
OpenAI image-by-file_id requires the `openai-responses` provider.

**Lifecycle (caller-owned):** uploaded files persist until you call `deleteFile`
— OpenAI keeps them indefinitely (storage bills accrue), Anthropic applies a
retention window (a cached ref can 404 later), Google auto-expires ~48 h
(surfaced as `ProviderFileRef.expiresAt`). No list/GC helper in v1.

**When to use it:** prefer `uploadFile` for files more than a few MB — it sends
bytes directly, avoiding the ~1.3× base64 round-trip that inline attachments
(bytes → base64 → provider) pay. Default size cap 100 MB (`opts.maxBytes`).

**Security:** `{ kind: "path" }` reads any process-readable file and
`{ kind: "url" }` fetches arbitrary http(s) URLs — do not pass untrusted paths
or URLs. See `lib/files.ts` and `docs/superpowers/specs/2026-06-30-files-api-design.md`.

## Custom Models & Pricing

Cost tracking reads pricing from the model registry in `lib/models.ts`.
`Model.calculateCost()` (`lib/model.ts`) computes cost from the merged registry
entry; an unknown model (or one with no `*TokenCost` fields) returns `null`, and
`PromptResult.cost` is then omitted — no error.

Three ways to supply pricing for a model not in the baked-in catalog, all public:

- **`registerTextModel({...})`** — append one text model at startup. Needs
  `modelName`, `provider`, `maxInputTokens`, `maxOutputTokens` (type required)
  plus the `*TokenCost` fields you want tracked.
- **`registerModelData(blob)`** — register a full `ModelDataBlob` globally (same
  blob shape `refreshModels()` returns).
- **`config.modelData`** — layer a blob over the baseline for a single call.

Precedence: per-call `config.modelData` > `registerModelData` (global) > baked-in
baseline, deep-merged field-by-field. **The merge key is `provider:modelName`**,
so the registered `provider` must match the `provider` used at call time or the
lookup misses and cost is silently dropped. See the "Custom models & pricing"
section in `packages/smoltalk/README.md` for examples, and `mergeModelData` /
`getModel` in `lib/models.ts` + `lib/modelData.ts`.

## Adding a New Provider

There are two paths: **in-tree** (built into smoltalk core, like OpenAI/Anthropic/Google/Ollama) or **external plugin** (a separate package, like `smoltalk-llama-cpp`).

### In-tree (built-in providers only)

1. Create `lib/clients/newprovider.ts` extending `BaseClient`
2. Implement `_textSync()` and `_textStream()`
3. Add conversion methods to each message class in `lib/classes/message/`
4. Add conversion function in `lib/util/tool.ts` if tool format differs
5. Add provider to `getClient()` switch in `lib/client.ts`
6. Add models to the registry in `lib/models.ts`

### External plugin

1. Create a new package that depends on `smoltalk` as a peer dependency
2. Implement a class that extends `BaseClient` (imported from `smoltalk`)
3. Export the class from your package
4. Users register it at runtime: `registerProvider("your-provider-name", YourClient)` before calling `text()`/etc.

Plugins read provider-specific config via `config.metadata` rather than top-level `SmolConfig` fields. See `packages/smoltalk-llama-cpp/` for a worked example.

## Dependencies

- **Package manager**: pnpm

## Testing
Put test files alongside implementation with `.test.ts` suffix. Use `vitest` for testing.

```bash
pnpm test
```