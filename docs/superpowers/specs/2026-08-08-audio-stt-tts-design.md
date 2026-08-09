# Speech-to-Text & Text-to-Speech Support — Design

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning
**Scope of v1:** OpenAI only — dedicated `transcribe()` + `speak()` (sync only) + audio-in-chat via `AudioPart`.

## Motivation

Smoltalk currently has **no working STT or TTS support** — only declared-but-unimplemented
scaffolding: a `SpeechToTextModel` type with a single `whisper-web` stub (never consumed),
audio token-cost and `"audio"` modality metadata on text models, and a vestigial untyped
`audio` field on `AssistantMessage` that no client sets. This design adds real audio I/O.

STT and TTS do not fit the chat-shaped `SmolClient` contract (`text/textSync/textStream` →
`PromptResult`/`StreamChunk`), and `getClient()` explicitly rejects non-text models
(`lib/client.ts:52-59`). Instead we follow the **Files API pattern** (`lib/files.ts`):
top-level capability functions backed by a swappable provider registry. `SmolClient` and
`getClient()` remain text-only and untouched.

## Non-goals (v1)

- Streaming STT or TTS (sync only).
- Providers other than OpenAI (Gemini, OpenRouter, Anthropic, Ollama, local) — see Follow-ups.
- Audio *output* from chat models (assistant-generated audio) — see Follow-ups.
- Speech translation endpoint — see Follow-ups.

## Architecture

Two new capability modules plus one message-layer change:

```
lib/transcription.ts          → transcribe(source, opts) + TranscriptionProvider registry
lib/speech.ts                 → speak(text, opts)         + SpeechProvider registry
lib/transcription/openai.ts   → openaiTranscriptionProvider
lib/speech/openai.ts          → openaiSpeechProvider
lib/classes/message/contentParts.ts → add AudioPart (audio-in-chat)
lib/models.ts                 → clean up STT stub, add TTS model type + entries + cost helpers
```

Each capability module mirrors `lib/files.ts`: a `Provider` interface, a built-ins table, a
`registered` map with a `register*Provider(name, impl)` function and a `_resetForTests()`, a
`selectProvider()` that prefers built-ins then falls back to the registry, and a public
function that resolves the API key, loads/validates input, and delegates to the provider.

All operations return `Result<T>` and never throw. Unsupported providers return a `Failure`
with wording matching the Files API (e.g. `Provider "anthropic" has no transcription API.`).

## Component: STT — `transcribe()`

`lib/transcription.ts`

```typescript
export async function transcribe(
  source: BlobRef,                 // reuse loadBlob: bytes | base64 | path | url
  opts: TranscribeOptions,
): Promise<Result<TranscriptionResult>>

export type TranscribeOptions = {
  model: SpeechToTextModelName;
  provider?: string;               // default resolved from the model
  apiKey?: SmolConfig["apiKey"];
  language?: string;               // ISO-639-1 hint
  prompt?: string;                 // biasing text (Whisper)
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;               // default 25 MB (OpenAI's inline cap)
};

export type TranscriptionResult = {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments?: { start: number; end: number; text: string }[];
  cost?: CostEstimate;             // durationSeconds/60 × perMinuteCost
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

- **OpenAI impl** → `POST /audio/transcriptions` (whisper-1, gpt-4o-transcribe,
  gpt-4o-mini-transcribe). Requests `verbose_json` when `timestampGranularity` is set so
  `segments` / `durationSeconds` are populated.
- **Input** reuses `loadBlob` from `lib/util/imageRef.js` — same size-cap and SSRF caveat
  documented for uploads. Oversize input → `Failure` before the network call.
- **Cost** from `SpeechToTextModel.perMinuteCost` (already in the type) × duration.

## Component: TTS — `speak()` (sync only)

`lib/speech.ts`

```typescript
export async function speak(
  text: string,
  opts: SpeakOptions,
): Promise<Result<SpeechResult>>

export type SpeakOptions = {
  model: TextToSpeechModelName;
  voice: string;                   // required; provider-specific ("alloy", …)
  provider?: string;
  apiKey?: SmolConfig["apiKey"];
  format?: "mp3" | "wav" | "opus" | "pcm";  // default "mp3"
  speed?: number;
  instructions?: string;           // gpt-4o-mini-tts style steering
};

export type SpeechResult = {
  audio: Uint8Array;
  mimeType: string;                // e.g. "audio/mpeg"
  cost?: CostEstimate;             // text.length (characters) × perCharacterCost
  raw?: unknown;
};

export type SpeechProvider = {
  speak(text: string, ctx: { apiKey: string; opts: SpeakOptions }): Promise<Result<SpeechResult>>;
};

