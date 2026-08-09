# Plan re-review: Audio STT, TTS & Audio-in-Chat

**Reviewed plan:** `docs/superpowers/plans/2026-08-08-audio-stt-tts.md` (rev. 2)  
**Reviewed design:** `docs/superpowers/specs/2026-08-08-audio-stt-tts-design.md`  
**Date:** 2026-08-09  
**Reviewer:** Amp  
**Verdict:** Request one more revision before execution. Rev. 2 resolves most findings from the first review, but three prescribed steps still break compilation or provider-aware pricing, and the proposed “end-to-end” chat test still bypasses the public pipeline it is meant to verify.

## Summary

The revision materially improves the plan. It now awaits provider promises inside the public
exception boundary, redacts provider errors, uses the correct model-data envelope shape,
rejects unsupported chat MIME types during attachment preparation, keeps the content-part and
renderer changes atomic, adds concrete STT/TTS SDK tests, removes the deprecated audio-mini
entry, and introduces a provider-aware model lookup for capability checks.

The architecture and task ordering are otherwise sound. The remaining blockers are localized
and can be fixed in the plan without redesigning the feature.

## Findings, ranked

### 1. P0: chat cost calculation remains name-only despite the new provider-aware helper

Task 1 adds `getModelForProvider()`, and Tasks 4, 5, and 8 use it. Task 2, however, leaves
`Model.calculateCost()` on its existing name-only lookup:

```ts
const model = getModel(this.model, this.modelData);
```

This is the method used by `SmolOpenAi.calculateUsageAndCost()`. In addition,
`SmolOpenAi` currently constructs its `Model` as:

```ts
new Model(config.model, undefined, config.modelData)
```

so an explicit `config.provider` is not retained there. A duplicate model name under two
providers can therefore use the wrong text and audio rates. Task 9's fixture has only one
matching entry, so its cost assertion cannot detect the defect. This contradicts the global
constraint that audio pricing lookups be keyed by `provider:modelName`.

**Required plan correction:**

- In Task 2, change `Model.calculateCost()` to use `getModelForProvider()` whenever the
  `Model` has a provider, retaining name-only lookup only when no provider can be resolved.
- Ensure OpenAI clients construct `Model` with the effective call provider rather than
  discarding `config.provider`.
- Add a cost test with the same model name under two providers and different audio rates;
  assert that `calculateUsageAndCost()` uses the selected provider's rate.

### 2. P0: `export *` exposes and collides on two `_resetForTests` symbols

Both `transcription.ts` and `speech.ts` export a function named `_resetForTests`. Tasks 4 and
5 then direct the implementer to add both modules to `lib/index.ts` with `export *`.

That leaks test-only state-reset functions into the package API and creates an ambiguous
duplicate export once the second star export lands. The existing Files API deliberately uses
explicit root exports to keep its identically named reset helper private.

**Required plan correction:** replace both star exports with explicit public value/type
exports. Keep each `_resetForTests` accessible only through its internal module path for its
co-located tests.

### 3. P0: the synchronous-throw provider tests contain invalid TypeScript syntax

Tasks 4 and 5 use this form:

```ts
registerTranscriptionProvider("boom", {
  transcribe() { throw new Error("kaboom"); } as any
});
```

An object method declaration cannot be followed by `as any`; both test files fail to parse.
No cast is needed because an always-throwing method returns `never`, which is assignable to
the promised return type:

```ts
registerTranscriptionProvider("boom", {
  transcribe() {
    throw new Error("kaboom");
  },
});
```

Apply the same correction to the speech test.

### 4. P1: Task 9 is not an end-to-end test and does not establish sync/stream parity

Task 9 calls `buildRequest()` and `calculateUsageAndCost()` directly through test-only seams.
That verifies two internal units, but bypasses all of the behavior most at risk:

- `BaseClient.prepareAttachments()`;
- provider and positive-capability validation;
- OGG rejection before rendering;
- conversion of sync rejection to `Failure` and stream rejection to an `error` chunk;
- the actual Chat Completions SDK call;
- sync/stream usage extraction and final-result cost parity.

The task title and step description promise “parity + no-call-on-reject,” but the supplied
test invokes neither `textSync()` nor `textStream()` and has no SDK spy. The comment that both
paths share a helper is useful unit reasoning, not an integration test of the approved
contract.

**Required plan correction:** retain the seam-level tests if desired, but add public-path
tests with a fake OpenAI client that supports sync `.withResponse()` and a streaming async
iterator. Assert that:

