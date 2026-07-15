# Spec review: Sanitizing `any`/empty schemas for structured output

**Reviewed spec:** `docs/superpowers/specs/2026-07-14-any-schema-structured-output-design.md`
**Date:** 2026-07-14
**Reviewer:** Claude
**Verdict:** Approve the design. Fix finding #1 (factual error in the premise + mis-specified tests) and adopt finding #2 (allowlist inversion). #3 and #4 are quick cleanups.

## Summary

The design is sound. The two-mechanism split — a recursive sanitizer for nested `any`,
and a single choke-point strip for whole-schema `any` — is clean and correctly leverages
the fact that every provider and the retry loop gate on `config.responseFormat` truthiness.

Verified gating call sites:
- `lib/clients/openai.ts:166`
- `lib/clients/openaiResponses.ts:179`
- `lib/clients/anthropic.ts:368`
- `lib/clients/google.ts:230`, `:287`, `:491`
- `lib/clients/ollama.ts:113`, `:182`
- `lib/clients/baseClient.ts:342`, `:365`

Because all of these gate on `config.responseFormat` being truthy, stripping it to
`undefined` in Mechanism 2 uniformly reverts to free-text behavior. Confirmed.

## Findings, ranked

### 1. The core premise "Zod emits a bare `{}`" is wrong for the top-level case

Empirical check (`z.any().toJSONSchema()` with the repo's Zod):

```
any        → {"$schema":"https://json-schema.org/draft/2020-12/schema"}
unknown    → {"$schema":"https://json-schema.org/draft/2020-12/schema"}
anyDesc    → {"$schema":"…","description":"notes"}
objWithAny → {…,"type":"object","properties":{"a":{"type":"string"},"b":{}},…}
record     → {"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}
tuple      → {"type":"array","prefixItems":[{"type":"string"},{}]}
numMin     → {"type":"number","minimum":0}
```

The bare `{}` **only** appears for *nested* `any` (the `b:{}` above, and the tuple
element). At the top level Zod attaches `$schema`, so `z.any()` yields `{"$schema":"…"}`,
not `{}`. This ripples through the spec:

- The Problem statement, Goal, and lines 20 & 66 all state Zod produces a bare `{}`.
  That is inaccurate for the whole-schema case that Mechanism 2 targets.
- `isUnconstrainedSchema` still works — `$schema` is not in the constraining-keyword
  list, so a `{"$schema":…}` node is correctly classified unconstrained *by absence*.
  The logic is fine, but only incidentally, and the spec never acknowledges `$schema`.
- The unit tests are built on the wrong input. Testing section (lines 145–151) uses bare
  `{}` and `{description:"x"}`. The real inputs Mechanism 2 sees are `{$schema:…}` and
  `{$schema:…, description:"notes"}`. Tests should use realistic Zod output so they
  exercise the production path — otherwise a regression that treats `$schema` as
  constraining would still pass CI.

**Fix:** correct the prose to "bare `{}` (nested) or `{$schema:…}` (top-level)", list
`$schema` explicitly as an ignored annotation, and use realistic `$schema`-bearing
fixtures in the tests.

### 2. Invert the "unconstrained" check to an annotation allowlist (robustness)

`isUnconstrainedSchema` decides *constrained* by presence of a denylist of ~17 keywords.
That list is incomplete: it omits `minLength/maxLength`, `minimum/maximum`,
`exclusiveMinimum/Maximum`, `multipleOf`, `pattern`, `minItems/maxItems`, `uniqueItems`,
`minProperties/maxProperties`, `propertyNames`, `dependentRequired`.

In practice Zod always co-emits `type` with these (`z.number().min(0)` →
`{type:"number","minimum":0}`, verified above), so from Zod-only input the risk is nil.
But the Components table (line 134) advertises this as a "pure, provider-agnostic JSON
Schema transform." Fed a hand-written `{minimum:0}`, it would misclassify it as
unconstrained and rewrite it to `{type:"string","minimum":0}`, which is nonsense.

**Fix:** flip the definition — a node is unconstrained iff it is `true`, or every own key
is in a small **annotation allowlist** (`$schema`, `description`, `title`, `default`,
`examples`, `$comment`, `readOnly`, `deprecated`, `$id`, `$anchor`). Unknown/validation
keywords then count as constraining *by default*, which is the safe direction and is
self-maintaining. This also cleanly subsumes the `$schema` handling from finding #1.

### 3. Recursion list is missing `propertyNames`

The spec claims sanitize "recurses through all subschema positions" (line 49) but the
enumerated positions (line 82) omit `propertyNames`, which Zod does emit —
`z.record(z.string(), z.any())` → `{type:"object","propertyNames":{"type":"string"},
"additionalProperties":{}}`. Impact is low (property-name subschemas are string-typed,
rarely bare `{}`), but it contradicts the "all positions" claim.

**Fix:** add `propertyNames`; optionally `if`/`then`/`else`, `dependentSchemas`,
`unevaluatedProperties/Items` for completeness, though Zod 4 does not currently emit
those.

### 4. Minor: strict + whole-schema `any` behavior isn't called out

When Mechanism 2 strips `responseFormat`, a caller who set
`responseFormatOptions.strict: true` alongside `responseFormat: z.any()` now gets raw
free-text `output` instead of a JSON-parsed value (the retry loop is skipped). This is
reasonable and intended, but the Edge cases / Testing sections don't mention the
interaction.

**Fix:** add one line documenting the decision so it's not a surprise.

## What's correct and doesn't need changing

- `.toJSONSchema()` call sites in the spec (lines 89–93, 98–101) match reality exactly,
  including both Google structured-output requests. Google tools are transitively covered
  via `zodToOpenAITool` → `openAIToGoogleTool` — confirmed in `lib/util/tool.ts:249-271`.
- The `additionalProperties: true/false` left-as-boolean vs object-`{}`-sanitized
  distinction (lines 71–74) is exactly right and important. Rewriting
  `additionalProperties: true` → `{type:"string"}` would silently change semantics.
- Idempotency reasoning holds: `{}` → `{type:"string"}`; a second pass sees `type` →
  untouched.
- Mechanism 2 at the BaseClient choke point mirroring `prepareAttachments` is the right
  shape — both `textSync` (`baseClient.ts:127`) and `textStream` (`:443`) already funnel
  through that pattern.
