# Speech-to-Text & Text-to-Speech Support — Design

**Date:** 2026-08-08 (rev. 2026-08-09 after spec review)
**Status:** Approved architecture; revised to address spec review, ready for implementation planning
**Scope of v1:** OpenAI only — dedicated `transcribe()` (whisper-1) + `speak()` (tts-1 / tts-1-hd),
both sync-only, plus audio-in-chat via `AudioPart` on OpenAI Chat Completions audio models.

## Motivation

Smoltalk currently has **no working STT or TTS support** — only declared-but-unimplemented
scaffolding: a `SpeechToTextModel` type with a single `whisper-web` stub (never consumed),
audio token-cost and `"audio"` modality metadata on text models, and a vestigial untyped
`audio` field on `AssistantMessage` that no client sets. This design adds real audio I/O.

STT and TTS do not fit the chat-shaped `SmolClient` contract (`text/textSync/textStream` →
`PromptResult`/`StreamChunk`), and `getClient()` explicitly rejects non-text models
(`lib/client.ts:52-59`). Instead we follow the **capability-function pattern** used by the
Files, Image, and Embeddings APIs (`lib/files.ts`, `lib/image.ts`, `lib/embed.ts`): top-level
functions backed by a swappable provider registry, taking `model: string` + optional
`modelData`. `SmolClient` and `getClient()` remain text-only and untouched.

## Design decisions from review