1. a successful request contains the resolved `input_audio` block;
2. sync and streaming final results report the same mixed text/audio usage and cost;
3. an unsupported model and OGG input produce `Failure`/`error` respectively; and
4. the SDK `create` spy is not called for either rejected input.

### 5. P1: the planned attachment tests do not cover the source forms required by the design

The approved design calls for bytes, base64, path, and URL audio sources to resolve to inline
base64. Task 7 tests only an already-base64 source, so it does not exercise the new audio
branch's important behaviors: bytes conversion, path MIME inference, and the requirement that
URLs be fetched rather than passed through.

**Required plan correction:** add focused cases for:

- `bytes` → inline base64;
- a temporary `.wav` or `.mp3` path without explicit MIME → inferred MIME + base64; and
- a mocked `audio/wav` URL → fetched base64, never URL passthrough.

At least one test should directly prove the new audio extension inference added in Task 3.

### 6. P1: the provider tests remain incomplete at the API boundaries

The new provider tests are a strong improvement, but they still leave several specified
preflight and request-shape behaviors unverified:

- STT does not test the 25 MB cap, missing API key, or the filename/MIME passed to `toFile`.
- The STT happy path does not assert `language` or `prompt` forwarding.
- TTS tests only MP3 and PCM, not the complete Opus/AAC/FLAC/WAV MIME table.
- TTS does not assert the SDK request's model, voice, input, format, and speed fields.
- Runtime invalid `format` is not tested, despite the implementation handling it.

**Required plan correction:** add table-driven format/MIME coverage, an invalid-format
preflight test, STT size/missing-key tests, and request-payload assertions. Every preflight
failure should assert that the SDK spy was not called.

### 7. P2: fixtures still contradict the stated “never `as any`” rule

The global constraints say model-cost fixtures use a valid `ModelDataBlob` and “never
`as any`,” but casts remain in Tasks 1, 2, 4, 5, 8, and 9. The envelopes now have the correct
runtime fields, so this is no longer the crash from the first review, but the casts still
defeat the type check intended to prevent that regression.

**Required plan correction:** annotate each blob as `ModelDataBlob` (or use `satisfies
ModelDataBlob`) and remove the model-array and envelope casts. Use `satisfies SmolConfig` for
configuration fixtures where practical.

### 8. P2: Task 10 breaks the plan's package-relative path convention

The plan states that all paths are relative to `packages/smoltalk/`, and Tasks 1–9 follow
that convention. Task 10 instead names and stages:

```text
packages/smoltalk/README.md
packages/smoltalk/CHANGELOG.md
```

From the package working directory implied by the rest of the plan, these paths are wrong.
Use `README.md`, `CHANGELOG.md`, and `git add README.md CHANGELOG.md`, or change the entire
plan to consistently run commands from the repository root.

Also stage the seed script in Task 1 if Step 7 modifies it; the current commit command omits
that conditional change.

## Prior findings now resolved

- Provider calls are awaited within `try/catch`, including rejected promises.
- Caught provider errors use `redactSecret`.
- Model-data envelopes use `models`, `schemaVersion`, `generatedAt`, and `hostedTools`.
- Unsupported chat MIME is rejected in attachment preparation, leaving renderer throws as
  defensive backstops.
- Provider-aware lookup is added and used for STT/TTS capability and modality checks.
- `JSONRenderer.audio()` calls the existing file-local conversion helper.
- The content-part and renderer changes form one typecheck-clean task.
- Concrete OpenAI STT/TTS provider tests are now specified.
- The deprecated `gpt-audio-mini` entry has been removed.
- `.mpeg`, OpenAI-only TTS limits, and the real changelog filename are addressed.

## What should remain unchanged

- Dedicated top-level `transcribe()` and `speak()` capability modules.
- Fixed built-in endpoint allowlists independent of model-data overrides.
- Disjoint text/audio token buckets and text-rate fallback for missing audio rates.
- `AudioPart.source` as `BlobRef`, excluding provider file references.
- Separate transcription, chat-input, and speech-output MIME maps.
- PCM as `application/octet-stream` with explicit s16le metadata.
- Atomic content-part/renderer work and package-wide verification before integration.

## Minimum revision before execution

1. Make `Model.calculateCost()` and OpenAI model construction provider-aware.
2. Replace the root star exports with explicit exports and fix the invalid throw-test syntax.
3. Turn Task 9 into a real public sync/stream integration test with an SDK spy.
4. Add source-kind and missing provider-boundary coverage.
5. Remove fixture casts and normalize the remaining path/staging instructions.
