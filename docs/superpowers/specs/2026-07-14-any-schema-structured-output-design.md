# Sanitizing `any`/empty schemas for structured output

**Date:** 2026-07-14
**Status:** Approved — ready for implementation plan

## Problem

Structured output is driven by a Zod schema (`SmolConfig.responseFormat`), converted
to JSON Schema via `schema.toJSONSchema()` and handed to each provider's native
structured-output mechanism. Tool/function parameters follow the same path through
`lib/util/tool.ts`.

Zod correctly converts `z.any()` (and `z.unknown()`) to `{}`. An empty schema `{}`
— equivalently the boolean schema `true` — is the canonical JSON Schema for "accept
any value." That is a *correct* JSON Schema, but **every provider refuses a bare `{}`
in a structured-output / strict-tool schema**, returning a 400. This is reasonable:
the point of structured output is that it is structured, so "any" is meaningless there.

Today, passing `responseFormat: z.any()`, or a schema containing a nested `z.any()`
field, produces a bare `{}` in the emitted JSON Schema and the provider request fails.

## Goal

Two independent fixes:

1. **Never emit a bare `{}` in a schema position.** Map any unconstrained schema node
   (`{}` or `true`) to `{ "type": "string" }` — the safe universal container. Applies
   to both `responseFormat` schemas and tool parameter schemas.
2. **If the *entire* response schema is `any`, omit structured output.** Behave exactly
   as if `responseFormat` were never set: send no structured-output params, skip the
   strict parse/retry loop, and return free text.

## Design

Two distinct problems get two distinct mechanisms.

### Mechanism 1 — recursive sanitizer (nested `any` → `{"type":"string"}`)

New shared module `lib/util/jsonSchema.ts` with two exports:

```ts
// True if this node accepts any value: `true`, or an object carrying none of the
// structural/typing keywords below.
export function isUnconstrainedSchema(node: unknown): boolean;

// Returns a new schema with every unconstrained node replaced by {type:"string"},
// preserving metadata (description/title) when present. Recurses through all
// subschema positions. Idempotent.
export function sanitizeJsonSchema(node: unknown): unknown;
```

**"Unconstrained" definition.** A node is unconstrained when it is the boolean `true`,
or a plain object carrying **none** of these constraining keywords:

```
type, enum, const, $ref,
anyOf, oneOf, allOf, not,
properties, items, prefixItems, patternProperties, additionalProperties,
required, format, contains
```

**`true` vs `{}`.** In JSON Schema, `true` is the boolean schema that accepts any value
— semantically identical to `{}` (and `false` is its opposite: accept nothing). In a
genuine schema position (a property value, `items`, an `anyOf` branch, a `$defs` entry)
`true` is treated exactly like `{}` → `{"type":"string"}`. Zod emits `{}` (not `true`)
for `z.any()`/`z.unknown()`, but handling `true` defensively is correct and cheap.
`false` is left as-is (it is constrained — it rejects everything).

**`additionalProperties` exception.** `additionalProperties: true` / `false` is a
legitimate boolean flag every provider accepts ("extra keys allowed / not allowed"),
**not** an any-typed value slot. It is left as-is. Only an *object* `additionalProperties: {}`
is sanitized, like any other schema position. Rewriting `additionalProperties: true`
→ `{type:"string"}` would silently change "extra properties can be anything" into
"extra properties must be strings" — wrong, and unnecessary.

**Metadata preservation.** When a node is unconstrained, `type: "string"` is merged in
rather than replacing the node, so `z.any().describe("notes")` (`{description:"notes"}`)
→ `{description:"notes", type:"string"}`. A boolean `true` node → `{type:"string"}`.

**Recursion positions.** `properties` (object of schemas), `items` (schema or array),
`prefixItems`, `patternProperties`, `additionalProperties` (only when an object),
`contains`, `anyOf`/`oneOf`/`allOf` (arrays), `not`, `$defs`/`definitions`.

**Applied at both conversion boundaries:**

- **responseFormat:** a shared helper `responseFormatToJsonSchema(zodType)` =
  `sanitizeJsonSchema(zodType.toJSONSchema())`, replacing the inline
  `config.responseFormat.toJSONSchema()` calls that build provider requests:
  - `lib/clients/openai.ts` (~172)
  - `lib/clients/openaiResponses.ts` (~184)
  - `lib/clients/anthropic.ts` (~370)
  - `lib/clients/google.ts` (~232, and the second structured-output request ~306+)
  - `lib/clients/ollama.ts` (~114 sync, ~183 stream)

  (`google.ts:306` is a debug-log line — cosmetic, may update for consistency but is
  not request-building.)