export function registerSpeechProvider(name: string, impl: SpeechProvider): void;
```

- **OpenAI impl** → `POST /audio/speech` (gpt-4o-mini-tts, tts-1, tts-1-hd).
- No streaming in v1. A `speakStream()` async generator is a clean later addition (Follow-ups).

## Component: Audio-in-chat — `AudioPart`

New arm in the user content-part union, mirroring `ImagePart`/`FilePart`
(`lib/classes/message/contentParts.ts:20`):

```typescript
export type AudioPart = { type: "audio"; source: AttachmentSource; filename?: string };
```

- Add `AudioPartSchema`; extend `UserContentPart`, `UserContentPartSchema`, `UserContentInput`.
- Add `toOpenAIMessage()` handling in the relevant message classes → OpenAI's `input_audio`
  content type (base64 data + `format`).
- Extend `lib/util/attachments.ts` (currently image/document-only) with audio MIME mapping
  (`audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/mp4`/`m4a`, `audio/flac`, …).
- **Scope:** OpenAI GPT-4o audio models only in v1. An `AudioPart` sent to a model that does
  not accept audio input → `Failure` with a clear message.
- Independent of `transcribe()`: callers can transcribe a file (dedicated endpoint) *or* drop
  audio into a conversation (chat pipeline). Both paths ship in v1.

## Model registry (clean up & populate)

In `lib/models.ts`:

- Remove the `whisper-web` stub and the dead commented-out `gpt-4o-audio-preview` entry.
- Add real STT entries: `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`
  (provider `openai`, `type: "speech-to-text"`, `perMinuteCost`).
- Add a new model type:
  ```typescript
  export type TextToSpeechModel = BaseModel & { type: "text-to-speech"; perCharacterCost?: number };
  ```
  a `textToSpeechModels` array (`gpt-4o-mini-tts`, `tts-1`, `tts-1-hd`), a
  `TextToSpeechModelName` alias, an `isTextToSpeechModel()` guard, and merge the array into
  `getAllModels()` — mirroring the existing `SpeechToTextModel` scaffolding exactly.
- Extend cost helpers: per-minute (STT) and per-character (TTS), each producing a
  `CostEstimate`. An unknown model or missing cost field → `cost` omitted, no error (matches
  existing `Model.calculateCost` behavior).

## Error handling

- Everything returns `Result<T>`; nothing throws.
- Providers without an audio API (Anthropic, Ollama — and Google/OpenRouter until their
  Follow-ups land) return `Failure` with Files-API-style wording.
- Oversize input → `Failure` (before the network call). Missing API key → `Failure` (before
  the network call). Provider HTTP errors → `Failure` carrying the provider message.

## Testing

`.test.ts` alongside each module (vitest), provider HTTP mocked:

- STT happy path; `segments`/`durationSeconds` populated when `timestampGranularity` set.
- TTS happy path; `mimeType` matches requested `format`.
- Cost math: per-minute (STT) and per-character (TTS).
- Oversize input rejection; missing-API-key rejection; unsupported-provider `Failure`.
- `AudioPart` → OpenAI `input_audio` message conversion.
- `AudioPart` schema round-trip (`toJSON`/`fromJSON`).
- Registry override via `registerTranscriptionProvider` / `registerSpeechProvider`.

## Public API surface added

`transcribe`, `speak`, `TranscribeOptions`, `TranscriptionResult`, `SpeakOptions`,
`SpeechResult`, `TranscriptionProvider`, `SpeechProvider`, `registerTranscriptionProvider`,
`registerSpeechProvider`, `AudioPart` (+ schema), `TextToSpeechModel`, `TextToSpeechModelName`,
`isTextToSpeechModel` — all re-exported from the package index. STT model names/type already
exist and are cleaned up.

## Follow-ups (out of scope for v1)

- **Gemini support** — STT via `generateContent` with audio input (Gemini treats speech as a
  chat modality rather than a dedicated endpoint) and Gemini TTS models for `speak()`.
- **OpenRouter support** — route STT/TTS through OpenRouter where models are available.
- **Streaming** — `speakStream()` (audio chunks as they generate) and streaming/realtime STT.
- **Audio output from chat models** — capture OpenAI GPT-4o assistant audio output; give the
  currently-vestigial `AssistantMessage.audio` field a real type and populate it.
- **Speech translation** — OpenAI `POST /audio/translations` (speech → English text).
- **Local / browser providers** — Whisper via `smoltalk-llama-cpp`, and browser Whisper via
  `smoltalk-webllm` (the original `whisper-web` stub name anticipated this).
- **SSRF guard for `{ kind: "url" }` inputs** — shared with the Files API's planned private-IP
  guard; applies to `transcribe()` URL sources too.
- **Voice discovery** — a helper to enumerate available voices per provider/model.
- **Anthropic** — no STT/TTS or audio-input API today; revisit if one ships.
