# Merge consecutive same-role messages for Anthropic

**Date:** 2026-07-02
**Status:** Approved (defaults chosen while user away — Anthropic-only, any-consecutive-same-role)

## Problem

Anthropic's Messages API requires strict `user`/`assistant` turn alternation:
two messages that map to the same role in a row are rejected. Smoltalk aims to
present a unified interface across providers that do *not* all share this
constraint (OpenAI, Ollama tolerate consecutive same-role messages), so callers
can legitimately build a message list with, e.g., two `UserMessage`s in a row.

The Anthropic client (`lib/clients/anthropic.ts`) today merges only one narrow
case: consecutive user messages whose content is *entirely* `tool_result`
blocks. It does **not** merge:

- two plain `UserMessage`s,
- a `UserMessage` followed by a `ToolMessage` (both convert to Anthropic
  `role: "user"`),
- consecutive `AssistantMessage`s.

All of these currently produce an API error.

## Scope

- **Providers:** Anthropic only. It is the only current provider that hard-fails
  on non-alternating turns. (OpenAI/Ollama tolerate it; the `@google/genai` SDK
  is lenient. Google can be revisited separately if needed.)
- **Merge rule:** any run of consecutive messages that convert to the *same*
  Anthropic role is collapsed into one message. Generalizes and replaces the
  existing `tool_result`-only special case.

## Design

Add a small, pure, exported helper in `lib/clients/anthropic.ts`:

```ts
export function mergeConsecutiveMessages(messages: MessageParam[]): MessageParam[]
```

- Walks the converted `MessageParam[]`.
- When the current message's `role` equals the previous *kept* message's role,
  concatenate their content and replace the previous entry (no in-place
  mutation of the input).
- Content normalization: string content is promoted to a single
  `{ type: "text", text }` block before concatenation; an empty string becomes
  `[]` (Anthropic rejects empty text blocks). Array content is used as-is.
- Roles differ → push as a new message.

`buildRequest` changes: convert each non-system/developer message via
`toAnthropicMessage()` into a flat array, then pass it through
`mergeConsecutiveMessages`. The old inline `tool_result`-only block (anthropic.ts
~267–296) is removed — the general helper subsumes it (a run of tool_result-only
user messages still merges, plus every other same-role case).

Ordering stays natural: `assistant(tool_use)` → `ToolMessage`(s) →
`UserMessage` merges the tool-result user turn and the text user turn into one
`[...tool_result, text]` user message, with tool_result blocks first (as
Anthropic requires), because the tool messages precede the user message in the
list.

`applyCacheBreakpoints` runs downstream on the merged array and already handles
both string and array content, so it is unaffected.

## Testing

- Unit tests on `mergeConsecutiveMessages` directly: two user strings → one
  message with two text blocks; user string + tool_result-only user → one
  message `[text, tool_result]`; two assistant strings → one; alternating input
  left unchanged; empty-string content dropped, not emitted as empty text block.
- `buildRequest` integration tests: two consecutive `userMessage(...)` in
  `config.messages` yield a single Anthropic user message; existing
  cache_control / thinking tests still pass (regression).

## Out of scope

- Google/other providers.
- Merging *content-level* semantics beyond concatenation (e.g. joining adjacent
  text blocks into one string) — concatenated blocks are valid Anthropic input.
