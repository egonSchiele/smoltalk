# Multi-provider STT/TTS: Gemini (native) + Groq (OpenAI-compatible)

**Status:** design (approved for spec)
**Date:** 2026-08-09
**Scope:** Extend `transcribe()` (speech-to-text) and `speak()` (text-to-speech)
beyond OpenAI to Google Gemini and Groq. Companion to the v1 audio design
(`2026-08-08-audio-stt-tts-design.md`) and dev notes (`docs/dev/audio.md`).

## Goal

Today STT/TTS work for OpenAI only; every other provider returns `Failure`. Add
two providers that between them cover the two architectural shapes we'll keep
reusing:

- **Groq** — exposes OpenAI-compatible dedicated audio endpoints
  (`/audio/transcriptions`, `/audio/speech`). Reuses the existing OpenAI audio
  clients with a different base URL.
- **Google Gemini** — has *no* dedicated audio endpoints. STT and TTS both ride
  the multimodal `generateContent` call. A genuinely different shape.

No change to the public `transcribe()` / `speak()` surface or their `Result`
contracts. Everything is additive: new `Base*Client` subclasses plus registry
entries.

## Non-goals (v1)

Streaming STT/TTS; Gemini multi-speaker TTS; Gemini transcription timestamps;
Gemini Files API for large audio (inline bytes only); ElevenLabs / Deepgram /
AssemblyAI; Anthropic / OpenRouter / Ollama (these stay `Failure` — they have no
audio endpoints); Groq *chat* (only Groq audio is in scope).

## Capability summary (why these two)

| Provider | STT | TTS | Mechanism |
|---|---|---|---|
| OpenAI | ✅ shipped | ✅ shipped | dedicated `/audio/*` endpoints |
| **Groq** | ✅ add | ✅ add | **OpenAI-compatible** `/audio/*` (different base URL) |
| **Gemini** | ✅ add | ✅ add | **native multimodal** `generateContent` |
| Anthropic / OpenRouter / Ollama | ❌ | ❌ | no audio endpoints — stays `Failure` |

