# Re-review: Speech-to-Text & Text-to-Speech Support

**Reviewed spec:** `docs/superpowers/specs/2026-08-08-audio-stt-tts-design.md`  
**Revision reviewed:** 2026-08-09  
**Reviewer:** Amp  
**Verdict:** Request one more correction pass. The revision resolves the original architecture and dedicated STT/TTS blockers, but its audio-in-chat path still names retired models, underprices audio tokens, and does not reliably reject unsupported providers/models before serialization.

## What the revision fixed

The revised design correctly addresses most of the initial review:

- Dedicated STT is now limited to `whisper-1`, so `verbose_json`, duration pricing, and
  word/segment timestamps have a coherent contract.
- `TranscriptionResult` now represents `words` separately from `segments`.
- Token-priced GPT transcription/TTS models are deferred instead of being assigned false
  minute/character prices.
- Legacy TTS character counting, `CostEstimate` mapping, speed/input validation, all output
  formats, and PCM metadata are specified.
- `AudioPart` excludes `ProviderFileRef`, targets Chat Completions only, and now has a
  complete renderer/attachment/JSON/Ollama implementation checklist.
- Transcription, chat-input, and speech-output MIME surfaces are separated.
- `transcribe()` and `speak()` have a real exception boundary.
- Custom provider dispatch, `model: string`, `modelData`, built-ins-win behavior, and
  provider-aware lookup are explicit.

The overall architecture is ready; the remaining findings are localized contract fixes.

## Remaining findings, ranked

### 1. P0: the positive audio-chat path uses models that were shut down

The spec adds `gpt-4o-audio-preview` and `gpt-4o-mini-audio-preview`. OpenAI's official
deprecations page says both were shut down on **2026-05-07**. The current audio guide uses
`gpt-audio-1.5`, a generally available Chat Completions model supporting text/audio input
and output; Responses is not supported.

Implementing the proposed registry entries would make the advertised v1 happy path fail
with model-not-found errors.

**Required correction:**

- Replace both preview entries with `gpt-audio-1.5`.
- Add its current text and audio token rates and `modalities.input: ["text", "audio"]`.
- Make the successful `AudioPart` test use `gpt-audio-1.5`.
- Replace stale “GPT-4o audio models” wording with “OpenAI audio chat models.”

References: [gpt-audio-1.5 model](https://developers.openai.com/api/docs/models/gpt-audio-1.5)
and [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations).

### 2. P0: the existing cost path does not price audio tokens

The spec says audio-in-chat “reuses the existing text token-cost path” and needs no new cost
code. Current code cannot do that correctly:

- OpenAI reports audio subsets in `prompt_tokens_details.audio_tokens` and
  `completion_tokens_details.audio_tokens`.
- `TokenUsage` has no audio-token fields.
- `clients/openai.ts` does not parse either audio bucket.
- `Model.calculateCost()` never reads the existing `inputAudioTokenCost` or
  `outputAudioTokenCost` fields; it prices all tokens at text rates.

For `gpt-audio-1.5`, text input is $2.50/1M tokens while audio input is $32/1M, so the
current calculation would materially understate cost.

**Required correction:** replace “no new cost code” with one of these explicit choices:

1. **Preferred:** extend normalized usage with `inputAudioTokens`/`outputAudioTokens`, parse
   OpenAI's detail fields in sync and streaming responses, and calculate disjoint text/audio
   buckets without double-counting; test a mixed text+audio usage payload.
2. **Smallest v1:** omit `cost` whenever the response reports audio tokens, rather than
   returning a known-wrong estimate.

Because `AudioPart` works through both `textSync()` and `textStream()`, whichever behavior is
chosen must be consistent across both paths.

### 3. P0: audio preflight remains permissive and provider-unsafe

The spec says unknown models must explicitly opt in to audio, but its proposed condition is:

```typescript
modelSupportsInputModality(model, "audio", modelData) === false
```

That helper returns `undefined` for unknown models and models without modality metadata, so
this condition still permits them. The provider check only rejects `openai-responses`.
Existing Google model entries already declare audio input, so they pass modality validation
and can reach the planned throwing `GoogleRenderer.audio()` backstop—contradicting the claim
that unsupported combinations are rejected before serialization.

Provider overrides create the same risk because the current modality lookup is keyed only
by model name, not `provider:modelName`.

**Required correction:**

- Resolve the effective provider before audio validation.
- In v1, require `provider === "openai"`; reject **every** other provider before attachment
  resolution/serialization, not only `openai-responses`.
- Require provider-aware audio capability to be exactly `true` (`!== true` is failure).
- For an unknown OpenAI model, require a matching `provider:modelName` `modelData` entry that
  explicitly includes `audio` in its input modalities.
- Add tests for an unannotated unknown model, explicit provider override with a colliding
  model name, and a Google model whose registry metadata already contains audio.
- State the existing stream contract accurately: `textSync()` returns `Failure`, while
  `textStream()` emits an `error` chunk.

### 4. P1: built-in STT/TTS dispatch needs explicit v1 model allowlists

The OpenAI provider implementations are described as Whisper-only and legacy-TTS-only, but
the shared model gate only rejects the wrong capability type. Refreshed/per-call model data
could add a token-priced OpenAI speech model of the correct type and route it into
Whisper/legacy assumptions that v1 intentionally deferred.

An explicit provider of `"openai"` plus an unknown model has a similar ambiguity: unknown
model dispatch is intended for registered custom providers, not for bypassing built-in
model support.

**Required correction:**

- Define immutable built-in allowlists:
  - OpenAI transcription: `whisper-1`;
  - OpenAI speech: `tts-1`, `tts-1-hd`.
- Check the allowlist after provider resolution and before dispatch, independently of the
  model's capability type.
- State that `modelData` can override metadata/pricing for those IDs but cannot enable more
  built-in OpenAI endpoint models in v1.
- Only explicitly registered custom provider names may dispatch unknown model IDs.
- Test that injected `gpt-4o-transcribe` and `gpt-4o-mini-tts` model-data entries still fail.

### 5. P1: the PCM MIME value describes the wrong byte order

The spec maps OpenAI's raw PCM to `audio/L16;rate=24000`. RFC `audio/L16` uses network byte
order (big-endian), while OpenAI returns signed 16-bit **little-endian** samples. The
structured `pcm.sampleFormat: "s16le"` is correct, but the MIME label conflicts with it and
can cause consumers to decode the bytes incorrectly.

**Required correction:** use `application/octet-stream` plus the structured PCM metadata,
or choose and document an explicit MIME convention that accurately denotes s16le. Do not
use `audio/L16` for little-endian bytes.

The transcription format list itself is acceptable: OpenAI's endpoint reference currently
lists FLAC and OGG even though the higher-level file-transcription guide omits them. Treat
the API reference as authoritative, and add a concrete MIME-to-extension map during
implementation so ambiguous MIME values such as `audio/mpeg` have deterministic filenames.

### 6. P2: remove the unmatched trailing code fence

The document ends with a standalone ````` after the final follow-up. Remove it so the
rendered Markdown is not left inside an empty code block.

## Approval condition

No architecture change is needed. Approve for implementation planning once the spec:

1. uses `gpt-audio-1.5` for the chat-audio happy path;
2. either implements audio-token-aware cost calculation or omits incorrect costs;
3. makes audio validation provider-aware, OpenAI-only, and positive (`support === true`);
4. adds fixed built-in STT/TTS model allowlists; and
5. corrects the PCM MIME label.