- **Dedicated STT/TTS use only simply-priced models in v1.** STT = `whisper-1` (per-minute);
  TTS = `tts-1` / `tts-1-hd` (per-character). The token-priced GPT audio models
  (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`) are **deferred** — they
  need per-token pricing and usage capture, and `gpt-4o-mini-tts` returns binary audio with no
  usage, so no exact cost is derivable. GPT-4o audio capability is still reachable in v1 via
  audio-in-chat, which reuses the existing text token-cost path.
- **Audio-in-chat targets Chat Completions only.** OpenAI's Responses API has no `input_audio`
  contract; `provider: "openai-responses"` is rejected before serialization in v1.
- **Options mirror `ImageConfig`/`EmbedConfig`:** `model: string` + `modelData?: ModelDataBlob`,
  not narrow name aliases, so custom models work and provider/model resolution is consistent.

## Non-goals (v1)

- Streaming STT or TTS (sync only).
- Token-priced GPT dedicated audio models — see Follow-ups.
- Providers other than OpenAI (Gemini, OpenRouter, Anthropic, Ollama, local) — see Follow-ups.
- Audio *output* from chat models (assistant-generated audio) — see Follow-ups.
- Speech translation endpoint — see Follow-ups.

## Architecture

Two new capability modules plus message-layer changes for audio-in-chat:

```
lib/transcription.ts          → transcribe(source, opts) + TranscriptionProvider registry
lib/speech.ts                 → speak(text, opts)         + SpeechProvider registry
lib/transcription/openai.ts   → openaiTranscriptionProvider (whisper-1)
lib/speech/openai.ts          → openaiSpeechProvider (tts-1, tts-1-hd)
lib/classes/message/contentParts.ts + renderers + attachment pipeline → AudioPart
lib/models.ts                 → STT/TTS registry cleanup + chat-audio modality flags + cost
```

Each capability module follows `lib/files.ts`'s structure — a `Provider` interface, a
built-ins table, a `registered` map with `register*Provider(name, impl)` + `_resetForTests()`,
and a `selectProvider()` where **built-ins win and custom registrations are the fallback for
unknown provider names** (this is *custom provider dispatch*, not an override of built-ins).

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
  model: string;                   // v1 built-in support: "whisper-1"
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
  (see MIME contract) unless `opts.filename` is given.
- **Cost:** `whisper-1` per-minute → `CostEstimate` with `inputCost = (durationSeconds/60) ×
  perMinuteCost`, `outputCost = 0`, `totalCost = inputCost`, `currency = "USD"`. If duration is
  unavailable or the model has no rate, `cost` is omitted (no error).
- **Model-capability gate:** a resolved model that is not a `speech-to-text` model (and not an
  unknown model dispatched to an explicit registered provider) → `Failure`.

## Component: TTS — `speak()` (sync only)

`lib/speech.ts`

```typescript
export async function speak(
  text: string,
  opts: SpeakOptions,
): Promise<Result<SpeechResult>>

export type SpeakOptions = {
  model: string;                   // v1 built-in support: "tts-1", "tts-1-hd"
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
- **Cost:** per-character. "Character" = Unicode code points (`[...text].length`), not UTF-16
  `text.length`. `CostEstimate` with `inputCost = codePoints × perCharacterCost`,
  `outputCost = 0`, `totalCost = inputCost`, `currency = "USD"`. Omitted if no rate.
- **PCM:** when `format === "pcm"`, output is headerless 24 kHz signed-16-bit LE mono; that
  contract is surfaced in `SpeechResult.pcm` since `mimeType` cannot express it.

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
   add an audio branch that returns a `Failure`-driving path (reject before send; do not
   silently drop).
5. **Pre-serialization gates (this is where unsupported combos are rejected, so the `Result`
   contract holds):**
   - Extend `validateModalities()` (`util/modalities.ts`) with an `audio` arm: if any audio
     part and `modelSupportsInputModality(model, "audio", modelData) === false` → `Failure`.
   - Reject `provider === "openai-responses"` when any audio part is present → `Failure`
     (Responses has no audio-chat contract in v1).
   - Unknown custom model opts in to audio only by declaring `audio` input modality via
     `modelData`; never send audio to an unknown model silently.
6. **Attachment pipeline:**
   - `messagesHaveAttachments()` (`clients/resolveAttachments.ts`): count audio parts.
   - `resolveMessageAttachments()`: add an audio branch — no `providerFile`/URL passthrough;
     always `normalizeImageRef` with `allowedMimePrefixes: ["audio/"]` and the byte cap, then
     store as base64. (Chat `input_audio` requires inline base64.)
7. **Tests:** bytes/base64/path/URL inputs resolve to base64; JSON round-trip of `AudioPart`;
   rejection for `openai-responses`, Google, Anthropic, Ollama, and text-only models; a
   successful Chat Completions request against a supported audio model.

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
- Chat-audio: add/update **text-model** entries `gpt-4o-audio-preview` and
  `gpt-4o-mini-audio-preview` with `audio` in `modalities.input`. Their audio *cost* uses the
  existing `inputAudioTokenCost`/`outputAudioTokenCost` fields via the normal text path — no new
  cost code for audio-in-chat.

## Provider & model resolution (shared by transcribe/speak)

1. Resolve provider: `opts.provider` → else the model's provider from `modelData`/registry.
2. Provider-aware lookup keyed on `provider:modelName` (so an explicit provider override never
   reads a same-named model owned by a different provider).
3. Cases, each tested:
   - unknown model with no explicit/model-data provider → `Failure`;
   - known model of the wrong capability type (e.g. a text model to `transcribe`) → `Failure`;
   - unknown model dispatched to an explicit **registered** provider → allowed, `cost` omitted;
   - built-in provider names are **not** overridable by `register*Provider` (built-ins win).

## MIME contract (three distinct surfaces)

- **Transcription upload (whisper-1):** accept FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV, WebM.
  Path-extension→MIME inference lives in `lib/util/imageRef.ts` (`EXT_TO_MIME`, images+PDF
  today) — extend it with these audio extensions, or require explicit MIME for audio paths.
  Derive the multipart filename/extension from the resolved MIME.
- **Chat `input_audio`:** MP3 and WAV only; the wire `format` field is exactly `"mp3" | "wav"`,
  derived from the resolved MIME. Other audio MIME types on an `AudioPart` → `Failure`.
- **Speech output (`speak`):** map each `format` to its exact MIME —
  `mp3`→`audio/mpeg`, `opus`→`audio/ogg`, `aac`→`audio/aac`, `flac`→`audio/flac`,
  `wav`→`audio/wav`, `pcm`→`audio/L16;rate=24000` (plus the structured `pcm` metadata).

## Exception safety

- `transcribe()` and `speak()` wrap provider resolution, input loading, and the awaited
  `provider.transcribe/speak(...)` in a try/catch that converts thrown errors and rejected
  promises into redacted `Failure` values. (This is stronger than `files.ts`, which returns the
  provider call directly; a custom provider could throw or reject.)
- Audio-in-chat rides the existing text pipeline, whose serializers/SDK calls can throw.
  Unsupported audio combinations are rejected in the pre-serialization gates (`validateModalities`
  / provider check), **not** from a synchronous renderer, so the error surfaces as a `Result`.
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
  duration→cost math; oversize rejection; missing-key rejection; wrong-capability-model
  rejection; multipart filename derivation.
- **TTS:** happy path per format with exact `mimeType`; PCM metadata present for `pcm`;
  code-point cost math; invalid `speed`, over-limit length, unknown `format` rejections.
- **Custom dispatch:** unknown model → `Failure`; unknown model + registered provider allowed
  with cost omitted; built-in not overridable.
- **Exception boundary:** registered provider that throws synchronously and one that returns a
  rejected promise both become `Failure`.
- **AudioPart:** bytes/base64/path/URL → base64 resolution; JSON round-trip; `input_audio`
  conversion for a supported chat model; rejections for `openai-responses`, Google, Anthropic,
  Ollama, and audio-incapable models.

## Public API surface added

`transcribe`, `speak`, `TranscribeOptions`, `TranscriptionResult`, `SpeakOptions`,
`SpeechResult`, `TranscriptionProvider`, `SpeechProvider`, `registerTranscriptionProvider`,
`registerSpeechProvider`, `AudioPart` (+ schema), `audioPart()`, `TextToSpeechModel`,
`TextToSpeechModelName`, `isTextToSpeechModel` — all re-exported from the package index. STT
model type/names already exist and are cleaned up.

## Follow-ups (out of scope for v1)

- **Token-priced GPT dedicated audio models** — `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`
  (per-token STT, cost from response usage), `gpt-4o-mini-tts` (per-token; `instructions`
  support; cost omitted or explicitly labeled an estimate since the audio response carries no
  usage). Requires per-token rate fields on the STT/TTS model types.
- **Gemini support** — STT via `generateContent` with audio input; Gemini TTS models.
- **OpenRouter support** — route STT/TTS where models are available.
- **Streaming** — `speakStream()` and streaming/realtime STT.
- **Audio output from chat models** — capture OpenAI GPT-4o assistant audio; give the
  currently-vestigial `AssistantMessage.audio` field a real type.
- **Speech translation** — OpenAI `POST /audio/translations` (speech → English text).
- **Local / browser providers** — Whisper via `smoltalk-llama-cpp` / `smoltalk-webllm` (the
  original `whisper-web` stub name anticipated this).
- **SSRF guard for `{ kind: "url" }` inputs** — shared with the Files API's planned private-IP
  guard.
- **Voice discovery** — enumerate available voices per provider/model.
- **Anthropic** — no STT/TTS or audio-input API today; revisit if one ships.
```