Sources: [Groq STT](https://console.groq.com/docs/speech-to-text),
[Groq TTS](https://console.groq.com/docs/text-to-speech),
[Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation).

---

## Part 1 — Groq (OpenAI-compatible)

Groq runs Whisper (`whisper-large-v3`, `whisper-large-v3-turbo`) behind an
OpenAI-compatible transcription endpoint (including `verbose_json` + word/segment
timestamps), and PlayAI TTS behind an OpenAI-compatible speech endpoint.

### 1.1 The one change to existing code: make the base URL overridable

The OpenAI audio subclasses currently hardcode the SDK client:

```typescript
// lib/transcription/openai.ts  and  lib/speech/openai.ts (today)
const client = new OpenAI({ apiKey: this.config.apiKey });   // no baseURL
```

Pull that behind an overridable method, mirroring the pattern already used by the
chat client (`SmolOpenAi.resolveClientOptions`):

```typescript
// lib/transcription/openai.ts  and  lib/speech/openai.ts (after)
protected makeClient(): OpenAI {
  return new OpenAI({ apiKey: this.config.apiKey });   // baseURL defaults to OpenAI
}
// ...then use this.makeClient() where `new OpenAI(...)` was.
```

This is the only edit to shipped audio code, and it changes no behavior for
OpenAI.

### 1.2 The Groq subclasses (new, tiny)

```typescript
// lib/transcription/groq.ts
export class GroqTranscriptionClient extends OpenAITranscriptionClient {
  protected override makeClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
}

// lib/speech/groq.ts — same override, extends OpenAISpeechClient
```

Everything else — multipart upload, `response_format: "verbose_json"`,
`timestamp_granularities`, response mapping, PCM/format handling — is inherited.
Voices are free-form strings; no validation needed.

### 1.3 Wiring

- Register `"groq"` in `builtinClients` in both `lib/transcription.ts` and
  `lib/speech.ts`.
- Add `case "groq"` to `resolveApiKey` (`lib/util/provider.ts`):
  `k?.groq || process.env.GROQ_API_KEY`. Add the `groq?: string` alias to the
  key maps in `SmolConfig` / the audio options types.
- `resolveProvider` already resolves an explicit `provider: "groq"`; registering
  Groq model records also lets it be inferred from the model name.

### 1.4 Model records (`lib/models.ts`)

Add under provider `groq`:

- STT: `whisper-large-v3`, `whisper-large-v3-turbo` — `type: "speech-to-text"`,
  `perMinuteCost`, `supportedMimeTypes` (canonical values), `maxBytes`.
- TTS: the PlayAI model(s) — `type: "text-to-speech"`, cost fields, `formats`
  (Groq returns `wav`/`flac`; confirm the exact set against Groq docs at
  implementation time), `maxInputChars` if documented.

Because Groq reuses the OpenAI clients verbatim, all constraint/cost enforcement
is the existing base-class logic — no Groq-specific validation code.

---

## Part 2 — Gemini (native multimodal)

Both STT and TTS use the already-present `@google/genai` SDK
(`new GoogleGenAI({ apiKey })` → `client.models.generateContent(request)`), the
same SDK the Gemini chat client uses.

### 2.1 STT — `GoogleTranscriptionClient` (`lib/transcription/google.ts`)

Send the audio inline plus an instruction, read the text back:

```typescript
const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
const res = await ai.models.generateContent({
  model: this.config.model,          // e.g. "gemini-2.5-flash"
  contents: [{
    role: "user",
    parts: [
      { inlineData: { mimeType, data: base64Audio } },
      { text: instruction },
    ],
  }],
});
// transcript = res.text; usage from res.usageMetadata
```

- **Instruction:** default = "Transcribe the following audio verbatim. Output
  only the transcript text, with no commentary." `opts.language`, when given, is
  folded into the instruction ("The audio is in <language>."); `opts.prompt`,
  when given, is appended as extra guidance. (Gemini has no dedicated
  language/prompt request fields — unlike OpenAI's Whisper params.)
- **Result:** `text` (the transcript). `durationSeconds` and word/segment
  timestamps are **undefined in v1** (Gemini does not return them reliably).
  `usage` is mapped from `usageMetadata` (prompt tokens include audio-input
  tokens; candidate tokens are the text output).
- **Input:** inline bytes only. `maxBytes` set to Gemini's inline request
  ceiling in the model record.

### 2.2 TTS — `GoogleSpeechClient` (`lib/speech/google.ts`)

Request an audio response modality and extract the inline PCM:

```typescript
const res = await ai.models.generateContent({
  model: this.config.model,          // e.g. "gemini-2.5-flash-preview-tts"
  contents: [{ role: "user", parts: [{ text }] }],
  config: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
    },
  },
});
// pcm = res.candidates[0].content.parts[0].inlineData.data  (base64, 24kHz s16le mono)
```

Gemini only returns raw PCM (24 kHz, signed 16-bit little-endian, mono). Output
handling (decided in brainstorming):

- **default** → raw PCM bytes as-is: `{ audio, mimeType: "application/octet-stream",
  pcm: { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 } }`.
- **`format: "wav"`** → wrap the PCM in a 44-byte WAV header (small helper, no
  new dependency): `{ audio: <wav>, mimeType: "audio/wav" }`.
- **any other `format`** → `Failure` (Gemini can't produce mp3/opus/etc.).
- **`opts.speed`** → `Failure` with a clear message: Gemini has no numeric speed
  parameter; pacing is controlled via natural-language style in the prompt. The
  model record therefore omits `speedRange` (so the base skips speed validation),
  and the subclass rejects `speed` explicitly rather than silently ignoring it.

### 2.3 WAV wrapper helper

Add `pcmToWav(pcm: Uint8Array, { sampleRateHz, channels, bitsPerSample }): Uint8Array`
in `lib/util/audioMime.ts` (or a sibling). Pure function, no dependency: writes
the standard 44-byte RIFF/WAVE header for signed-16-bit PCM, then the samples.
Unit-tested against the known header layout.

### 2.4 Model records (`lib/models.ts`)

- **TTS models** are distinct names — `gemini-2.5-flash-preview-tts`,
  `gemini-2.5-pro-preview-tts` — registered `type: "text-to-speech"` under
  provider `google`, with token-based cost fields (see Part 3), `formats:
  ["pcm", "wav"]`, and `maxInputChars` per Gemini docs. No name collision.
- **STT** uses a *general* Gemini model (e.g. `gemini-2.5-flash`), which is
  already registered as `type: "text"`. This is the crux — see Part 4.

---

## Part 3 — Cost accounting: add a token-priced path

OpenAI and Groq price audio per **minute** (STT) and per **character** (TTS).
Gemini prices by **tokens** (audio-input tokens for STT; text-input + audio-output
tokens for TTS). The base clients must handle both without pushing cost logic
into subclasses.

### 3.1 Where cost is computed

Cost stays centralized in the base template methods
(`BaseTranscriptionClient.transcribe()` / `BaseSpeechClient.speak()`). After the
provider hook returns, the base chooses the pricing signal:

1. If the result carries a `usage` (`TokenUsage`) **and** the model has
   token-cost fields → price via the existing `Model.calculateCost(usage)` (the
   four-bucket, audio-aware path already built for audio-in-chat).
2. Else if a per-minute duration (STT) or character count (TTS) is available →
   the existing `calculateTranscriptionCost` / `calculateSpeechCost` helpers.

Subclasses still never compute cost — they only populate `usage` (Gemini) or
`durationSeconds` (OpenAI/Groq STT). OpenAI/Groq TTS continue to price by input
character count.

### 3.2 Type change

`TranscriptionResult` already has an optional `usage?: TokenUsage`. Add the same
optional `usage?: TokenUsage` to `SpeechResult` (`lib/speech.ts`) so the Gemini
TTS path can carry token usage for pricing.

### 3.3 Model cost fields

- Gemini STT model (a `TextModel`): uses `inputTokenCost` / `outputTokenCost` /
  `inputAudioTokenCost` (already valid `TextModel` fields).
- Gemini TTS model (a `TextToSpeechModel`): needs token-cost fields. `TextToSpeechModel`
  today only has `perCharacterCost`; add optional `inputTokenCost` /
  `outputAudioTokenCost` to it (or reuse `BaseModel.inputTokenCost` +
  `outputAudioTokenCost`) so `Model.calculateCost` can price the token buckets.
  Exact field wiring confirmed against `Model.calculateCost` at implementation
  time.

---

## Part 4 — The STT guard (B1): "can it accept audio input?"

### 4.1 The problem

`BaseTranscriptionClient.transcribe()` opens with (lib/transcription/baseTranscriptionClient.ts):

```typescript
const model = getModelForProvider(provider, modelName, modelData);
if (model !== undefined && !isSpeechToTextModel(model)) {   // type === "speech-to-text"
  return failure(`Model "${modelName}" is not a speech-to-text model.`);
}
```

Behavior today:

| Model | In registry? | `type` | Result |
|---|---|---|---|
| `whisper-1` | yes | `speech-to-text` | ✅ accepted |
| brand-new unknown model | no | — | ✅ accepted (guard skipped; provider is authority) |
| `gemini-2.5-flash` | yes | `text` | ❌ rejected |

The unknown-model passthrough (`model === undefined`) is deliberate and must be
preserved. The problem is only the last row: Gemini transcribes with a general
multimodal model labeled `"text"`, and each `provider:modelName` key holds
exactly one entry, so we can't relabel it `"speech-to-text"`.

### 4.2 The fix

Change the guard from *"is it labeled speech-to-text?"* to *"can it accept audio
input?"* A model is a valid transcription target if it is **either**:

- `type === "speech-to-text"` (OpenAI/Groq Whisper), **or**
- a model whose `modalities.input` includes `"audio"` (a multimodal model such as
  `gemini-2.5-flash`).

Introduce a small predicate, e.g. `modelAcceptsAudioInput(model)`, and replace
the guard:

```typescript
if (model !== undefined && !modelAcceptsAudioInput(model)) {
  return failure(
    `Model "${modelName}" cannot accept audio input (not a transcription model).`,
  );
}
```

`modelAcceptsAudioInput` returns `true` for `type === "speech-to-text"` OR when
`model.modalities?.input?.includes("audio")`. The `model === undefined` branch is
untouched, so unknown models still flow through.

### 4.3 Constraint fields for a Gemini STT (text) model

The base reads `model.supportedMimeTypes` and `model.maxBytes` for MIME/size
validation; today those live only on `SpeechToTextModel`. For B1, a `TextModel`
used for STT needs the same optional fields. Add optional `supportedMimeTypes?:
readonly string[]` and `maxBytes?: number` to `TextModel` (audio-input
constraints), mirroring how `inputAudioTokenCost` already lives on `TextModel`.
The base's existing constraint-reading and `resolveTranscriptionMaxBytes` logic
then applies unchanged. If a Gemini text model omits these, validation is simply
skipped (provider is authority) — same graceful degradation as an unknown model.

### 4.4 What B1 does NOT touch

Audio-*in-chat* is gated separately by `BaseClient.attachmentCapabilities()`.
`SmolGoogle` keeps returning no `audioFormats`, so adding `"audio"` to a Gemini
model's `modalities.input` does **not** enable audio-in-chat for Gemini — the two
gates are independent. (It does cleanly set up future Gemini audio-in-chat, when
we choose to add it.)

---

## Part 5 — File layout

```
lib/transcription/openai.ts     edit: extract makeClient()
lib/transcription/groq.ts       new: GroqTranscriptionClient
lib/transcription/google.ts     new: GoogleTranscriptionClient
lib/speech/openai.ts            edit: extract makeClient()
lib/speech/groq.ts              new: GroqSpeechClient
lib/speech/google.ts            new: GoogleSpeechClient
lib/transcription.ts            register "groq" + "google"; groq apiKey alias
lib/speech.ts                   register "groq" + "google"; SpeechResult.usage
lib/util/provider.ts            resolveApiKey: case "groq"
lib/util/audioMime.ts           pcmToWav() helper
lib/models.ts                   groq STT/TTS + gemini STT/TTS records;
                                modelAcceptsAudioInput(); TextModel audio-input
                                constraint fields; TextToSpeechModel token costs
lib/model.ts                    cost: token-priced path selection
data/model-data.json            regenerate via `pnpm seed-data`
```

## Part 6 — Testing

Mirror the existing audio test patterns:

- **Groq subclasses** — reuse the `vi.mock("openai")` seam; assert the `baseURL`
  override reaches the SDK and that inherited request-shaping (verbose_json,
  timestamps, multipart filename, TTS format handling) is unchanged.
- **Gemini subclasses** — `vi.mock("@google/genai")`; assert the STT
  `generateContent` request shape (inline audio part + instruction; language/prompt
  folding) and the TTS request shape (`responseModalities: ["AUDIO"]`,
  `speechConfig.voiceConfig`), plus PCM→WAV wrapping and the `speed`/unsupported-
  `format` rejections.
- **Guard (B1)** — a multimodal text model with `modalities.input` including
  `"audio"` is accepted by `transcribe()`; a plain text model without audio input
  is rejected; an unknown model still flows through.
- **Cost** — exact-number assertions for the token-priced Gemini paths (STT: audio
  input tokens; TTS: text-in + audio-out tokens) and the per-minute/per-char
  Groq/OpenAI paths; sync/stream parity where applicable.
- **Seed data** — extend `tests/seed-model-data.test.ts` coverage to the new
  model records so a stale `data/model-data.json` fails CI.
- **`pcmToWav`** — header-layout unit test.

## Open items to confirm at implementation time

- Groq's exact TTS model id(s), voices, and supported output `formats`.
- Gemini inline-audio byte ceiling for `maxBytes`.
- Current published token prices for the Gemini STT and TTS models.
- Exact `Model.calculateCost` field names for TTS token pricing (Part 3.3).
