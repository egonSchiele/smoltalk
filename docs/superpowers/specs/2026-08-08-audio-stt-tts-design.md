# Speech-to-Text & Text-to-Speech Support — Design

**Date:** 2026-08-08 (rev. 2 on 2026-08-09 after two spec-review rounds)
**Status:** Approved architecture; revised to address both review rounds, ready for implementation planning
**Scope of v1:** OpenAI only — dedicated `transcribe()` (whisper-1) + `speak()` (tts-1 / tts-1-hd),
both sync-only, plus audio-in-chat via `AudioPart` on OpenAI audio chat models.

## Motivation

Smoltalk currently has **no working STT or TTS support** — only declared-but-unimplemented
scaffolding: a `SpeechToTextModel` type with a single `whisper-web` stub (never consumed),
audio token-cost and `"audio"` modality metadata on text models (metadata that
`Model.calculateCost()` does not actually read — see cost section), and a vestigial untyped
`audio` field on `AssistantMessage` that no client sets. This design adds real audio I/O.

STT and TTS do not fit the chat-shaped `SmolClient` contract (`text/textSync/textStream` →
`PromptResult`/`StreamChunk`), and `getClient()` explicitly rejects non-text models
(`lib/client.ts:52-59`). Instead we follow the **capability-function pattern** used by the
Files, Image, and Embeddings APIs (`lib/files.ts`, `lib/image.ts`, `lib/embed.ts`): top-level
functions backed by a swappable provider registry, taking `model: string` + optional
`modelData`. `SmolClient` and `getClient()` remain text-only and untouched.

## Design decisions from review

