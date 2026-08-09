# Multi-provider STT/TTS (Gemini + Groq) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `transcribe()` (speech-to-text) and `speak()` (text-to-speech) beyond OpenAI to Google Gemini (native multimodal) and Groq (OpenAI-compatible), with no change to the public call surface.

**Architecture:** Groq reuses the existing OpenAI audio clients through protected base-URL and default-format hooks; its subclasses select Groq's URL and WAV default without leaking those details to callers. Gemini uses the already-present `@google/genai` SDK's `generateContent`: STT sends bounded inline audio plus an instruction and reads text back; TTS requests an `AUDIO` response modality and returns raw PCM (optionally WAV-wrapped). Existing declarative modality and token-pricing abstractions are extended rather than duplicated.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), vitest, `openai` SDK, `@google/genai` SDK, Zod. pnpm workspace.

## Global Constraints

- ES Modules: every internal import uses a `.js` extension. Package is `"type": "module"`.
- Strict TypeScript (`strict: true`). No `any` leaking into public types.
- Public audio operations always return `Result<T>` — never throw. The base template method and the internal factory are the only exception boundaries; provider subclasses (`_transcribe`/`_speak`) never `try/catch` and never compute cost.
- Model capabilities and per-model constraints are **data** in `lib/models.ts`,
  never hardcoded in client logic. Provider transport-envelope checks (such as
  Gemini's total encoded request size) remain encapsulated in the provider
  client. MIME values in model records are **canonical** (`audio/mpeg`,
  `audio/wav`, …), never aliases.
- Tests live beside implementation with a `.test.ts` suffix; use `vitest` (`pnpm test`).
- Run from `packages/smoltalk/`. `pnpm typecheck` must pass after every task.
- No new runtime dependencies (`openai` and `@google/genai` are already present).
- Do not edit `data/model-data.json` by hand — regenerate with `pnpm seed-data`.
- Provider facts and prices below were verified 2026-08-09 against:
  [Groq STT](https://console.groq.com/docs/speech-to-text),
  [Groq TTS](https://console.groq.com/docs/text-to-speech),
  [Groq models/pricing](https://console.groq.com/docs/models),
  [Gemini audio](https://ai.google.dev/gemini-api/docs/audio),
  [Gemini TTS](https://ai.google.dev/gemini-api/docs/speech-generation), and
  [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Gemini STT remains inline-only in this plan. It never silently uploads to the
  Files API, because upload lifecycle and cleanup are caller-owned concerns.

---

## File Structure

```
lib/transcription/openai.ts     MODIFY  extract makeClient()
lib/speech/openai.ts            MODIFY  extract makeClient() + defaultFormat()
lib/transcription/groq.ts       CREATE  GroqTranscriptionClient
lib/speech/groq.ts              CREATE  GroqSpeechClient
lib/transcription/google.ts     CREATE  GoogleTranscriptionClient
lib/speech/google.ts            CREATE  GoogleSpeechClient
lib/googleAudioUsage.ts         CREATE  typed Gemini usage normalization
lib/transcription.ts            MODIFY  register "groq"+"google" builtins
lib/speech.ts                   MODIFY  register "groq"+"google"; SpeechResult.usage
lib/types.ts                    MODIFY  named groq API-key field
lib/util/provider.ts            MODIFY  named groq key + env fallback
lib/util/mime.ts                MODIFY  canonical AAC/AIFF formats
lib/util/audioMime.ts           MODIFY  pcmToWav() + Gemini wire MIME adapter
lib/transcription/baseTranscriptionClient.ts  MODIFY  reuse modality guard + audioInputConstraints; token cost
lib/speech/baseSpeechClient.ts  MODIFY  token cost path
lib/models.ts                   MODIFY  add groq provider; audioInputConstraints();
                                        shared audio token fields; TextModel audio-input fields;
                                        groq + gemini model records
lib/model.ts                    MODIFY  extend Model.calculateCost() to token-priced TTS
data/model-data.json            REGEN   pnpm seed-data
docs/dev/audio.md, README.md    MODIFY  document Gemini + Groq
```

---

## Task 1: Make OpenAI-compatible client defaults overridable

**Files:**
- Modify: `lib/transcription/openai.ts`
- Modify: `lib/speech/openai.ts`
- Test: existing `lib/transcription/openai.test.ts`, `lib/speech/openai.test.ts` (must stay green)

**Interfaces:**
- Produces: `protected makeClient(): OpenAI` on both `OpenAITranscriptionClient` and `OpenAISpeechClient`. Default returns `new OpenAI({ apiKey: this.config.apiKey })`. Groq subclasses (Tasks 2–3) override it.
- Produces: `protected defaultFormat(): SpeakFormat` on `OpenAISpeechClient`.
  OpenAI returns `"mp3"`; Groq overrides it with `"wav"` so omitted-format
  behavior remains declarative and provider-neutral.

- [ ] **Step 1: Run the existing audio tests to confirm a green baseline**

Run: `pnpm test -- openai.test`
Expected: PASS for `lib/transcription/openai.test.ts` and `lib/speech/openai.test.ts`.

- [ ] **Step 2: Extract `makeClient()` in the transcription client**

In `lib/transcription/openai.ts`, add the method and replace the inline construction:

```typescript
export class OpenAITranscriptionClient extends BaseTranscriptionClient {
  /** Build the OpenAI SDK client. Subclasses override to point at a compatible base URL. */
  protected makeClient(): OpenAI {
    return new OpenAI({ apiKey: this.config.apiKey });
  }

  protected async _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>> {
    if (!this.config.apiKey) {
      return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
    }
    const filename = transcriptionAudioType(mimeType)?.filename ?? "audio.bin";
    const client = this.makeClient();   // was: new OpenAI({ apiKey: this.config.apiKey })
    // ...rest unchanged...
```

- [ ] **Step 3: Extract `makeClient()` and `defaultFormat()` in the speech client**

In `lib/speech/openai.ts`, same change:

```typescript
export class OpenAISpeechClient extends BaseSpeechClient {
  /** Build the OpenAI SDK client. Subclasses override to point at a compatible base URL. */
  protected makeClient(): OpenAI {
    return new OpenAI({ apiKey: this.config.apiKey });
  }

  /** Provider default used when the declarative call omits format. */
  protected defaultFormat(): SpeakFormat {
    return "mp3";
  }

  protected async _speak(text: string): Promise<Result<SpeechResult>> {
    const requestedFormat = this.config.format ?? this.defaultFormat();
    // ...existing isSpeakFormat narrowing uses requestedFormat...
    const client = this.makeClient();   // was: new OpenAI({ apiKey: this.config.apiKey })
    // ...rest unchanged...
```

- [ ] **Step 4: Typecheck and re-run the tests (pure refactor, still green)**

Run: `pnpm typecheck && pnpm test -- openai.test`
Expected: PASS, unchanged behavior.

- [ ] **Step 5: Commit**

```bash
git add lib/transcription/openai.ts lib/speech/openai.ts
git commit -m "refactor: expose OpenAI-compatible audio client defaults"
```

---

## Task 2: Groq transcription (STT)

**Files:**
- Create: `lib/transcription/groq.ts`
- Modify: `lib/transcription.ts` (register `"groq"`)
- Modify: `lib/types.ts` (named `apiKey.groq`)
- Modify: `lib/util/provider.ts` (`resolveApiKey` case `"groq"`)
- Modify: `lib/models.ts` (built-in provider + Groq STT records)
- Test: `lib/transcription/groq.test.ts`
- Test: `lib/util/provider.test.ts`, `lib/models.audio.test.ts`

**Interfaces:**
- Consumes: `OpenAITranscriptionClient.makeClient()` (Task 1); `builtinClients` map in `lib/transcription.ts`.
- Produces: `class GroqTranscriptionClient extends OpenAITranscriptionClient`;
  typed built-in provider name `"groq"`; named `apiKey.groq`; env fallback
  `GROQ_API_KEY`; model-driven provider inference.

- [ ] **Step 1: Write the failing test**

Create `lib/transcription/groq.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import OpenAI, { toFile } from "openai";
import { transcribe } from "../transcription.js";

vi.mock("openai", () => {
  const create = vi.fn().mockResolvedValue({ text: "hello groq", duration: 2 });
  const OpenAIMock = vi.fn().mockImplementation(() => ({
    audio: { transcriptions: { create } },
  }));
  const toFileMock = vi.fn(async (data: Uint8Array, name: string, opts: unknown) => ({
    data, name, opts,
  }));
  return { default: OpenAIMock, toFile: toFileMock };
});

describe("GroqTranscriptionClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes to the Groq base URL and returns the transcript", async () => {
    const res = await transcribe(
      { kind: "bytes", bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" },
      { model: "whisper-large-v3", provider: "groq", apiKey: { groq: "gk-test" } },
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.text).toBe("hello groq");
    }
    // The SDK client was constructed pointing at Groq.
    expect((OpenAI as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({
      apiKey: "gk-test",
      baseURL: "https://api.groq.com/openai/v1",
    });
    // Inherited OpenAI request shaping still applies.
    const create = (new (OpenAI as unknown as new () => { audio: { transcriptions: { create: ReturnType<typeof vi.fn> } } })()).audio.transcriptions.create;
    expect(create).toHaveBeenCalled();
  });

  it("infers Groq from the registered model when provider is omitted", async () => {
    const res = await transcribe(
      { kind: "bytes", bytes: new Uint8Array([1]), mimeType: "audio/wav" },
      { model: "whisper-large-v3", apiKey: { groq: "gk-test" } },
    );
    expect(res.success).toBe(true);
    expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: "https://api.groq.com/openai/v1",
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- groq.test`
Expected: FAIL — `Provider "groq" has no transcription API` (not yet registered).

- [ ] **Step 3: Create the Groq transcription subclass**

Create `lib/transcription/groq.ts`:

```typescript
import OpenAI from "openai";
import { OpenAITranscriptionClient } from "./openai.js";

/**
 * Groq exposes an OpenAI-compatible /audio/transcriptions endpoint (Whisper
 * large-v3 / large-v3-turbo). Everything but the base URL is inherited.
 */
export class GroqTranscriptionClient extends OpenAITranscriptionClient {
  protected override makeClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
}
```

- [ ] **Step 4: Register Groq as a typed built-in and add key resolution**

In `lib/transcription.ts`, import and register:

```typescript
import { GroqTranscriptionClient } from "./transcription/groq.js";
// ...
builtinClients["openai"] = OpenAITranscriptionClient;
builtinClients["groq"] = GroqTranscriptionClient;   // add
```

In `lib/util/provider.ts`, add a case in `resolveApiKey` (the default branch already
returns `config.apiKey?.[provider]`, so only the env fallback is new):

```typescript
    case "groq":
      return k?.groq || process.env.GROQ_API_KEY;
```

Also add `"groq"` to `providers` in `lib/models.ts`, and add `groq?: string` to
both `SmolConfig.apiKey` in `lib/types.ts` and `NestedKeyConfig.apiKey` in
`lib/util/provider.ts`. Extend the existing provider tests:

```typescript
expect(ProviderSchema.parse("groq")).toBe("groq");

vi.stubEnv("GROQ_API_KEY", "gk-env");
expect(resolveApiKey("groq", {})).toBe("gk-env");
expect(resolveApiKey("groq", { apiKey: { groq: "gk-explicit" } })).toBe("gk-explicit");
```

- [ ] **Step 5: Add Groq STT model records**

In `lib/models.ts`, append to `speechToTextModels`. These standard rates were
verified 2026-08-09: $0.111/hour and $0.04/hour. `maxBytes` deliberately uses
the free-tier/direct-attachment 25 MB cap; Groq's developer tier allows 100 MB,
but a single baked-in model record cannot vary by account tier. Groq applies a
10-second minimum billable duration, which must be documented but is not
estimated client-side because the result reports actual media duration rather
than provider-rounded billing duration.

```typescript
  {
    type: "speech-to-text",
    modelName: "whisper-large-v3",
    provider: "groq",
    perMinuteCost: 0.00185,        // $0.111/hr
    supportedMimeTypes: [
      "audio/flac", "audio/mpeg", "audio/mp4", "audio/m4a",
      "audio/ogg", "audio/wav", "audio/webm",
    ],
    maxBytes: 25 * 1024 * 1024,
  },
  {
    type: "speech-to-text",
    modelName: "whisper-large-v3-turbo",
    provider: "groq",
    perMinuteCost: 0.000667,       // $0.04/hr
    supportedMimeTypes: [
      "audio/flac", "audio/mpeg", "audio/mp4", "audio/m4a",
      "audio/ogg", "audio/wav", "audio/webm",
    ],
    maxBytes: 25 * 1024 * 1024,
  },
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- groq.test provider.test models.audio.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/transcription/groq.ts lib/transcription.ts lib/types.ts lib/util/provider.ts lib/models.ts lib/transcription/groq.test.ts lib/util/provider.test.ts lib/models.audio.test.ts
git commit -m "feat: Groq speech-to-text (OpenAI-compatible)"
```

---

## Task 3: Groq speech (TTS)

**Files:**
- Create: `lib/speech/groq.ts`
- Modify: `lib/speech.ts` (register `"groq"`)
- Modify: `lib/models.ts` (append both Groq Orpheus TTS records)
- Test: `lib/speech/groq.test.ts`

**Interfaces:**
- Consumes: `OpenAISpeechClient.makeClient()` and `.defaultFormat()` (Task 1);
  typed Groq provider/key support (Task 2).
- Produces: `class GroqSpeechClient extends OpenAISpeechClient`; Groq's URL and
  WAV default remain encapsulated; model-driven provider inference works.

- [ ] **Step 1: Write the failing test**

Create `lib/speech/groq.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import OpenAI from "openai";
import { speak } from "../speech.js";

vi.mock("openai", () => {
  const create = vi.fn().mockResolvedValue({
    arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
  });
  const OpenAIMock = vi.fn().mockImplementation(() => ({
    audio: { speech: { create } },
  }));
  return { default: OpenAIMock };
});

describe("GroqSpeechClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("infers Groq and uses wav when format is omitted", async () => {
    const res = await speak("hello", {
      model: "canopylabs/orpheus-v1-english",
      voice: "troy",
      apiKey: { groq: "gk-test" },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(Array.from(res.value.audio)).toEqual([9, 9, 9]);
      expect(res.value.mimeType).toBe("audio/wav");
    }
    expect((OpenAI as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({
      apiKey: "gk-test",
      baseURL: "https://api.groq.com/openai/v1",
    });
    const create = (new (OpenAI as unknown as new () => {
      audio: { speech: { create: ReturnType<typeof vi.fn> } };
    })()).audio.speech.create;
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "canopylabs/orpheus-v1-english",
      response_format: "wav",
    }));
  });

  it("rejects an explicit non-wav format before dispatch", async () => {
    const res = await speak("hello", {
      model: "canopylabs/orpheus-v1-english",
      voice: "troy",
      format: "mp3",
      apiKey: { groq: "gk-test" },
    });
    expect(res.success).toBe(false);
    const create = (new (OpenAI as unknown as new () => {
      audio: { speech: { create: ReturnType<typeof vi.fn> } };
    })()).audio.speech.create;
    expect(create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- speech/groq.test`
Expected: FAIL — `Provider "groq" has no speech API`.

- [ ] **Step 3: Create the Groq speech subclass**

Create `lib/speech/groq.ts`:

```typescript
import OpenAI from "openai";
import { OpenAISpeechClient } from "./openai.js";

/**
 * Groq exposes OpenAI-compatible Orpheus TTS and supports WAV only.
 */
export class GroqSpeechClient extends OpenAISpeechClient {
  protected override makeClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  protected override defaultFormat(): SpeakFormat {
    return "wav";
  }
}
```

Import `SpeakFormat` from `../util/audioMime.js` as a type.

- [ ] **Step 4: Register the provider**

In `lib/speech.ts`:

```typescript
import { GroqSpeechClient } from "./speech/groq.js";
// ...
builtinClients["openai"] = OpenAISpeechClient;
builtinClients["groq"] = GroqSpeechClient;   // add
```

- [ ] **Step 5: Add the verified Groq Orpheus model records**

In `lib/models.ts`, append to `textToSpeechModels`. Groq documents a 200-code-
point input cap, WAV-only output, and prices of $22/$40 per million characters:

```typescript
  {
    type: "text-to-speech",
    modelName: "canopylabs/orpheus-v1-english",
    provider: "groq",
    perCharacterCost: 0.000022,
    maxInputChars: 200,
    formats: ["wav"],
  },
  {
    type: "text-to-speech",
    modelName: "canopylabs/orpheus-arabic-saudi",
    provider: "groq",
    perCharacterCost: 0.00004,
    maxInputChars: 200,
    formats: ["wav"],
  },
```

The model records reject explicit non-WAV requests in the base. The subclass's
`defaultFormat()` ensures an omitted format also resolves to WAV.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- speech/groq.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/speech/groq.ts lib/speech.ts lib/models.ts lib/speech/groq.test.ts
git commit -m "feat: Groq text-to-speech (OpenAI-compatible)"
```

---

## Task 4: Complete canonical audio MIME data and add WAV/wire adapters

**Files:**
- Modify: `lib/util/mime.ts`
- Modify: `lib/util/audioMime.ts`
- Test: `lib/util/mime.test.ts`, `lib/util/audioMime.test.ts` (create if absent)

**Interfaces:**
- Produces: canonical AAC (`audio/aac`) and AIFF (`audio/aiff`) entries in
  `AUDIO_FORMATS`, preserving that table as the only alias source.
- Produces: `export function googleAudioWireMime(mimeType: string): string`,
  which normalizes aliases and maps canonical MP3 `audio/mpeg` to Google's
  documented wire value `audio/mp3`.
- Produces: `export type PcmWavOptions` and
  `pcmToWav(pcm: Uint8Array, opts: PcmWavOptions): Uint8Array`.

- [ ] **Step 1: Write the failing test**

Create/append `lib/util/audioMime.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { googleAudioWireMime, pcmToWav } from "./audioMime.js";

describe("pcmToWav", () => {
  it("prepends a valid 44-byte WAV header for 24kHz mono s16le", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = pcmToWav(pcm, { sampleRateHz: 24000, channels: 1, bitsPerSample: 16 });

    expect(wav.length).toBe(44 + pcm.length);
    const ascii = (a: Uint8Array, i: number, n: number) =>
      String.fromCharCode(...a.slice(i, i + n));
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(ascii(wav, 36, 4)).toBe("data");

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);   // chunk size
    expect(view.getUint16(22, true)).toBe(1);                 // channels
    expect(view.getUint32(24, true)).toBe(24000);             // sample rate
    expect(view.getUint32(28, true)).toBe(24000 * 1 * 2);     // byte rate
    expect(view.getUint16(34, true)).toBe(16);                // bits/sample
    expect(view.getUint32(40, true)).toBe(pcm.length);        // data size
    expect(Array.from(wav.slice(44))).toEqual([1, 2, 3, 4]);
  });
});

describe("googleAudioWireMime", () => {
  it("maps MP3 aliases and the canonical MIME to Google's wire value", () => {
    expect(googleAudioWireMime("audio/mpeg")).toBe("audio/mp3");
    expect(googleAudioWireMime("audio/mp3")).toBe("audio/mp3");
  });

  it("normalizes supported non-MP3 audio MIME values", () => {
    expect(googleAudioWireMime("AUDIO/AAC")).toBe("audio/aac");
    expect(googleAudioWireMime("audio/aiff")).toBe("audio/aiff");
  });
});
```

In `lib/util/mime.test.ts`, assert `audioFormatForMime("audio/aac")` and
`audioFormatForMime("audio/aiff")` return their canonical entries.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- audioMime.test`
Expected: FAIL — the helpers/formats are not defined yet.

- [ ] **Step 3: Add canonical AAC/AIFF formats and implement the helpers**

Add to `AUDIO_FORMATS` in `lib/util/mime.ts`:

```typescript
  { extension: "aac", mimeType: "audio/aac", aliasMimeTypes: [], aliasExtensions: [] },
  { extension: "aiff", mimeType: "audio/aiff", aliasMimeTypes: ["audio/x-aiff"], aliasExtensions: ["aif"] },
```

Append to `lib/util/audioMime.ts`:

```typescript
import { audioFormatForMime, canonicalizeMime } from "./mime.js";

/**
 * Wrap raw signed-integer little-endian PCM in a 44-byte RIFF/WAVE header so it
 * becomes a directly-playable .wav. Pure function, no dependency. Used for
 * Gemini TTS output, which is only ever raw PCM.
 */
export type PcmWavOptions = {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
};

export function googleAudioWireMime(mimeType: string): string {
  const format = audioFormatForMime(mimeType);
  const canonical = format?.mimeType ?? canonicalizeMime(mimeType);
  return canonical === "audio/mpeg" ? "audio/mp3" : canonical;
}

export function pcmToWav(
  pcm: Uint8Array,
  opts: PcmWavOptions,
): Uint8Array {
  const { sampleRateHz, channels, bitsPerSample } = opts;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRateHz * blockAlign;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);          // PCM fmt chunk size
  view.setUint16(20, 1, true);           // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm typecheck && pnpm test -- audioMime.test mime.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/util/mime.ts lib/util/mime.test.ts lib/util/audioMime.ts lib/util/audioMime.test.ts
git commit -m "feat: add Gemini audio MIME and WAV adapters"
```

---

## Task 5: Reuse the declarative modality guard for multimodal STT

**Files:**
- Modify: `lib/models.ts` (add `audioInputConstraints`; add `supportedMimeTypes?` / `maxBytes?` to `TextModel`)
- Modify: `lib/transcription/baseTranscriptionClient.ts` (use the new predicate + constraints)
- Test: `lib/transcription.guard.test.ts`

**Interfaces:**
- Produces:
  - `export function audioInputConstraints(model: ModelType): { maxBytes?: number; supportedMimeTypes?: readonly string[] }`.
  - `TextModel` gains optional `supportedMimeTypes?: readonly string[]` and `maxBytes?: number`.
- Consumes: existing `modelSupportsInputModality(modelName, "audio", modelData,
  provider)`; do not introduce a duplicate capability predicate.

- [ ] **Step 1: Write the failing test**

Create `lib/transcription.guard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribe } from "./transcription.js";
import type { ModelDataBlob } from "./modelData.js";

// A fake provider whose _transcribe echoes success, so we can observe whether
// the base guard let the call through.
import { registerTranscriptionProvider, _resetForTests } from "./transcription.js";
import { BaseTranscriptionClient } from "./transcription/baseTranscriptionClient.js";
import { success } from "./types/result.js";

class FakeClient extends BaseTranscriptionClient {
  protected async _transcribe() {
    return success({ text: "ok" });
  }
}

const src = { kind: "bytes" as const, bytes: new Uint8Array([1]), mimeType: "audio/wav" };

describe("transcribe() audio-input guard (B1)", () => {
  beforeEach(() => registerTranscriptionProvider("fake", FakeClient));
  afterEach(() => _resetForTests());

  it("accepts a multimodal text model that lists audio input", async () => {
    const modelData: ModelDataBlob = {
      schemaVersion: 1,
      generatedAt: "test",
      hostedTools: [],
      models: [{
        type: "text", modelName: "fake-mm", provider: "fake",
        maxInputTokens: 1000, maxOutputTokens: 1000,
        modalities: { input: ["text", "audio"], output: ["text"] },
      }],
    };

    const res = await transcribe(src, { model: "fake-mm", provider: "fake", modelData });
    expect(res.success).toBe(true);
  });

  it("rejects a text model that does NOT list audio input", async () => {
    const modelData: ModelDataBlob = {
      schemaVersion: 1,
      generatedAt: "test",
      hostedTools: [],
      models: [{
        type: "text", modelName: "fake-textonly", provider: "fake",
        maxInputTokens: 1000, maxOutputTokens: 1000,
        modalities: { input: ["text"], output: ["text"] },
      }],
    };

    const res = await transcribe(src, { model: "fake-textonly", provider: "fake", modelData });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/cannot accept audio input/);
  });

  it("lets an unknown model flow through (provider is authority)", async () => {
    const res = await transcribe(src, { model: "totally-unknown", provider: "fake" });
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- transcription.guard.test`
Expected: FAIL — the multimodal-text case returns "is not a speech-to-text model".

- [ ] **Step 3: Add the constraints reader and TextModel fields**

In `lib/models.ts`, add optional fields to `TextModel`:

```typescript
export type TextModel = BaseModel & {
  type: "text";
  // ...existing fields...
  /** Audio-input constraints when this multimodal model is used for transcription. */
  supportedMimeTypes?: readonly string[];
  maxBytes?: number;
};
```

Add the constraints adapter near the existing model guards. Capability remains
owned by the existing `modelSupportsInputModality` query:

```typescript
/** Audio-input constraints, readable off either a dedicated STT model or a
 *  multimodal text model. Empty for any other model type. */
export function audioInputConstraints(
  model: ModelType,
): { maxBytes?: number; supportedMimeTypes?: readonly string[] } {
  if (model.type === "speech-to-text" || model.type === "text") {
    return { maxBytes: model.maxBytes, supportedMimeTypes: model.supportedMimeTypes };
  }
  return {};
}
```

- [ ] **Step 4: Use them in the base transcription client**

In `lib/transcription/baseTranscriptionClient.ts`:

Update imports:

```typescript
import {
  getModelForProvider,
  isSpeechToTextModel,
  modelSupportsInputModality,
  audioInputConstraints,
} from "../models.js";
```

Replace the guard (was `!isSpeechToTextModel(model)`):

```typescript
      const model = getModelForProvider(this.config.provider, this.config.model, this.config.modelData);
      const acceptsAudio =
        model === undefined ||
        isSpeechToTextModel(model) ||
        modelSupportsInputModality(
          this.config.model,
          "audio",
          this.config.modelData,
          this.config.provider,
        ) === true;
      if (!acceptsAudio) {
        return failure(
          `Model "${this.config.model}" cannot accept audio input (not a transcription model).`,
        );
      }
```

Replace the constraint-validation and max-bytes/MIME blocks to read through
`audioInputConstraints(model)` instead of accessing `model.maxBytes` /
`model.supportedMimeTypes` directly (which no longer type-narrow):

```typescript
      const constraints = model !== undefined ? audioInputConstraints(model) : {};

      if (model !== undefined) {
        const constraintError = transcriptionConstraintError(this.config.model, constraints);
        if (constraintError !== null) {
          return failure(constraintError);
        }
      }
      const effectiveLimit = resolveTranscriptionMaxBytes(this.config.maxBytes, constraints.maxBytes);
      if (!effectiveLimit.success) {
        return effectiveLimit;
      }
      // ...loadBlob unchanged...
      if (constraints.supportedMimeTypes !== undefined) {
        const audioFormat = audioFormatForMime(mimeType);
        const normalizedMime = audioFormat?.mimeType ?? canonicalizeMime(mimeType);
        if (!constraints.supportedMimeTypes.includes(normalizedMime)) {
          return failure(
            `Unsupported audio type "${mimeType}" for model "${this.config.model}". ` +
              `Supported: ${constraints.supportedMimeTypes.join(", ")}.`,
          );
        }
      }
```

Update the two helper signatures in the same file to take the plain constraint
values (so they work for both model shapes):

```typescript
function transcriptionConstraintError(
  modelName: string,
  c: { maxBytes?: number; supportedMimeTypes?: readonly string[] },
): string | null {
  if (
    c.maxBytes !== undefined &&
    (typeof c.maxBytes !== "number" || !Number.isFinite(c.maxBytes) || c.maxBytes <= 0)
  ) {
    return `Model "${modelName}" has an invalid maxBytes value.`;
  }
  if (
    c.supportedMimeTypes !== undefined &&
    (!Array.isArray(c.supportedMimeTypes) ||
      !c.supportedMimeTypes.every((m): m is string => typeof m === "string"))
  ) {
    return `Model "${modelName}" has invalid supportedMimeTypes.`;
  }
  return null;
}

function resolveTranscriptionMaxBytes(
  callerMaxBytes: number | undefined,
  modelMaxBytes: number | undefined,
): Result<number> {
  if (callerMaxBytes !== undefined && (!Number.isFinite(callerMaxBytes) || callerMaxBytes <= 0)) {
    return failure(`maxBytes must be a positive finite number (got ${callerMaxBytes}).`);
  }
  const limits: number[] = [];
  if (callerMaxBytes !== undefined) limits.push(callerMaxBytes);
  if (modelMaxBytes !== undefined) limits.push(modelMaxBytes);
  if (limits.length === 0) return success(DEFAULT_TRANSCRIBE_BYTES);
  return success(Math.min(...limits));
}
```

Unknown models still pass because `model === undefined`; known text-only models
fail; dedicated STT models remain accepted without requiring `modalities`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- transcription`
Expected: PASS for `transcription.guard.test`, `transcription.test`, and `transcription/openai.test` (existing OpenAI STT behavior unchanged — whisper-1 is `speech-to-text`, still accepted; its constraints read identically through `audioInputConstraints`).

- [ ] **Step 6: Commit**

```bash
git add lib/models.ts lib/transcription/baseTranscriptionClient.ts lib/transcription.guard.test.ts
git commit -m "feat: accept multimodal models as transcription targets (B1 guard)"
```

---

## Task 6: Token-priced cost path for STT and TTS

**Files:**
- Modify: `lib/model.ts` (extend the existing `Model.calculateCost` engine)
- Modify: `lib/models.ts` (move audio token rates to `BaseModel`)
- Modify: `lib/speech.ts` (add `usage?: TokenUsage` to `SpeechResult`)
- Modify: `lib/transcription/baseTranscriptionClient.ts` and `lib/speech/baseSpeechClient.ts` (reuse `Model.calculateCost`)
- Test: existing `lib/model.audioCost.test.ts`

**Interfaces:**
- Produces: one declarative token-rate shape on `BaseModel`: text and audio
  input/output rates all mean USD per million tokens.
- Produces: `Model.calculateCost()` accepts any registry model with at least one
  token rate, including `TextToSpeechModel`; its existing four-bucket arithmetic
  remains the sole token-cost engine.
- Consumes: existing `Model`, `TokenUsage`, and `model.audioCost.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `lib/model.audioCost.test.ts`:

```typescript
it("prices token-based TTS through the same four-bucket engine", () => {
  const ttsData: ModelDataBlob = {
    schemaVersion: 1,
    generatedAt: "test",
    hostedTools: [],
    models: [{
      type: "text-to-speech",
      modelName: "gem-tts",
      provider: "google",
      inputTokenCost: 0.5,
      outputAudioTokenCost: 10,
      formats: ["pcm", "wav"],
    }],
  };
  const model = new Model("gem-tts", "google", ttsData);
  expect(
    model.calculateCost({
      inputTokens: 1_000_000, outputTokens: 0, outputAudioTokens: 1_000_000,
    }),
  ).toEqual({
    inputCost: 0.5,
    outputCost: 10,
    cachedInputCost: undefined,
    cacheCreationInputCost: undefined,
    totalCost: 10.5,
    currency: "USD",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- model.audioCost.test`
Expected: FAIL — `Model.calculateCost()` returns `null` for the TTS model.

- [ ] **Step 3: Put audio token rates on the shared model shape**

Move the existing audio fields from `TextModel` to `BaseModel`, beside the text
token rates. All token-priced model kinds can then declare the same fields:

```typescript
export type BaseModel = {
  // existing fields
  inputTokenCost?: number;
  outputTokenCost?: number;
  inputAudioTokenCost?: number;
  outputAudioTokenCost?: number;
};
```

- [ ] **Step 4: Extend `Model.calculateCost()` without duplicating its arithmetic**

In `lib/model.ts`, replace the text-only guard with a token-rate guard, then
leave the existing cache/audio bucket arithmetic unchanged:

```typescript
const hasTokenRates =
  model !== undefined &&
  (model.inputTokenCost !== undefined ||
    model.outputTokenCost !== undefined ||
    model.inputAudioTokenCost !== undefined ||
    model.outputAudioTokenCost !== undefined);
if (!hasTokenRates) {
  return null;
}
```

Remove the now-unused `isTextModel` import only if no other code in
`lib/model.ts` uses it. Do not create `calculateAudioTokenCost`.

- [ ] **Step 5: Add `usage` to `SpeechResult` and wire the cost fallback into both bases**

In `lib/speech.ts`, extend `SpeechResult` and import `TokenUsage`:

```typescript
import { TokenUsage } from "./types/tokenUsage.js";
// ...
export type SpeechResult = {
  audio: Uint8Array;
  mimeType: string;
  pcm?: PcmAudioMetadata;
  usage?: TokenUsage;   // add — populated by token-billed providers (Gemini)
  cost?: CostEstimate;
  raw?: unknown;
};
```

In `lib/transcription/baseTranscriptionClient.ts`, import and update the cost step:

```typescript
import { Model, calculateTranscriptionCost } from "../model.js";
// ...after `const result = await this._transcribe(...)` success check:
      let cost = calculateTranscriptionCost(model, result.value.durationSeconds);
      if (cost === undefined && result.value.usage !== undefined) {
        cost = new Model(
          this.config.model,
          this.config.provider,
          this.config.modelData,
        ).calculateCost(result.value.usage) ?? undefined;
      }
      if (cost !== undefined) {
        result.value.cost = cost;
      }
```

In `lib/speech/baseSpeechClient.ts`, import and update the cost step:

```typescript
import { Model, calculateSpeechCost } from "../model.js";
// ...after `const result = await this._speak(text)` success check:
      let cost = calculateSpeechCost(model, [...text].length);
      if (cost === undefined && result.value.usage !== undefined) {
        cost = new Model(
          this.config.model,
          this.config.provider,
          this.config.modelData,
        ).calculateCost(result.value.usage) ?? undefined;
      }
      if (cost !== undefined) {
        result.value.cost = cost;
      }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- model.audioCost.test speech.test transcription.test`
Expected: PASS. Existing OpenAI/Groq cost behavior is unchanged (per-minute/per-char still resolves first; the token fallback only fires when the primary returns undefined).

- [ ] **Step 7: Commit**

```bash
git add lib/model.ts lib/models.ts lib/speech.ts lib/transcription/baseTranscriptionClient.ts lib/speech/baseSpeechClient.ts lib/model.audioCost.test.ts
git commit -m "feat: token-priced cost path for audio (Gemini)"
```

---

## Task 7: Gemini transcription (STT)

**Files:**
- Create: `lib/transcription/google.ts`
- Create: `lib/googleAudioUsage.ts`
- Modify: `lib/transcription.ts` (register `"google"`)
- Modify: `lib/models.ts` (augment existing Gemini text model constraints)
- Test: `lib/transcription/google.test.ts`
- Test: `lib/googleAudioUsage.test.ts`

**Interfaces:**
- Consumes: `BaseTranscriptionClient` (Task 5), `googleAudioWireMime`
  (Task 4), and `Model.calculateCost` support (Task 6).
- Produces: `normalizeGoogleAudioUsage(metadata, audioDirection): TokenUsage`
  in `lib/googleAudioUsage.ts`, shared with Task 8.
- Produces: `class GoogleTranscriptionClient`; typed SDK mapping; exact inline
  request-size enforcement; explicit rejection of unsupported timestamps.

- [ ] **Step 1: Write the failing test**

Create `lib/transcription/google.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleGenAI } from "@google/genai";
import { transcribe } from "../transcription.js";

vi.mock("@google/genai", () => {
  const generateContent = vi.fn();
  const GoogleGenAI = vi.fn().mockImplementation(() => ({ models: { generateContent } }));
  return { GoogleGenAI };
});

const gc = () =>
  (new (GoogleGenAI as unknown as new () => { models: { generateContent: ReturnType<typeof vi.fn> } })()).models.generateContent;

describe("GoogleTranscriptionClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends inline audio + instruction and maps text + usage", async () => {
    gc().mockResolvedValue({
      text: "the transcript",
      usageMetadata: {
        promptTokenCount: 1100,
        promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }],
        candidatesTokenCount: 20,
        totalTokenCount: 1120,
      },
    });

    const res = await transcribe(
      { kind: "bytes", bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" },
      { model: "gemini-2.5-flash", apiKey: { google: "gk" }, language: "en" },
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.text).toBe("the transcript");
      expect(res.value.usage).toMatchObject({ inputTokens: 100, inputAudioTokens: 1000, outputTokens: 20 });
    }

    const req = gc().mock.calls[0][0];
    expect(req.model).toBe("gemini-2.5-flash");
    const parts = req.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe("audio/wav");
    expect(typeof parts[0].inlineData.data).toBe("string");     // base64
    expect(parts[1].text).toMatch(/transcribe/i);
    expect(parts[1].text).toMatch(/en/);                         // language folded in
  });

  it("fails with a clear message when no API key is present", async () => {
    const res = await transcribe(
      { kind: "bytes", bytes: new Uint8Array([1]), mimeType: "audio/wav" },
      { model: "gemini-2.5-flash", provider: "google", apiKey: {} },
    );
    expect(res.success).toBe(false);
  });

  it("maps canonical MP3 MIME to Google's documented wire MIME", async () => {
    gc().mockResolvedValue({ text: "ok" });
    await transcribe(
      { kind: "bytes", bytes: new Uint8Array([1]), mimeType: "audio/mpeg" },
      { model: "gemini-2.5-flash", apiKey: { google: "gk" } },
    );
    expect(gc().mock.calls[0][0].contents[0].parts[0].inlineData.mimeType).toBe("audio/mp3");
  });

  it("rejects timestamps without dispatching", async () => {
    const res = await transcribe(
      { kind: "bytes", bytes: new Uint8Array([1]), mimeType: "audio/wav" },
      {
        model: "gemini-2.5-flash",
        apiKey: { google: "gk" },
        timestampGranularity: "word",
      },
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/timestamp/i);
    expect(gc()).not.toHaveBeenCalled();
  });

  it("rejects a total encoded request over the inline limit", async () => {
    const res = await transcribe(
      {
        kind: "bytes",
        bytes: new Uint8Array(14_000_000),
        mimeType: "audio/wav",
      },
      {
        model: "gemini-2.5-flash",
        apiKey: { google: "gk" },
        prompt: "x".repeat(1_500_000),
      },
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/20 MB inline request limit/i);
    expect(gc()).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- transcription/google.test`
Expected: FAIL — `Provider "google" has no transcription API`.

- [ ] **Step 3: Create the shared typed Gemini usage mapper**

Create `lib/googleAudioUsage.ts` and its focused test. Use the SDK's exported
usage type instead of converting it to `Record<string, unknown>`:

```typescript
import type { GenerateContentResponseUsageMetadata } from "@google/genai";
import type { TokenUsage } from "./types/tokenUsage.js";

export type GoogleAudioDirection = "input" | "output";

function modalityTokens(
  details: GenerateContentResponseUsageMetadata["promptTokensDetails"],
  modality: string,
): number {
  return (details ?? [])
    .filter((detail) => detail.modality === modality)
    .reduce((sum, detail) => sum + (detail.tokenCount ?? 0), 0);
}

export function normalizeGoogleAudioUsage(
  metadata: GenerateContentResponseUsageMetadata | undefined,
  audioDirection: GoogleAudioDirection,
): TokenUsage | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const prompt = metadata.promptTokenCount ?? 0;
  const candidates = metadata.candidatesTokenCount ?? 0;
  const audio = audioDirection === "input"
    ? modalityTokens(metadata.promptTokensDetails, "AUDIO")
    : modalityTokens(metadata.candidatesTokensDetails, "AUDIO") || candidates;
  return {
    inputTokens: audioDirection === "input" ? Math.max(0, prompt - audio) : prompt,
    outputTokens: audioDirection === "output" ? Math.max(0, candidates - audio) : candidates,
    ...(audioDirection === "input" && audio > 0 ? { inputAudioTokens: audio } : {}),
    ...(audioDirection === "output" && audio > 0 ? { outputAudioTokens: audio } : {}),
    ...(metadata.totalTokenCount !== undefined
      ? { totalTokens: metadata.totalTokenCount }
      : {}),
  };
}
```

The test must cover STT disjoint prompt/audio buckets, TTS audio output,
missing metadata, and missing detail arrays.

- [ ] **Step 4: Create the Gemini transcription client**

Create `lib/transcription/google.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";
import { Result, success, failure } from "../types/result.js";
import { BaseTranscriptionClient } from "./baseTranscriptionClient.js";
import type { TranscriptionResult } from "../transcription.js";
import { normalizeGoogleAudioUsage } from "../googleAudioUsage.js";
import { googleAudioWireMime } from "../util/audioMime.js";

const GOOGLE_INLINE_REQUEST_MAX_BYTES = 20_000_000;

export class GoogleTranscriptionClient extends BaseTranscriptionClient {
  // No try/catch: BaseTranscriptionClient.transcribe() is the exception boundary.
  protected async _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>> {
    if (!this.config.apiKey) {
      return failure("No Google API key provided. Set apiKey.google or GEMINI_API_KEY.");
    }
    if (this.config.timestampGranularity !== undefined) {
      return failure("Gemini transcription does not support timestampGranularity.");
    }

    let instruction =
      "Transcribe the following audio verbatim. Output only the transcript text, with no commentary.";
    if (this.config.language) {
      instruction += ` The audio is in ${this.config.language}.`;
    }
    if (this.config.prompt) {
      instruction += ` ${this.config.prompt}`;
    }

    const base64 = Buffer.from(data).toString("base64");
    const request = {
      model: this.config.model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: googleAudioWireMime(mimeType), data: base64 } },
          { text: instruction },
        ],
      }],
    };
    if (Buffer.byteLength(JSON.stringify(request), "utf8") > GOOGLE_INLINE_REQUEST_MAX_BYTES) {
      return failure(
        "Audio and instructions exceed Gemini's 20 MB inline request limit; use a smaller source.",
      );
    }
    const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    const res = await ai.models.generateContent(request);
    const usage = normalizeGoogleAudioUsage(res.usageMetadata, "input");

    const result: TranscriptionResult = {
      text: res.text ?? "",
      raw: res,
    };
    if (usage) result.usage = usage;
    return success(result);
  }
}
```

- [ ] **Step 5: Register the provider**

In `lib/transcription.ts`:

```typescript
import { GoogleTranscriptionClient } from "./transcription/google.js";
// ...
builtinClients["google"] = GoogleTranscriptionClient;   // add
```

- [ ] **Step 6: Augment the existing Gemini STT-capable model record**

Modify the existing `google:gemini-2.5-flash` entry; do not add a duplicate.
Its audio modality and verified standard rates already exist. Add canonical
supported MIME values and a conservative 14,000,000-byte raw cap. The cap leaves
room for base64 expansion, instructions, and SDK envelope under Gemini's
20,000,000-byte total inline request limit; the client still performs the exact
request check because caller prompts vary.

```typescript
  {
    type: "text",
    modelName: "gemini-2.5-flash",
    provider: "google",
    // existing fields remain unchanged
    supportedMimeTypes: ["audio/wav", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac", "audio/aiff"],
    maxBytes: 14_000_000,
  },
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- googleAudioUsage.test transcription/google.test transcription.guard.test`
Expected: PASS (the guard now accepts `gemini-2.5-flash` because it lists `audio` input).

- [ ] **Step 8: Commit**

```bash
git add lib/googleAudioUsage.ts lib/googleAudioUsage.test.ts lib/transcription/google.ts lib/transcription.ts lib/models.ts lib/transcription/google.test.ts
git commit -m "feat: Gemini speech-to-text (native generateContent)"
```

---

## Task 8: Gemini speech (TTS)

**Files:**
- Create: `lib/speech/google.ts`
- Modify: `lib/speech.ts` (register `"google"`)
- Modify: `lib/models.ts` (Gemini TTS model records)
- Test: `lib/speech/google.test.ts`

**Interfaces:**
- Consumes: `BaseSpeechClient`, `pcmToWav` (Task 4), shared
  `normalizeGoogleAudioUsage` (Task 7), and token pricing (Task 6).
- Produces: `class GoogleSpeechClient extends BaseSpeechClient`; provider is
  inferred from model data; transport details remain internal.

- [ ] **Step 1: Write the failing test**

Create `lib/speech/google.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleGenAI } from "@google/genai";
import { speak } from "../speech.js";

vi.mock("@google/genai", () => {
  const generateContent = vi.fn();
  const GoogleGenAI = vi.fn().mockImplementation(() => ({ models: { generateContent } }));
  return { GoogleGenAI };
});

const gc = () =>
  (new (GoogleGenAI as unknown as new () => { models: { generateContent: ReturnType<typeof vi.fn> } })()).models.generateContent;

const pcmBase64 = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64");

function mockAudioResponse() {
  gc().mockResolvedValue({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcmBase64 } }] } }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 200,
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 200 }],
      totalTokenCount: 210,
    },
  });
}

describe("GoogleSpeechClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns raw PCM by default with pcm metadata", async () => {
    mockAudioResponse();
    const res = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore",
      apiKey: { google: "gk" },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.mimeType).toBe("application/octet-stream");
      expect(Array.from(res.value.audio)).toEqual([1, 2, 3, 4]);
      expect(res.value.pcm).toEqual({ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 });
      expect(res.value.usage).toMatchObject({ inputTokens: 10, outputAudioTokens: 200 });
    }
    const req = gc().mock.calls[0][0];
    expect(req.config.responseModalities).toEqual(["AUDIO"]);
    expect(req.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("wraps PCM in a WAV header when format is 'wav'", async () => {
    mockAudioResponse();
    const res = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore", format: "wav",
      provider: "google", apiKey: { google: "gk" },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.mimeType).toBe("audio/wav");
      expect(res.value.audio.length).toBe(44 + 4);
      expect(String.fromCharCode(...res.value.audio.slice(0, 4))).toBe("RIFF");
    }
  });

  it("rejects unsupported formats and the speed option", async () => {
    const bad = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore", format: "mp3",
      provider: "google", apiKey: { google: "gk" },
    });
    expect(bad.success).toBe(false);

    const speedy = await speak("hi", {
      model: "gemini-2.5-flash-preview-tts", voice: "Kore", speed: 1.5,
      provider: "google", apiKey: { google: "gk" },
    });
    expect(speedy.success).toBe(false);
    if (!speedy.success) expect(speedy.error).toMatch(/speed/i);
  });

  it("does not invent an 8,000-character limit for a 32k-token context", async () => {
    mockAudioResponse();
    const res = await speak("a".repeat(8_001), {
      model: "gemini-2.5-flash-preview-tts",
      voice: "Kore",
      apiKey: { google: "gk" },
    });
    expect(res.success).toBe(true);
    expect(gc()).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- speech/google.test`
Expected: FAIL — `Provider "google" has no speech API`.

- [ ] **Step 3: Create the Gemini speech client**

Create `lib/speech/google.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";
import { Result, success, failure } from "../types/result.js";
import { pcmToWav } from "../util/audioMime.js";
import { normalizeGoogleAudioUsage } from "../googleAudioUsage.js";
import { BaseSpeechClient } from "./baseSpeechClient.js";
import type { SpeechResult, PcmAudioMetadata } from "../speech.js";

const GEMINI_PCM: PcmAudioMetadata = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };

export class GoogleSpeechClient extends BaseSpeechClient {
  // No try/catch: BaseSpeechClient.speak() is the exception boundary.
  protected async _speak(text: string): Promise<Result<SpeechResult>> {
    if (!this.config.apiKey) {
      return failure("No Google API key provided. Set apiKey.google or GEMINI_API_KEY.");
    }
    // Gemini controls pacing via prompt style, not a numeric speed parameter.
    if (this.config.speed !== undefined) {
      return failure(
        "Gemini TTS does not support the 'speed' option; control pacing via the prompt text.",
      );
    }
    const format = this.config.format ?? "pcm";
    if (format !== "pcm" && format !== "wav") {
      return failure(
        `Gemini TTS only produces raw PCM. Supported formats: pcm (default), wav. Got "${format}".`,
      );
    }

    const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    const res = await ai.models.generateContent({
      model: this.config.model,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
        },
      },
    });

    const dataB64 = res.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data !== undefined,
    )?.inlineData?.data;
    if (!dataB64) {
      return failure("Gemini returned no audio data.");
    }
    const pcm = new Uint8Array(Buffer.from(dataB64, "base64"));

    let audio = pcm;
    let mimeType = "application/octet-stream";
    if (format === "wav") {
      audio = pcmToWav(pcm, { sampleRateHz: 24000, channels: 1, bitsPerSample: 16 });
      mimeType = "audio/wav";
    }

    const usage = normalizeGoogleAudioUsage(res.usageMetadata, "output");

    const result: SpeechResult = { audio, mimeType, raw: res };
    if (format === "pcm") result.pcm = GEMINI_PCM;
    if (usage) result.usage = usage;
    return success(result);
  }
}
```

- [ ] **Step 4: Register the provider**

In `lib/speech.ts`:

```typescript
import { GoogleSpeechClient } from "./speech/google.js";
// ...
builtinClients["google"] = GoogleSpeechClient;   // add
```

- [ ] **Step 5: Add the Gemini TTS model records**

In `lib/models.ts`, append to `textToSpeechModels`. Standard prices were
verified 2026-08-09. Do **not** set `maxInputChars`: Gemini documents a 32k-token
context, and character count is not a sound token-limit proxy.

```typescript
  {
    type: "text-to-speech",
    modelName: "gemini-2.5-flash-preview-tts",
    provider: "google",
    inputTokenCost: 0.50,
    outputAudioTokenCost: 10.0,
    formats: ["pcm", "wav"],
  },
  {
    type: "text-to-speech",
    modelName: "gemini-2.5-pro-preview-tts",
    provider: "google",
    inputTokenCost: 1.0,
    outputAudioTokenCost: 20.0,
    formats: ["pcm", "wav"],
  },
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- speech/google.test speech.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/speech/google.ts lib/speech.ts lib/models.ts lib/speech/google.test.ts
git commit -m "feat: Gemini text-to-speech (native generateContent, PCM + WAV)"
```

---

## Task 9: Regenerate seed data, extend seed test, update docs

**Files:**
- Regenerate: `data/model-data.json` (via `pnpm seed-data`)
- Modify: `tests/seed-model-data.test.ts` (cover new records)
- Modify: `docs/dev/audio.md`, `packages/smoltalk/README.md`
- Test: `tests/seed-model-data.test.ts`, full suite

**Interfaces:**
- Consumes: all model records from Tasks 2/3/7/8.
- Produces: a regenerated `data/model-data.json` consistent with `lib/models.ts`.

- [ ] **Step 1: Run the full suite to confirm green before doc/seed work**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 2: Regenerate the published seed data**

Run: `pnpm seed-data`
The diff must contain the new Groq/Gemini TTS/STT records, changes to the
existing `google:gemini-2.5-flash` record, and `generatedAt`. Inspect any other
model changes separately rather than assuming an additions-only diff:

Run: `git diff --stat data/model-data.json`
Expected: `data/model-data.json` changed; no unrelated model record changed.

- [ ] **Step 3: Extend the seed-data test to the new constraint fields**

In `tests/seed-model-data.test.ts`, add assertions that the committed
`data/model-data.json` carries the new records with their audio constraint/cost
fields — mirror the existing per-model comparison style already in that file for
`whisper-1` / `tts-1`. Add cases for: `whisper-large-v3` (`perMinuteCost`,
`supportedMimeTypes`, `maxBytes`), both `canopylabs/orpheus-*` models
(`perCharacterCost`, `maxInputChars`, `formats`), `gemini-2.5-flash`
(`modalities.input` includes `"audio"`, `supportedMimeTypes`, `inputAudioTokenCost`),
and `gemini-2.5-flash-preview-tts` (`formats`, `outputAudioTokenCost`).

Compare each committed record with `getModelForProvider(provider, modelName)`;
this semantic parity assertion is the source of truth and is intentionally
insensitive to record ordering or the regenerated timestamp.

- [ ] **Step 4: Update the developer docs**

In `docs/dev/audio.md`:
- Update the "Scope (v1)" section: audio STT/TTS now covers OpenAI, **Groq**
  (OpenAI-compatible), and **Google Gemini** (native `generateContent`).
- Add a short subsection "Provider shapes" describing: (a) OpenAI-compatible via
  `makeClient()` plus provider default-format overrides (Groq); (b) Gemini native multimodal — STT =
  inline audio + instruction; TTS = `responseModalities: ["AUDIO"]` → raw PCM,
  optional WAV wrap; no numeric `speed`.
- Document reuse of `modelSupportsInputModality` for the B1 guard and reuse of
  `Model.calculateCost()` for token-priced audio alongside the existing
  per-minute/per-character helpers.
- Document Gemini's inline-only 20 MB total request behavior, conservative raw
  cap, unsupported timestamps, and 32k-token TTS context (no character preflight).
- Document Groq's 25 MB conservative upload cap, tier-dependent 100 MB maximum,
  10-second minimum billing, 200-character Orpheus limit, and WAV default.

In `packages/smoltalk/README.md`, extend the audio section with Gemini and Groq
usage examples:

```typescript
// Groq STT (OpenAI-compatible)
await transcribe(src, { model: "whisper-large-v3", provider: "groq" });

// Gemini STT (native)
await transcribe(src, { model: "gemini-2.5-flash", provider: "google" });

// Groq TTS → WAV by default (provider inferred from model)
await speak("Hello", {
  model: "canopylabs/orpheus-v1-english", voice: "troy",
});

// Gemini TTS → WAV
await speak("Hello", {
  model: "gemini-2.5-flash-preview-tts", voice: "Kore",
  provider: "google", format: "wav",
});
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, including the extended `seed-model-data.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add data/model-data.json tests/seed-model-data.test.ts docs/dev/audio.md README.md
git commit -m "docs+data: seed data and docs for Gemini + Groq audio"
```

---

## Self-Review

**Spec coverage:**
- Groq STT/TTS (spec Part 1) → Tasks 1–3. ✅
- Gemini STT/TTS (spec Part 2), PCM + WAV output → Tasks 4, 7, 8. ✅
- Token-priced cost path (spec Part 3), `SpeechResult.usage` → Task 6. ✅
- B1 guard + `TextModel` audio-input constraints (spec Part 4) → Task 5. ✅
- File layout (spec Part 5) → matches File Structure above. ✅
- Testing (spec Part 6) → per-task tests + Task 9 seed/docs. ✅
- Out-of-scope items (spec Part F) → none implemented (correct). ✅
- Provider facts → verified against the authoritative sources linked in Global
  Constraints on 2026-08-09; no guessed runtime constraints remain. ✅

**Placeholder scan:** The executable Tasks 1–9 contain no unresolved provider
facts. Optional fields without an authoritative value are deliberately omitted.

**Type consistency:** `makeClient()`, `defaultFormat()`,
`audioInputConstraints()`, `googleAudioWireMime()`, `pcmToWav()`,
`normalizeGoogleAudioUsage()`, and `SpeechResult.usage` are defined before use.
Capability queries reuse `modelSupportsInputModality()` and all token cost paths
reuse `Model.calculateCost()`.

**Ordering note:** Task 5 (guard) and Task 6 (token cost) precede the Gemini
clients (Tasks 7–8), which depend on both. Groq (Tasks 1–3) is independent and
comes first as the simplest slice.

---

## Historical Review (resolved in Tasks 1–9)

<details>
<summary>Original review retained for traceability; it is not an implementation checklist.</summary>

All findings below have been incorporated into the executable plan above.

### Verdict

The overall boundary is good: callers continue to describe **what** they want
through `transcribe()` / `speak()`, while provider subclasses encapsulate SDK
calls and response mapping. That is the right declarative public interface.

The plan is not ready to execute literally, however. It contains two live-API
blockers, duplicates two existing abstractions, and encodes several guessed
limits as authoritative model data. Resolve the P0 and P1 items below first.

### P0 — implementation blockers

#### 1. Task 3 uses a retired/unsupported Groq TTS model

The plan registers and tests `playai-tts`. Groq's current TTS documentation
lists these models instead:

- `canopylabs/orpheus-v1-english`
- `canopylabs/orpheus-arabic-saudi`

Executing Task 3 as written would publish a built-in provider whose only TTS
model cannot be called. Replace the model, fixture, comments, seed assertion,
and README example with records for the two Orpheus models. Do not carry the
unverified PlayAI price or `maxInputChars` forward under the new names; first
verify and cite the current Orpheus values.

Source: <https://console.groq.com/docs/text-to-speech>

#### 2. Groq's omitted-format path sends `mp3`, although Groq TTS uses `wav`

Task 3's test omits `format`, but inherited
`OpenAISpeechClient._speak()` resolves an omitted format to `mp3` and sends it as
`response_format`. The model record cannot prevent this because the base checks
`formats` only when the caller explicitly supplies a format. The mock therefore
passes while the real request is invalid.

Requiring callers to know that Groq needs `format: "wav"` would also leak a
transport default through an otherwise provider-neutral API. In Task 1, add a
small protected default-format hook: OpenAI returns `mp3`; Groq overrides it to
`wav`. Task 3 must assert that an omitted format sends `response_format: "wav"`,
returns `audio/wav`, and rejects an explicit unsupported format before calling
the SDK.

### P1 — correctness and architecture

#### 3. Task 7 treats Gemini's encoded request limit as a raw-file limit

Gemini's limit is **20 MB for the total request**, including prompt and inline
files. `maxBytes: 20 * 1024 * 1024` is instead applied to raw bytes before Task 7
base64-encodes them. Base64 expands data by roughly 4/3, so a file accepted by
the base can exceed the API limit before JSON and instructions are counted.

Use a named conservative raw inline cap below 15 MB in model data, then have
`GoogleTranscriptionClient` check the actual encoded request size before
dispatch. This second check is provider transport-envelope enforcement, not a
public API concern, so it belongs behind the declarative client boundary. Add a
test proving an encoded-over-limit request returns `Failure` without calling
the SDK. Keep the behavior inline-only; do not silently upload through the
Files API unless ownership and cleanup are added to the design.

Source: <https://ai.google.dev/gemini-api/docs/audio>

#### 4. Task 8 invents an 8,000-character Gemini TTS limit

The current Gemini documentation specifies a 32k-token context, not an
8,000-character cap. `BaseSpeechClient` would enforce the proposed
`maxInputChars: 8000` as a hard limit and reject valid requests.

Remove `maxInputChars` from the Gemini TTS records. Do not approximate a token
limit with characters. Let Gemini enforce its token context unless a real token
counting preflight is deliberately designed later. Add a regression test that
an input longer than 8,000 characters reaches the mocked SDK.

Source: <https://ai.google.dev/gemini-api/docs/speech-generation>

#### 5. Task 6 duplicates the existing audio-aware cost implementation

`calculateAudioTokenCost()` repeats `Model.calculateCost()`'s disjoint
text/audio input/output buckets, fallback rates, rounding, and result assembly.
It also casts `ModelType` to an ad hoc structural type, masking rather than
expressing the supported model contract. This is the catalog's “duplicating
existing code” anti-pattern and creates two pricing engines that can drift.

Use one declarative pricing interface instead:

1. Put `inputAudioTokenCost?` / `outputAudioTokenCost?` on the shared token-rate
   model shape (`BaseModel`, beside its text token rates).
2. Extend `Model.calculateCost()` to accept any model carrying token rates,
   including `TextToSpeechModel`, rather than rejecting non-`TextModel` entries.
3. Have both audio bases use that existing engine as the token-usage fallback
   after per-minute/per-character pricing.
4. Add the TTS text-in/audio-out case to the existing
   `model.audioCost.test.ts`; do not add a parallel cost helper/test suite.

#### 6. Task 5 duplicates the existing modality abstraction

`modelAcceptsAudioInput()` restates `modelSupportsInputModality()`, which already
performs provider-aware lookup and is used by the attachment path. Keep the
dedicated STT case, but reuse the existing declarative capability query:

```typescript
const acceptsAudio =
  isSpeechToTextModel(model) ||
  modelSupportsInputModality(
    this.config.model,
    "audio",
    this.config.modelData,
    this.config.provider,
  ) === true;
```

Preserve unknown-model passthrough. An `audioInputConstraints()` adapter can
still be useful because STT and multimodal text records store the same
constraints on different union members, but do not add a second modality
predicate. Build complete `ModelDataBlob` fixtures in the tests instead of
using `as unknown as ModelDataBlob`.

#### 7. Task 7 silently ignores a public option

Gemini STT does not implement `timestampGranularity`, yet the option remains
accepted without warning. That is inconsistent with Task 8's explicit rejection
of unsupported `speed` and makes the declarative contract misleading.

For v1, return `Failure` when `timestampGranularity` is supplied to Gemini and
test that the SDK is not called. Structured timestamp prompting/parsing can be
a separate feature.

#### 8. Canonical MIME data needs a provider-wire adapter and complete formats

The plan correctly requires canonical MIME values in model data, but Task 7
passes the source MIME directly to Gemini. Gemini documents MP3 as `audio/mp3`,
while this repository canonicalizes it to `audio/mpeg`. Tasks 7/8 also propose
AAC/AIFF even though `AUDIO_FORMATS` currently has no AAC/AIFF entries.

Keep model data canonical, add AAC and AIFF to `AUDIO_FORMATS`, and make the
Google subclass translate canonical MIME to the provider's accepted wire value
where necessary. Test an MP3 alias and both newly supported formats. Do not
scatter MIME aliases into model records.

#### 9. “Confirm at implementation time” values are unresolved requirements

Tasks 2, 3, 7, and 8 contain guessed prices, limits, formats, and model IDs while
the Self-Review claims there are no placeholders. These values drive runtime
rejection and user-visible cost estimates, so an implementer cannot safely
“confirm” them after writing tests around the guesses.

Add an explicit research/verification step before model-record tests, cite the
authoritative source and retrieval date, and replace every `confirm` comment
with a verified value or omit the optional field. In particular, account for
Groq's tier-dependent 25 MB/100 MB upload limits and 10-second minimum billing;
a single 25 MB model cap is conservative but should be described as such.

### P2 — maintainability and coverage

#### 10. Groq should be modeled consistently as a built-in provider

The string index means `apiKey.groq` works at runtime, but the plan leaves Groq
out of the exported `ProviderSchema`/`Provider` list and lacks a named `groq?`
key. Add `"groq"` to the built-in provider schema, add the named key to public
and local key shapes, and test both schema acceptance and `GROQ_API_KEY`
fallback. A built-in should not look like an anonymous custom provider in the
public types.

#### 11. Gemini usage parsing is duplicated and unnecessarily untyped

Tasks 7 and 8 copy `modalityTokens()` verbatim and cast typed SDK responses to
`Record<string, unknown>`. The installed SDK already exports typed usage
metadata and modality token details.

Create one internal typed Google usage-normalization helper shared by STT and
TTS. Its declarative result should be `TokenUsage`; it should not calculate
cost. This keeps provider response mechanics encapsulated without duplicating
imperative loops.

#### 12. Add tests for the actual declarative dispatch path

All proposed provider tests pass an explicit `provider`, so they do not prove
that model metadata selects the correct built-in. Add tests omitting `provider`
for at least one Groq STT model, one Groq TTS model, and one Gemini model. Also
cover the Groq `wav` default, Gemini encoded-size failure, Gemini's unsupported
timestamp option, and absence of the false 8,000-character rejection.

#### 13. Task 9's expected seed diff is internally inconsistent

Regeneration cannot be “additions only”: Task 7 also modifies the existing
`google:gemini-2.5-flash` record, and `generatedAt` changes. Replace that
expectation with a semantic parity check for all affected `provider:modelName`
records and inspect unrelated model changes separately.

### Declarative-interface assessment

After the corrections above, the architecture will satisfy the intended
declarative/imperative split:

- **Declarative:** `transcribe()` / `speak()`, model capability and constraint
  records, provider registration, and one shared token-pricing interface.
- **Imperative but encapsulated:** OpenAI-compatible request construction,
  Groq defaults, Gemini MIME translation and encoded-size enforcement, SDK
  calls, PCM extraction/WAV wrapping, and typed usage normalization.

As currently written, the public operation surface is declarative, but Tasks 5,
6, 7, and 8 undermine the internal abstraction quality through duplicate
predicates, duplicate pricing logic, duplicate response parsing, and leaked
provider defaults. The fixes above preserve the good public interface while
making the internals match it.

</details>