- **Tools:** call `sanitizeJsonSchema` inside `zodToOpenAITool`,
  `zodToOpenAIResponsesTool`, and `zodToAnthropicTool` in `lib/util/tool.ts`. Google
  tools route through `zodToOpenAITool` (via `openAIToGoogleTool`), so they are covered
  transitively.

### Mechanism 2 — whole-schema `any` → omit structured output (single choke point)

Handled once in `BaseClient`, **not** per provider. A `normalizeResponseFormat(config)`
step is called from both `textSync` and `textStream` (mirroring the existing
`prepareAttachments` pattern):

```
if config.responseFormat is set
   and isUnconstrainedSchema(config.responseFormat.toJSONSchema()):
       return { ...config, responseFormat: undefined }
```

Because `responseFormat` is gone before dispatch, every downstream path treats the call
as free text automatically:

- No provider builds a structured-output request (each gates on `config.responseFormat`).
- The strict parse/retry loop in `textWithRetry` is skipped (it also gates on
  `config.responseFormat` being set) — so free text is returned as-is instead of being
  JSON-parsed and failing.

This is the "treat as no responseFormat" behavior at a single point, rather than a
whole-schema check duplicated in each client.

**Top-level only.** Mechanism 2 fires only when the *entire* top-level schema is
unconstrained. A nested `any` inside an otherwise-real object is handled by Mechanism 1
(sanitized to `{type:"string"}`), never stripped.

## Components & interfaces

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/util/jsonSchema.ts` | `isUnconstrainedSchema`, `sanitizeJsonSchema` — pure, provider-agnostic JSON Schema transforms | nothing |
| `lib/util/tool.ts` | Sanitize tool parameter schemas at conversion time | `jsonSchema.ts` |
| Provider clients | Use `responseFormatToJsonSchema` (sanitized) for structured-output requests | `jsonSchema.ts` |
| `BaseClient` | `normalizeResponseFormat` — strip whole-schema `any` before dispatch | `jsonSchema.ts` |

`responseFormatToJsonSchema` lives alongside the sanitizer (either in `jsonSchema.ts`
or `tool.ts` — implementation detail for the plan).

## Testing

**Unit — `jsonSchema.ts` (core logic):**
- `sanitizeJsonSchema`: `{}` → `{type:"string"}`; `true` → `{type:"string"}`; nested
  property `any`; array `items` any; `anyOf` branch that is `{}`; preserves
  `description`/`title`; leaves a real `{type:"object", properties:{…}}` untouched;
  idempotent (running twice is a no-op); `additionalProperties: true` left as boolean;
  `additionalProperties: {}` → `{type:"string"}`.
- `isUnconstrainedSchema`: true for `{}`, `true`, `{description:"x"}`; false for
  `{type:"string"}`, `{anyOf:[…]}`, `{properties:{…}}`, `false`.

**Integration:**
- Tool conversion: `zodToOpenAITool` / `zodToOpenAIResponsesTool` / `zodToAnthropicTool`
  with a `z.any()` field → that property is `{type:"string"}`, not `{}`.
- Base-client normalize: `responseFormat: z.any()` → downstream config has
  `responseFormat` stripped; no structured-output params reach the provider and no
  strict retry runs (verify via a capturing fake client).
- One representative provider build test (e.g. Anthropic `buildRequest`) with a
  nested-`any` `responseFormat` → emitted schema contains no bare `{}`.

## Edge cases

- `z.any().describe("notes")` → `{description:"notes", type:"string"}`.
- `z.unknown()` behaves identically to `z.any()` (both emit `{}`).
- `false` schema (accept-nothing) left as-is.
- `additionalProperties: true`/`false` left as-is; object `additionalProperties: {}`
  sanitized.
- Whole-schema strip fires at top level only; nested `any` is sanitized, not stripped.

## Out of scope

- Changing which providers support native structured output.
- Any change to how non-`any` schemas are emitted today.
- Inferring a smarter type than `string` for an `any` slot (string is the deliberate
  universal container).