- **Dedicated STT/TTS use only simply-priced models in v1.** STT = `whisper-1` (per-minute);
  TTS = `tts-1` / `tts-1-hd` (per-character). Token-priced GPT audio endpoint models
  (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`) are **deferred**.
- **Audio-in-chat targets Chat Completions only, on current models.** The `-audio-preview`
  models were retired (shutdown 2026-05-07). v1 declares `gpt-audio-1.5` and `gpt-audio-mini`
  (GA Chat Completions audio models). OpenAI's Responses API has no `input_audio` contract;
  `provider: "openai-responses"` is rejected before serialization.
- **Audio-in-chat cost is implemented, not free.** `calculateCost()` today prices every token
  at text rates and ignores the `*AudioTokenCost` fields, and `TokenUsage` has no audio
  buckets. v1 adds real audio-token accounting (see "Audio-token cost accounting").
- **Options mirror `ImageConfig`/`EmbedConfig`:** `model: string` + `modelData?: ModelDataBlob`.

## Non-goals (v1)

- Streaming STT or TTS (sync only).
- Token-priced GPT dedicated audio endpoint models — see Follow-ups.
- Providers other than OpenAI (Gemini, OpenRouter, Anthropic, Ollama, local) — see Follow-ups.
- Audio *output* from chat models (assistant-generated audio) — see Follow-ups.
- Speech translation endpoint — see Follow-ups.

## Architecture

```
lib/transcription.ts          → transcribe(source, opts) + TranscriptionProvider registry
lib/speech.ts                 → speak(text, opts)         + SpeechProvider registry
lib/transcription/openai.ts   → openaiTranscriptionProvider (whisper-1)
lib/speech/openai.ts          → openaiSpeechProvider (tts-1, tts-1-hd)
lib/classes/message/contentParts.ts + renderers + attachment pipeline → AudioPart
lib/types/tokenUsage.ts + lib/model.ts + lib/clients/openai.ts → audio-token cost
lib/models.ts                 → STT/TTS registry cleanup + chat-audio entries + cost fields
```

Each capability module follows `lib/files.ts`'s structure — a `Provider` interface, a
built-ins table, a `registered` map with `register*Provider(name, impl)` + `_resetForTests()`,
and a `selectProvider()` where **built-ins win and custom registrations are the fallback for
unknown provider names** (custom provider dispatch, not an override of built-ins).

All operations return `Result<T>`. See "Exception safety" — the public functions add a real
try/catch boundary rather than returning the provider call directly the way `files.ts` does.

## Component: STT — `transcribe()`

`lib/transcription.ts`

```typescript
export async function transcribe(
  source: BlobRef,                 // reuse loadBlob: bytes | base64 | path | url
  opts: TranscribeOptions,
): Promise<Result<TranscriptionResult>>

export type TranscribeOptions = {
  model: string;                   // v1 built-in allowlist: "whisper-1"
  provider?: string;               // default resolved from the model / modelData
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  language?: string;               // ISO-639-1 hint
  prompt?: string;                 // biasing text
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;               // default 25 MB (OpenAI's inline cap)
  filename?: string;               // canonical multipart filename (default derived from MIME)
};

export type TranscriptionResult = {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments?: { start: number; end: number; text: string }[];
  words?: { start: number; end: number; word: string }[];
  usage?: TokenUsage;              // populated when the provider reports it (future GPT STT)
  cost?: CostEstimate;
  raw?: unknown;                   // provider payload, unnormalized
};

export type TranscriptionProvider = {
  transcribe(
    data: Uint8Array,
    mimeType: string,
    ctx: { apiKey: string; opts: TranscribeOptions },
  ): Promise<Result<TranscriptionResult>>;
};

export function registerTranscriptionProvider(name: string, impl: TranscriptionProvider): void;
```

- **OpenAI impl** → `POST /audio/transcriptions` with `model: whisper-1`. Always requests
  `response_format: "verbose_json"` (needed for both `duration` → cost and timestamps), and
  passes `timestamp_granularities[]` when `timestampGranularity` is set.
- **Timestamps** (whisper-1 supports both): `"segment"` populates `segments`; `"word"`
  populates `words`. They are not projected into one shape.
- **Input** reuses `loadBlob` from `lib/util/imageRef.js` — same size-cap and SSRF caveat as
  uploads. Oversize input → `Failure` before the network call.
- **Multipart upload** needs a filename with a real extension; derive it from the resolved MIME
  via the MIME→extension map (see MIME contract) unless `opts.filename` is given.
- **Cost:** `whisper-1` per-minute → `CostEstimate` with `inputCost = (durationSeconds/60) ×
  perMinuteCost`, `outputCost = 0`, `totalCost = inputCost`, `currency = "USD"`. If duration is
  unavailable or the model has no rate, `cost` is omitted (no error).

## Component: TTS — `speak()` (sync only)

`lib/speech.ts`

```typescript
export async function speak(
  text: string,
  opts: SpeakOptions,
): Promise<Result<SpeechResult>>

export type SpeakOptions = {
  model: string;                   // v1 built-in allowlist: "tts-1", "tts-1-hd"
  voice: string;                   // required; provider-specific ("alloy", …)
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";  // default "mp3"
  speed?: number;                  // 0.25–4.0
};

export type SpeechResult = {
  audio: Uint8Array;
  mimeType: string;                // exact per-format value (see MIME contract)
  pcm?: { sampleRateHz: 24000; sampleFormat: "s16le"; channels: 1 };  // only when format === "pcm"
  cost?: CostEstimate;
  raw?: unknown;
};

export type SpeechProvider = {
  speak(text: string, ctx: { apiKey: string; opts: SpeakOptions }): Promise<Result<SpeechResult>>;
};

export function registerSpeechProvider(name: string, impl: SpeechProvider): void;
```

- **OpenAI impl** → `POST /audio/speech` (`tts-1`, `tts-1-hd`).
- **Preflight validation (before network dispatch), each with a test:**
  - reject non-finite `speed` or `speed` outside `[0.25, 4.0]`;
  - reject input longer than the endpoint's 4096-character limit;
  - reject an unknown `format`; map `format` → request value and exact output MIME.
  - (`instructions` is intentionally not in v1 — only `gpt-4o-mini-tts` honors it, and that
    model is deferred.)
- **Cost:** per-character, where "character" = Unicode code points (`[...text].length`), not
  UTF-16 `text.length`. `CostEstimate` with `inputCost = codePoints × perCharacterCost`,
  `outputCost = 0`, `totalCost = inputCost`, `currency = "USD"`. Omitted if no rate.
- **PCM:** when `format === "pcm"`, output is headerless 24 kHz signed-16-bit **little-endian**
  mono; surfaced in `SpeechResult.pcm`. `mimeType` is `application/octet-stream` (see MIME
  contract for why not `audio/L16`).

## Component: Audio-in-chat — `AudioPart`

New arm in the user content-part union (`lib/classes/message/contentParts.ts`). Source is a
**`BlobRef`**, not `AttachmentSource` — Chat `input_audio` has only an inline base64 form (no
`file_id`, no remote URL), so `ProviderFileRef` is deliberately excluded.

```typescript
export type AudioPart = { type: "audio"; source: BlobRef; filename?: string };
```

### Implementation checklist (the union arm touches more than one file)

1. **Type + schema + union + helper:** `AudioPart`, `AudioPartSchema`, extend `UserContentPart`,
   `UserContentPartSchema`, `UserContentInput`; add and export an `audioPart()` constructor
   (mirroring `imagePart()`/`filePart()` in `classes/message/index.ts`).
2. **Renderer dispatch:** add `audio(part: AudioPart): T` to the `PartRenderer` interface
   (`renderers/PartRenderer.ts`) and an explicit `else if (part.type === "audio")` case in
   `renderParts()` — currently the `else` treats everything as a file.
3. **Renderer implementations:**
   - `OpenAIChatRenderer.audio()` → `{ type: "input_audio", input_audio: { data: <base64>,
     format: "mp3" | "wav" } }`.
   - `JSONRenderer.audio()` → base64 round-trip (materialize `bytes`), matching its
     `image()`/`file()` handling.
   - `OpenAIResponsesRenderer`, `GoogleRenderer`, `AnthropicRenderer`: `audio()` throws a
     defensive "not supported in v1" error. This is a backstop only — the real rejection
     happens pre-serialization (step 5), so it should never be reached.
4. **Ollama:** `UserMessage.toOllamaMessage()` uses a hand-written loop (not `renderParts`);
   add an audio branch that drives a `Failure` (reject before send; do not silently drop).
5. **Pre-serialization gates (this is where unsupported combos are rejected, so the `Result`
   contract holds). Resolve the effective provider first, then:**
   - **Provider gate:** in v1, require `provider === "openai"`. Reject **every** other provider
     (including `openai-responses`, Google, Anthropic, Ollama, custom) when any audio part is
     present, before attachment resolution/serialization.
   - **Positive capability gate:** extend `validateModalities()` (`util/modalities.ts`) with an
     audio arm that requires provider-aware support to be **exactly `true`** —
     `modelSupportsInputModality(model, "audio", modelData) !== true → Failure`. (The helper
     returns `undefined` for unknown/unannotated models, so a `=== false` test would wrongly
     admit them.) Lookup must be keyed on `provider:modelName`.
   - **Custom opt-in:** an unknown OpenAI model may enable audio only via a matching
     `provider:modelName` `modelData` entry that lists `audio` in `modalities.input`; never send
     audio to an unknown model silently.
   - **Stream contract:** on rejection, `textSync()` returns a `Failure`; `textStream()` emits
     an `error` chunk. Behavior must match across both.
6. **Attachment pipeline:**
   - `messagesHaveAttachments()` (`clients/resolveAttachments.ts`): count audio parts.
   - `resolveMessageAttachments()`: add an audio branch — no `providerFile`/URL passthrough;
     always `normalizeImageRef` with `allowedMimePrefixes: ["audio/"]` and the byte cap, then
     store as base64. (Chat `input_audio` requires inline base64.)
7. **Tests:** bytes/base64/path/URL inputs resolve to base64; JSON round-trip of `AudioPart`;
   successful Chat Completions request against `gpt-audio-1.5`; rejections for `openai-responses`,
   Google (whose registry metadata already declares audio input), Anthropic, Ollama, an
   unannotated unknown model, and an explicit provider override whose model name collides with a
   differently-owned model.

## Audio-token cost accounting

Audio-in-chat cost is not free today: `TokenUsage` has no audio buckets, `clients/openai.ts`
does not parse OpenAI's audio detail fields, and `Model.calculateCost()` (`model.ts:60-71`)
prices all tokens at text rates while never reading `inputAudioTokenCost`/`outputAudioTokenCost`.
For `gpt-audio-1.5`, audio input (~$32/1M) is ~13× text input (~$2.50/1M), so the current path
would materially understate cost. v1 fixes this:

- **`TokenUsage`** (`types/tokenUsage.ts`): add `inputAudioTokens?: number` and
  `outputAudioTokens?: number` (+ schema + `addTokenUsage`).
- **`clients/openai.ts`**: parse `prompt_tokens_details.audio_tokens` and
  `completion_tokens_details.audio_tokens` in **both** the sync and streaming usage paths.
- **`Model.calculateCost()`**: split disjoint buckets without double-counting — audio tokens at
  `inputAudioTokenCost`/`outputAudioTokenCost`, the remaining (text) tokens at
  `inputTokenCost`/`outputTokenCost`. If an audio rate is missing but audio tokens are present,
  charge them at the text rate (honest total) rather than dropping them.
- **Test** a mixed text+audio usage payload; verify identical results via `textSync()` and
  `textStream()`.

## Provider & model resolution (shared by transcribe/speak)

1. Resolve provider: `opts.provider` → else the model's provider from `modelData`/registry.
2. Provider-aware lookup keyed on `provider:modelName` (so an explicit provider override never
   reads a same-named model owned by a different provider).
3. **Built-in model allowlists** (checked after provider resolution, before dispatch,
   independently of the model's capability type):
   - OpenAI transcription: `{ whisper-1 }`.
   - OpenAI speech: `{ tts-1, tts-1-hd }`.
   `modelData` may override metadata/pricing for those IDs but **cannot** enable additional
   built-in OpenAI endpoint models in v1 (e.g. an injected `gpt-4o-transcribe` or
   `gpt-4o-mini-tts` still fails). Only explicitly **registered custom provider** names may
   dispatch unknown model IDs.
4. Cases, each tested:
   - unknown model with no explicit/model-data provider → `Failure`;
   - a built-in provider + a model outside its allowlist → `Failure` (incl. injected
     `gpt-4o-transcribe` / `gpt-4o-mini-tts` model-data entries);
   - unknown model dispatched to an explicit **registered** provider → allowed, `cost` omitted;
   - built-in provider names are **not** overridable by `register*Provider` (built-ins win).

## MIME contract (three distinct surfaces)

- **Transcription upload (whisper-1):** accept FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV, WebM
  (per the API reference, which is authoritative over the higher-level guide). Path-extension→
  MIME inference lives in `lib/util/imageRef.ts` (`EXT_TO_MIME`, images+PDF today) — extend it
  with these audio extensions, or require explicit MIME for audio paths. Add a concrete
  MIME→extension map so ambiguous values like `audio/mpeg` yield a deterministic multipart
  filename.
- **Chat `input_audio`:** MP3 and WAV only; the wire `format` field is exactly `"mp3" | "wav"`,
  derived from the resolved MIME. Other audio MIME types on an `AudioPart` → `Failure`.
- **Speech output (`speak`):** map each `format` to its exact MIME —
  `mp3`→`audio/mpeg`, `opus`→`audio/ogg`, `aac`→`audio/aac`, `flac`→`audio/flac`,
  `wav`→`audio/wav`. For `pcm`, use `application/octet-stream` plus the structured `pcm`
  metadata — **not** `audio/L16`, whose RFC definition is big-endian while OpenAI returns
  signed-16-bit little-endian, so the label would misdescribe the bytes.

## Exception safety

- `transcribe()` and `speak()` wrap provider resolution, input loading, and the awaited
  `provider.transcribe/speak(...)` in a try/catch that converts thrown errors and rejected
  promises into redacted `Failure` values. (Stronger than `files.ts`, which returns the provider
  call directly; a custom provider could throw or reject.)
- Audio-in-chat rides the existing text pipeline, whose serializers/SDK calls can throw.
  Unsupported audio combinations are rejected in the pre-serialization gates (provider check +
  `validateModalities`), **not** from a synchronous renderer, so the error surfaces as a
  `Result` (`textSync`) or an `error` chunk (`textStream`).
- "Never throw" is a guarantee for the new `transcribe()`/`speak()` functions specifically; it
  is not claimed as a new package-wide guarantee for the pre-existing text path.

## Error handling

- Providers without an audio API (Anthropic, Ollama — and Google/OpenRouter until their
  follow-ups) return `Failure` with Files-API-style wording.
- Oversize input, missing API key, unsupported model/format, out-of-range `speed`,
  over-limit text length → `Failure` before the network call.
- Provider HTTP errors → `Failure` carrying a redacted provider message.

## Testing

`.test.ts` alongside each module (vitest), provider HTTP mocked:

- **STT:** whisper-1 happy path; `segments` for `"segment"` and `words` for `"word"`;
  duration→cost math; oversize rejection; missing-key rejection; multipart filename derivation;
  allowlist rejection of an injected token-priced OpenAI STT model.
- **TTS:** happy path per format with exact `mimeType`; PCM metadata + `application/octet-stream`
  for `pcm`; code-point cost math; invalid `speed`, over-limit length, unknown `format`
  rejections; allowlist rejection of an injected token-priced OpenAI TTS model.
- **Custom dispatch:** unknown model → `Failure`; unknown model + registered provider allowed
  with cost omitted; built-in not overridable.
- **Exception boundary:** a registered provider that throws synchronously and one that returns a
  rejected promise both become `Failure`.
- **AudioPart:** bytes/base64/path/URL → base64 resolution; JSON round-trip; `input_audio`
  conversion + successful chat request on `gpt-audio-1.5`; rejections for `openai-responses`,
  Google (audio-declaring metadata), Anthropic, Ollama, unannotated unknown model, and
  colliding provider override.
- **Audio cost:** mixed text+audio usage payload priced with disjoint buckets, identical across
  `textSync()` and `textStream()`.

## Model registry (clean up & populate)

In `lib/models.ts`:

- Remove the `whisper-web` stub and the dead commented-out `gpt-4o-audio-preview` STT entry.
- Add STT entry: `whisper-1` (provider `openai`, `type: "speech-to-text"`, `perMinuteCost`).
- Add TTS model type + entries:
  ```typescript
  export type TextToSpeechModel = BaseModel & { type: "text-to-speech"; perCharacterCost?: number };
  ```
  `textToSpeechModels = [tts-1, tts-1-hd]`, a `TextToSpeechModelName` alias, an
  `isTextToSpeechModel()` guard, merged into `getAllModels()` — mirroring the existing
  `SpeechToTextModel` scaffolding.
- Audio chat: add **text-model** entries `gpt-audio-1.5` and `gpt-audio-mini` with
  `modalities.input: ["text", "audio"]` and current text + audio token rates
  (`inputTokenCost`, `outputTokenCost`, `inputAudioTokenCost`, `outputAudioTokenCost`). Cost
  flows through the audio-aware `calculateCost()` above.

## Public API surface added

`transcribe`, `speak`, `TranscribeOptions`, `TranscriptionResult`, `SpeakOptions`,
`SpeechResult`, `TranscriptionProvider`, `SpeechProvider`, `registerTranscriptionProvider`,
`registerSpeechProvider`, `AudioPart` (+ schema), `audioPart()`, `TextToSpeechModel`,
`TextToSpeechModelName`, `isTextToSpeechModel` — all re-exported from the package index. STT
model type/names already exist and are cleaned up. `TokenUsage` gains
`inputAudioTokens`/`outputAudioTokens`.

## Follow-ups (out of scope for v1)

- **Token-priced GPT dedicated audio endpoint models** — `gpt-4o-transcribe`,
  `gpt-4o-mini-transcribe` (per-token STT, cost from response usage), `gpt-4o-mini-tts`
  (per-token; `instructions` support; cost omitted or explicitly labeled an estimate since the
  audio response carries no usage). Requires per-token rate fields on the STT/TTS model types.
- **Gemini support** — STT via `generateContent` with audio input; Gemini TTS models.
- **OpenRouter support** — route STT/TTS where models are available.
- **Streaming** — `speakStream()` and streaming/realtime STT.
- **Audio output from chat models** — capture OpenAI assistant audio; give the currently-
  vestigial `AssistantMessage.audio` field a real type.
- **Speech translation** — OpenAI `POST /audio/translations` (speech → English text).
- **Local / browser providers** — Whisper via `smoltalk-llama-cpp` / `smoltalk-webllm` (the
  original `whisper-web` stub name anticipated this).
- **SSRF guard for `{ kind: "url" }` inputs** — shared with the Files API's planned private-IP
  guard.
- **Voice discovery** — enumerate available voices per provider/model.
- **Anthropic** — no STT/TTS or audio-input API today; revisit if one ships.
