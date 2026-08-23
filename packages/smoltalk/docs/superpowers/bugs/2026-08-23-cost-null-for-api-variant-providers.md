# Bug: no cost computed when the provider is an API-variant name like "openai-responses"

Written 2026-08-23 as a handoff from an agency-lang session; the fix should
happen here in smoltalk. Reported symptom in agency-lang: `agency eval run`
prints `total LLM cost: $0.00` and every `promptCompletion` statelog event
carries `usage` but no `cost` object, for calls on `gpt-5-mini` through the
`openai-responses` provider.

## Root cause

`Model.calculateCost` (`packages/smoltalk/lib/model.ts:47`) looks the model
up differently depending on whether the client was built with an explicit
provider:

- provider set → `getModelForProvider(this.provider, this.model, ...)`
  (`model.ts:64`), which requires an exact `model.provider === provider`
  match (`packages/smoltalk/lib/models.ts:2113`).
- provider unset → `getModel(this.model, ...)`, keyed by model name.

The catalog keys models by provider FAMILY: `gpt-5-mini` is listed under
`"openai"`. A client configured with `provider: "openai-responses"` (the
API-variant name) therefore finds no catalog entry, `calculateCost` returns
`null`, and the client emits no cost at all — even though the catalog has
full pricing for the model (input 0.25, output 2, cached 0.025 per M).

The pricing data is fine; only the lookup key misses. The same
exact-match-by-provider pattern exists in `modelSupportsInputModality`
(`models.ts:2128`), where the miss makes the modality gate return
`undefined` (fail-open — lower stakes, but the same fix applies).

## Why it surfaced now

agency-lang's default config recently became explicit
`defaultProvider: "openai-responses"` (previously unset, so the provider
was inferred as `"openai"` and the family-keyed lookup worked). Any caller
that names an API-variant provider hits this; the agency agent has been
promoting OpenAI calls to `openai-responses` for a while, so its runs
likely lost cost too. Anthropic/Google routes are unaffected (their
provider names match the catalog family).

## Downstream impact (why this is not just cosmetic)

In agency-lang, the missing cost flows into usage accounting as zero, so
`getCost()`, `guard(cost:)`, `--max-cost`, the eval harness's per-run cost
caps, and `agency remote spend` are all blind for these calls. Budget caps
silently cannot trip.

## Suggested fix

In `calculateCost`, fall back when the provider-keyed lookup misses:

```ts
model = getModelForProvider(this.provider, this.model, this.modelData)
     ?? getModel(this.model, this.modelData);
```

Pricing is model-intrinsic; the provider-keyed entry only needs to win when
the same model name is genuinely listed under two providers with different
prices (that precedence is preserved by the `??`). Apply the same fallback
in `modelSupportsInputModality`. An alternative — teaching
`getModelForProvider` the family rule (`"openai-responses"` starts with
`"openai-"`) — matches how `getHostedTools` callers bridge the split, but
the `??` fallback is smaller and covers unknown variants too.

## Repro / verification

```js
const m = require("smoltalk");
m.getModelForProvider("openai-responses", "gpt-5-mini"); // undefined  ← miss
m.getModelForProvider("openai", "gpt-5-mini");           // catalog entry
```

A unit test that pins the fix: a `Model` constructed with
`("gpt-5-mini", "openai-responses")` must return a non-null
`calculateCost({ inputTokens: 1000, outputTokens: 1000 })`, equal to the
one computed with provider `"openai"`. After a release, agency-lang bumps
the dep and its eval runs should print real totals again (each review-agent
call there is ~$0.003–0.005, dominated by ~16k cached input tokens per
call, so totals round small but must be nonzero).
