# CLAUDE.md

## Project Overview

Smoltalk is a TypeScript npm package providing a unified interface across multiple LLM providers (OpenAI, Google Gemini, Anthropic, Ollama). It prevents vendor lock-in by letting users switch providers with minimal code changes.

## Quick Reference

```bash
pnpm build        # Clean build (rm -rf dist && tsc)
pnpm test         # Run vitest
pnpm typecheck    # tsc --noEmit
pnpm start        # Run dist/index.js
```

## Project Structure

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
├── functions.ts       # Public wrapper functions (text, prompt, textSync, textStream)
├── client.ts          # getClient() factory - routes to correct provider
├── types/result.ts    # Result<T> = Success<T> | Failure discriminated union
├── util/tool.ts       # Zod-to-provider schema conversion (zodToOpenAITool, zodToGoogleTool, etc.)
├── logger.ts          # Logging singleton (egonlog)
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

## Adding a New Provider

1. Create `lib/clients/newprovider.ts` extending `BaseClient`
2. Implement `_textSync()` and `_textStream()`
3. Add conversion methods to each message class in `lib/classes/message/`
4. Add conversion function in `lib/util/tool.ts` if tool format differs
5. Add provider to `getClient()` switch in `lib/client.ts`
6. Add models to the registry in `lib/models.ts`

## Dependencies

- **Package manager**: pnpm

## Testing
Put test files alongside implementation with `.test.ts` suffix. Use `vitest` for testing.

```bash
pnpm test
```