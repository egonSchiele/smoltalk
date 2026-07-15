# Sanitizing `any`/empty schemas for structured output

**Date:** 2026-07-14
**Status:** Approved — ready for implementation plan

## Problem

Structured output is driven by a Zod schema (`SmolConfig.responseFormat`), converted
to JSON Schema via `schema.toJSONSchema()` and handed to each provider's native
structured-output mechanism. Tool/function parameters follow the same path through
`lib/util/tool.ts`.

Zod converts `z.any()` (and `z.unknown()`) to a schema that constrains nothing. An
unconstrained schema — a bare `{}`, or equivalently the boolean schema `true` — is the
canonical JSON Schema for "accept any value." That is a *correct* JSON Schema, but
**every provider refuses an unconstrained node in a structured-output / strict-tool
schema**, returning a 400. This is reasonable: the point of structured output is that it
is structured, so "any" is meaningless there.

**How Zod actually emits it** (verified against the repo's Zod, draft 2020-12):

```
any         {"$schema":"…"}
unknown     {"$schema":"…"}
anyDesc     {"$schema":"…","description":"notes"}
objWithAny  {"$schema":"…","type":"object","properties":{"a":{"type":"string"},"b":{}},"required":["a","b"],"additionalProperties":false}
record      {"$schema":"…","type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}
tuple       {"$schema":"…","type":"array","prefixItems":[{"type":"string"},{}]}
numMin      {"$schema":"…","type":"number","minimum":0}
```

Two things to note:

- **Top-level `any` is `{"$schema":…}`, not a bare `{}`.** Zod attaches the `$schema`
  annotation at the root. A bare `{}` appears only in *nested* positions (`objWithAny`'s
  `b:{}`, the tuple element, `record`'s `additionalProperties:{}`).
- **Zod always co-emits `type` with validation keywords** (`numMin` →
  `{type:"number","minimum":0}`). So a validation keyword never appears alone from Zod.

Today, passing `responseFormat: z.any()`, or a schema containing a nested `z.any()`
field, produces an unconstrained node in the emitted JSON Schema and the provider
request fails.

## Goal

Two independent fixes:

1. **Never emit an unconstrained node in a schema position.** Map any unconstrained
   schema node (`{}`, `true`, or a node carrying only annotations like `{$schema:…}` /
   `{description:…}`) to `{ "type": "string" }` — the safe universal container. Applies
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

**"Unconstrained" definition (annotation allowlist).** A node is unconstrained when it
is the boolean `true`, or a plain object **every own key of which is a pure annotation**:

```
$schema, $id, $anchor, $comment, description, title, default, examples, readOnly, deprecated
```

Any other key — `type`, `properties`, `items`, `enum`, `$ref`, `anyOf`, a validation
keyword like `minimum`/`minLength`/`pattern`, anything not in the allowlist — makes the
node **constrained**. This is deliberately an allowlist, not a denylist of structural
keywords: unknown/future/validation keywords count as constraining *by default*, which is
the safe direction (never rewrite a schema that means something) and is self-maintaining
as JSON Schema evolves.

This cleanly handles the real Zod output:
- `{}` and `true` → unconstrained (vacuously / by definition).
- `{$schema:…}` (top-level `any`) → unconstrained — every key is an annotation.
- `{$schema:…, description:"notes"}` (`z.any().describe`) → unconstrained.
- `{$schema:…, type:"object", …}` (a real object) → constrained (`type` present).
- A hand-written `{minimum:0}` → constrained (safe: not rewritten to nonsense).

**`true` vs `{}`.** In JSON Schema, `true` is the boolean schema that accepts any value
— semantically identical to `{}` (and `false` is its opposite: accept nothing). In a
genuine schema position (a property value, `items`, an `anyOf` branch, a `$defs` entry)
`true` is treated exactly like `{}` → `{"type":"string"}`. Zod emits `{$schema:…}`
(top-level) or a bare `{}` (nested) for `z.any()`/`z.unknown()`, never `true`, but
handling `true` defensively is correct and cheap. `false` is left as-is (it is
constrained — it rejects everything).

**`additionalProperties` exception.** `additionalProperties: true` / `false` is a
legitimate boolean flag every provider accepts ("extra keys allowed / not allowed"),
**not** an any-typed value slot. It is left as-is. Only an *object* `additionalProperties: {}`
is sanitized, like any other schema position. Rewriting `additionalProperties: true`
→ `{type:"string"}` would silently change "extra properties can be anything" into
"extra properties must be strings" — wrong, and unnecessary.

**Metadata preservation.** When a node is unconstrained, `type: "string"` is merged in
rather than replacing the node, so all annotation keys survive — a nested
`z.any().describe("notes")` (`{description:"notes"}`) → `{description:"notes",
type:"string"}`, and top-level `{$schema:…, description:"notes"}` → `{$schema:…,
description:"notes", type:"string"}`. A boolean `true` node → `{type:"string"}`.

**Recursion positions.** `properties` (object of schemas), `items` (schema or array),
`prefixItems`, `patternProperties`, `propertyNames`, `additionalProperties` (only when
an object), `contains`, `anyOf`/`oneOf`/`allOf` (arrays), `not`, `$defs`/`definitions`.
(`if`/`then`/`else`, `dependentSchemas`, `unevaluatedProperties`/`Items` are valid
subschema positions too but Zod 4 does not currently emit them; recursing into them is a
cheap forward-looking addition, not a requirement.)

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

Fixtures use **real `.toJSONSchema()` output** (with the `$schema` annotation Zod
attaches), not hand-simplified `{}`, so the tests exercise the production input. Drive
them from actual Zod values (`z.any()`, `z.object({a:z.string(), b:z.any()})`,
`z.tuple([...])`, `z.record(z.string(), z.any())`) where practical.

**Unit — `jsonSchema.ts` (core logic):**
- `sanitizeJsonSchema`: nested property `any` (`z.object({a:z.string(), b:z.any()})` →
  `b:{type:"string"}`); array element `any` (`z.tuple`) → `{type:"string"}`;
  `z.record(z.string(), z.any())` → `additionalProperties:{type:"string"}` while
  `propertyNames` stays `{type:"string"}`; bare `{}` and `true` in a schema position →
  `{type:"string"}`; `anyOf` branch that is `{}`; preserves `description`/`title`
  (and `$schema`); leaves a real `{type:"object", properties:{…}}` untouched; idempotent
  (running twice is a no-op); `additionalProperties: true` left as boolean;
  `additionalProperties: {}` → `{type:"string"}`.
- `isUnconstrainedSchema`: true for `{}`, `true`, `{$schema:…}` (top-level `z.any()`),
  `{$schema:…, description:"notes"}`; false for `{type:"string"}`, `{minimum:0}`,
  `{anyOf:[…]}`, `{properties:{…}}`, `false`.

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
- **`strict` + whole-schema `any`.** A caller who sets `responseFormatOptions.strict:
  true` alongside `responseFormat: z.any()` gets raw free-text `output`, not a
  JSON-parsed value: Mechanism 2 strips `responseFormat`, so the strict parse/retry loop
  is skipped. This is intended — there is nothing to validate against `any` — but it is
  called out here so the interaction isn't a surprise.

## Out of scope

- Changing which providers support native structured output.
- Any change to how non-`any` schemas are emitted today.
- Inferring a smarter type than `string` for an `any` slot (string is the deliberate
  universal container).
