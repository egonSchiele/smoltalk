# Multi-provider STT/TTS (Gemini + Groq) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `transcribe()` (speech-to-text) and `speak()` (text-to-speech) beyond OpenAI to Google Gemini (native multimodal) and Groq (OpenAI-compatible), with no change to the public call surface.

**Architecture:** Groq reuses the existing OpenAI audio clients with a different base URL (one small refactor + two tiny subclasses). Gemini uses the already-present `@google/genai` SDK's `generateContent`: STT sends audio inline + an instruction and reads text back; TTS requests an `AUDIO` response modality and returns raw PCM (optionally WAV-wrapped). A reframed STT guard ("can this model accept audio input?") and a token-priced cost path make Gemini a first-class citizen.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), vitest, `openai` SDK, `@google/genai` SDK, Zod. pnpm workspace.

## Global Constraints

- ES Modules: every internal import uses a `.js` extension. Package is `"type": "module"`.
- Strict TypeScript (`strict: true`). No `any` leaking into public types.
- Public audio operations always return `Result<T>` — never throw. The base template method and the internal factory are the only exception boundaries; provider subclasses (`_transcribe`/`_speak`) never `try/catch` and never compute cost.
- Model constraints are **data** in `lib/models.ts`, never hardcoded in client logic. MIME values in model records are **canonical** (`audio/mpeg`, `audio/wav`, …), never aliases.
- Tests live beside implementation with a `.test.ts` suffix; use `vitest` (`pnpm test`).
- Run from `packages/smoltalk/`. `pnpm typecheck` must pass after every task.
- No new runtime dependencies (`openai` and `@google/genai` are already present).
- Do not edit `data/model-data.json` by hand — regenerate with `pnpm seed-data`.

---

## File Structure

```
lib/transcription/openai.ts     MODIFY  extract makeClient()
lib/speech/openai.ts            MODIFY  extract makeClient()
lib/transcription/groq.ts       CREATE  GroqTranscriptionClient
lib/speech/groq.ts              CREATE  GroqSpeechClient
lib/transcription/google.ts     CREATE  GoogleTranscriptionClient
lib/speech/google.ts            CREATE  GoogleSpeechClient
lib/transcription.ts            MODIFY  register "groq"+"google" builtins
lib/speech.ts                   MODIFY  register "groq"+"google"; SpeechResult.usage
lib/util/provider.ts            MODIFY  resolveApiKey case "groq"
lib/util/audioMime.ts           MODIFY  pcmToWav() helper
lib/transcription/baseTranscriptionClient.ts  MODIFY  B1 guard + audioInputConstraints; token cost
lib/speech/baseSpeechClient.ts  MODIFY  token cost path
lib/models.ts                   MODIFY  modelAcceptsAudioInput(); audioInputConstraints();
                                        TextModel audio-input fields; TextToSpeechModel audio
                                        token fields; groq + gemini model records
lib/model.ts                    MODIFY  calculateAudioTokenCost()
data/model-data.json            REGEN   pnpm seed-data
docs/dev/audio.md, README.md    MODIFY  document Gemini + Groq
```

---

## Task 1: Make the OpenAI audio SDK client overridable

**Files:**
- Modify: `lib/transcription/openai.ts`
- Modify: `lib/speech/openai.ts`
- Test: existing `lib/transcription/openai.test.ts`, `lib/speech/openai.test.ts` (must stay green)

**Interfaces:**
- Produces: `protected makeClient(): OpenAI` on both `OpenAITranscriptionClient` and `OpenAISpeechClient`. Default returns `new OpenAI({ apiKey: this.config.apiKey })`. Groq subclasses (Tasks 2–3) override it.

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

- [ ] **Step 3: Extract `makeClient()` in the speech client**

In `lib/speech/openai.ts`, same change:

```typescript
export class OpenAISpeechClient extends BaseSpeechClient {
  /** Build the OpenAI SDK client. Subclasses override to point at a compatible base URL. */
  protected makeClient(): OpenAI {
    return new OpenAI({ apiKey: this.config.apiKey });
  }

  protected async _speak(text: string): Promise<Result<SpeechResult>> {
    // ...unchanged preflight...
    const client = this.makeClient();   // was: new OpenAI({ apiKey: this.config.apiKey })
    // ...rest unchanged...
```

- [ ] **Step 4: Typecheck and re-run the tests (pure refactor, still green)**

Run: `pnpm typecheck && pnpm test -- openai.test`
Expected: PASS, unchanged behavior.

- [ ] **Step 5: Commit**

```bash
git add lib/transcription/openai.ts lib/speech/openai.ts
git commit -m "refactor: extract makeClient() hook in OpenAI audio clients"
```

---

## Task 2: Groq transcription (STT)

**Files:**
- Create: `lib/transcription/groq.ts`
- Modify: `lib/transcription.ts` (register `"groq"`)
- Modify: `lib/util/provider.ts` (`resolveApiKey` case `"groq"`)
- Modify: `lib/models.ts` (append Groq STT model records)
- Test: `lib/transcription/groq.test.ts`

**Interfaces:**
- Consumes: `OpenAITranscriptionClient.makeClient()` (Task 1); `builtinClients` map in `lib/transcription.ts`.
- Produces: `class GroqTranscriptionClient extends OpenAITranscriptionClient`; provider name `"groq"` resolvable by the transcription factory; env fallback `GROQ_API_KEY`.

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

- [ ] **Step 4: Register the provider and env-var fallback**

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

- [ ] **Step 5: Add Groq STT model records**

In `lib/models.ts`, append to the `speechToTextModels` array (verify per-minute
prices against Groq's pricing page at implementation time — values below are
Groq's published rates as of 2026-08):

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
    maxBytes: 25 * 1024 * 1024,    // Groq free-tier upload cap; confirm current value
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

Run: `pnpm typecheck && pnpm test -- groq.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/transcription/groq.ts lib/transcription.ts lib/util/provider.ts lib/models.ts lib/transcription/groq.test.ts
git commit -m "feat: Groq speech-to-text (OpenAI-compatible)"
```

---

## Task 3: Groq speech (TTS)

**Files:**
- Create: `lib/speech/groq.ts`
- Modify: `lib/speech.ts` (register `"groq"`)
- Modify: `lib/models.ts` (append Groq TTS model record)
- Test: `lib/speech/groq.test.ts`

**Interfaces:**
- Consumes: `OpenAISpeechClient.makeClient()` (Task 1); `resolveApiKey` case `"groq"` (Task 2).
- Produces: `class GroqSpeechClient extends OpenAISpeechClient`; `"groq"` resolvable by the speech factory.

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

  it("routes to the Groq base URL and returns audio bytes", async () => {
    const res = await speak("hello", {
      model: "playai-tts",
      voice: "Fritz-PlayAI",
      provider: "groq",
      apiKey: { groq: "gk-test" },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(Array.from(res.value.audio)).toEqual([9, 9, 9]);
    }
    expect((OpenAI as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({
      apiKey: "gk-test",
      baseURL: "https://api.groq.com/openai/v1",
    });
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
 * Groq exposes an OpenAI-compatible /audio/speech endpoint (PlayAI TTS).
 * Everything but the base URL is inherited.
 */
export class GroqSpeechClient extends OpenAISpeechClient {
  protected override makeClient(): OpenAI {
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
}
```

- [ ] **Step 4: Register the provider**

In `lib/speech.ts`:

```typescript
import { GroqSpeechClient } from "./speech/groq.js";
// ...
builtinClients["openai"] = OpenAISpeechClient;
builtinClients["groq"] = GroqSpeechClient;   // add
```

- [ ] **Step 5: Add the Groq TTS model record**

In `lib/models.ts`, append to `textToSpeechModels` (verify id/voices/formats/price
against Groq docs at implementation time; Groq's PlayAI TTS returns `wav`):

```typescript
  {
    type: "text-to-speech",
    modelName: "playai-tts",
    provider: "groq",
    perCharacterCost: 0.00005,     // confirm current PlayAI rate
    maxInputChars: 10000,          // confirm current limit
    formats: ["wav"],
  },
```

Note: Groq TTS reuses `OpenAISpeechClient._speak`, which narrows `format` to
OpenAI's `SpeakFormat` union via `isSpeakFormat`. `wav` is in that union, so
default (mp3) callers must pass `format: "wav"` for Groq; the model record's
`formats: ["wav"]` makes the base reject other formats with a clear message.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- speech/groq.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/speech/groq.ts lib/speech.ts lib/models.ts lib/speech/groq.test.ts
git commit -m "feat: Groq text-to-speech (OpenAI-compatible)"
```

---

## Task 4: `pcmToWav` helper

**Files:**
- Modify: `lib/util/audioMime.ts`
- Test: `lib/util/audioMime.test.ts` (create if absent)

**Interfaces:**
- Produces: `export function pcmToWav(pcm: Uint8Array, opts: { sampleRateHz: number; channels: number; bitsPerSample: number }): Uint8Array` — prepends a 44-byte RIFF/WAVE header for signed-integer little-endian PCM. Used by `GoogleSpeechClient` (Task 8).

- [ ] **Step 1: Write the failing test**

Create/append `lib/util/audioMime.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pcmToWav } from "./audioMime.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- audioMime.test`
Expected: FAIL — `pcmToWav is not a function`.

- [ ] **Step 3: Implement `pcmToWav`**

Append to `lib/util/audioMime.ts`:

```typescript
/**
 * Wrap raw signed-integer little-endian PCM in a 44-byte RIFF/WAVE header so it
 * becomes a directly-playable .wav. Pure function, no dependency. Used for
 * Gemini TTS output, which is only ever raw PCM.
 */
export function pcmToWav(
  pcm: Uint8Array,
  opts: { sampleRateHz: number; channels: number; bitsPerSample: number },
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

Run: `pnpm typecheck && pnpm test -- audioMime.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/util/audioMime.ts lib/util/audioMime.test.ts
git commit -m "feat: pcmToWav helper for wrapping raw PCM"
```

---

## Task 5: Reframe the STT guard (B1) — "can this model accept audio input?"

**Files:**
- Modify: `lib/models.ts` (add `modelAcceptsAudioInput`, `audioInputConstraints`; add `supportedMimeTypes?` / `maxBytes?` to `TextModel`)
- Modify: `lib/transcription/baseTranscriptionClient.ts` (use the new predicate + constraints)
- Test: `lib/transcription.guard.test.ts`

**Interfaces:**
- Produces:
  - `export function modelAcceptsAudioInput(model: ModelType): boolean` — `true` for `type === "speech-to-text"`, or `type === "text"` whose `modalities.input` includes `"audio"`.
  - `export function audioInputConstraints(model: ModelType): { maxBytes?: number; supportedMimeTypes?: readonly string[] }`.
  - `TextModel` gains optional `supportedMimeTypes?: readonly string[]` and `maxBytes?: number`.
- Consumes: `getModelForProvider` (existing).

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
      textModels: [{
        type: "text", modelName: "fake-mm", provider: "fake",
        maxInputTokens: 1000, maxOutputTokens: 1000,
        modalities: { input: ["text", "audio"], output: ["text"] },
      }],
    } as unknown as ModelDataBlob;

    const res = await transcribe(src, { model: "fake-mm", provider: "fake", modelData });
    expect(res.success).toBe(true);
  });

  it("rejects a text model that does NOT list audio input", async () => {
    const modelData: ModelDataBlob = {
      textModels: [{
        type: "text", modelName: "fake-textonly", provider: "fake",
        maxInputTokens: 1000, maxOutputTokens: 1000,
        modalities: { input: ["text"], output: ["text"] },
      }],
    } as unknown as ModelDataBlob;

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

- [ ] **Step 3: Add the predicate, constraints reader, and TextModel fields**

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

Add near the other `is*Model` guards:

```typescript
/** Whether a model is a valid transcription target: a dedicated STT model, or a
 *  multimodal text model that accepts audio input (e.g. Gemini). */
export function modelAcceptsAudioInput(model: ModelType): boolean {
  if (model.type === "speech-to-text") return true;
  if (model.type === "text") return model.modalities?.input?.includes("audio") ?? false;
  return false;
}

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
  modelAcceptsAudioInput,
  audioInputConstraints,
  type SpeechToTextModel,
} from "../models.js";
```

Replace the guard (was `!isSpeechToTextModel(model)`):

```typescript
      const model = getModelForProvider(this.config.provider, this.config.model, this.config.modelData);
      if (model !== undefined && !modelAcceptsAudioInput(model)) {
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

Also add a `type-not-transcription` check preserved for dedicated models: if the
model IS a `speech-to-text` model but malformed, the same path applies — no extra
code needed. Remove the now-unused `isSpeechToTextModel` import if nothing else
uses it.

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
- Modify: `lib/model.ts` (add `calculateAudioTokenCost`)
- Modify: `lib/models.ts` (add `inputAudioTokenCost?` / `outputAudioTokenCost?` to `TextToSpeechModel`)
- Modify: `lib/speech.ts` (add `usage?: TokenUsage` to `SpeechResult`)
- Modify: `lib/transcription/baseTranscriptionClient.ts` and `lib/speech/baseSpeechClient.ts` (fall back to token cost)
- Test: `lib/model.audioTokenCost.test.ts`

**Interfaces:**
- Produces: `export function calculateAudioTokenCost(model: ModelType | undefined, usage: TokenUsage | undefined): CostEstimate | undefined` in `lib/model.ts`. Prices four disjoint buckets (text/audio × in/out) from a model's optional token-cost fields; returns `undefined` when the model has no token rates or `usage` is absent.
- Consumes: `TokenUsage` (`lib/types/tokenUsage.ts`), `CostEstimate` (`lib/types/costEstimate.ts`), `round` (`lib/util/util.ts`).

- [ ] **Step 1: Write the failing test**

Create `lib/model.audioTokenCost.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { calculateAudioTokenCost } from "./model.js";
import type { ModelType } from "./models.js";

describe("calculateAudioTokenCost", () => {
  it("prices STT audio-input tokens at the audio rate", () => {
    const model = {
      type: "text", modelName: "gem-stt", provider: "google",
      maxInputTokens: 1, maxOutputTokens: 1,
      inputTokenCost: 0.30, outputTokenCost: 2.50, inputAudioTokenCost: 1.00,
    } as unknown as ModelType;

    const cost = calculateAudioTokenCost(model, {
      inputTokens: 100, inputAudioTokens: 1_000_000, outputTokens: 50,
    });
    // inputAudio: 1,000,000/1e6 * 1.00 = 1.00 ; input text 100/1e6*0.30 ≈ 0.00003
    // output: 50/1e6 * 2.50 ≈ 0.000125
    expect(cost).toEqual({
      inputCost: 1.00003,
      outputCost: 0.000125,
      totalCost: 1.000155,
      currency: "USD",
    });
  });

  it("prices TTS text-in + audio-out tokens", () => {
    const model = {
      type: "text-to-speech", modelName: "gem-tts", provider: "google",
      inputTokenCost: 0.50, outputAudioTokenCost: 10.0,
    } as unknown as ModelType;

    const cost = calculateAudioTokenCost(model, {
      inputTokens: 1_000_000, outputTokens: 0, outputAudioTokens: 1_000_000,
    });
    expect(cost).toEqual({
      inputCost: 0.5, outputCost: 10.0, totalCost: 10.5, currency: "USD",
    });
  });

  it("returns undefined when the model has no token rates", () => {
    const model = {
      type: "text-to-speech", modelName: "x", provider: "p", perCharacterCost: 0.001,
    } as unknown as ModelType;
    expect(calculateAudioTokenCost(model, { inputTokens: 5, outputTokens: 5 })).toBeUndefined();
  });

  it("returns undefined when usage is missing", () => {
    const model = { type: "text", modelName: "y", provider: "p", inputTokenCost: 1 } as unknown as ModelType;
    expect(calculateAudioTokenCost(model, undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- audioTokenCost.test`
Expected: FAIL — `calculateAudioTokenCost is not a function`.

- [ ] **Step 3: Add the audio-token fields to `TextToSpeechModel`**

In `lib/models.ts`:

```typescript
export type TextToSpeechModel = BaseModel & {
  type: "text-to-speech";
  perCharacterCost?: number;
  // Token-based pricing (e.g. Gemini TTS): text input + audio output.
  inputAudioTokenCost?: number;   // per 1M audio-input tokens
  outputAudioTokenCost?: number;  // per 1M audio-output tokens
  maxInputChars?: number;
  speedRange?: { min: number; max: number };
  formats?: readonly string[];
};
```

(`inputTokenCost` / `outputTokenCost` are already on `BaseModel`.)

- [ ] **Step 4: Implement `calculateAudioTokenCost`**

Append to `lib/model.ts`:

```typescript
import type { TokenUsage } from "./types/tokenUsage.js";

/**
 * Token-based audio cost for providers that bill by tokens (Gemini), priced
 * across four disjoint buckets (text/audio × in/out). Audio buckets fall back to
 * the text rate when no audio rate is set, so totals stay honest. Returns
 * undefined when the model carries no token rates or usage is absent — same
 * omit-don't-error semantics as the per-minute/per-char helpers.
 */
export function calculateAudioTokenCost(
  model: ModelType | undefined,
  usage: TokenUsage | undefined,
): CostEstimate | undefined {
  if (model === undefined || usage === undefined) {
    return undefined;
  }
  const m = model as {
    inputTokenCost?: number;
    outputTokenCost?: number;
    inputAudioTokenCost?: number;
    outputAudioTokenCost?: number;
  };
  const hasRates =
    m.inputTokenCost !== undefined ||
    m.outputTokenCost !== undefined ||
    m.inputAudioTokenCost !== undefined ||
    m.outputAudioTokenCost !== undefined;
  if (!hasRates) {
    return undefined;
  }

  const U = 1_000_000;
  const inputAudioRate = m.inputAudioTokenCost ?? m.inputTokenCost ?? 0;
  const outputAudioRate = m.outputAudioTokenCost ?? m.outputTokenCost ?? 0;

  const inputCost = round(
    ((usage.inputTokens || 0) * (m.inputTokenCost ?? 0) +
      (usage.inputAudioTokens || 0) * inputAudioRate) / U,
    6,
  );
  const outputCost = round(
    ((usage.outputTokens || 0) * (m.outputTokenCost ?? 0) +
      (usage.outputAudioTokens || 0) * outputAudioRate) / U,
    6,
  );
  return {
    inputCost,
    outputCost,
    totalCost: round(inputCost + outputCost, 6),
    currency: "USD",
  };
}
```

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
import { calculateTranscriptionCost, calculateAudioTokenCost } from "../model.js";
// ...after `const result = await this._transcribe(...)` success check:
      let cost = calculateTranscriptionCost(model, result.value.durationSeconds);
      if (cost === undefined) {
        cost = calculateAudioTokenCost(model, result.value.usage);
      }
      if (cost !== undefined) {
        result.value.cost = cost;
      }
```

In `lib/speech/baseSpeechClient.ts`, import and update the cost step:

```typescript
import { calculateSpeechCost, calculateAudioTokenCost } from "../model.js";
// ...after `const result = await this._speak(text)` success check:
      let cost = calculateSpeechCost(model, [...text].length);
      if (cost === undefined) {
        cost = calculateAudioTokenCost(model, result.value.usage);
      }
      if (cost !== undefined) {
        result.value.cost = cost;
      }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- audioTokenCost.test speech.test transcription.test`
Expected: PASS. Existing OpenAI/Groq cost behavior is unchanged (per-minute/per-char still resolves first; the token fallback only fires when the primary returns undefined).

- [ ] **Step 7: Commit**

```bash
git add lib/model.ts lib/models.ts lib/speech.ts lib/transcription/baseTranscriptionClient.ts lib/speech/baseSpeechClient.ts lib/model.audioTokenCost.test.ts
git commit -m "feat: token-priced cost path for audio (Gemini)"
```

---

## Task 7: Gemini transcription (STT)

**Files:**
- Create: `lib/transcription/google.ts`
- Modify: `lib/transcription.ts` (register `"google"`)
- Modify: `lib/models.ts` (Gemini STT model record)
- Test: `lib/transcription/google.test.ts`

**Interfaces:**
- Consumes: `BaseTranscriptionClient` (base template method + guard from Task 5); `loadBlob` (`lib/util/blobRef.ts`); `TranscriptionResult` (`lib/transcription.ts`).
- Produces: `class GoogleTranscriptionClient extends BaseTranscriptionClient` implementing `_transcribe`; provider `"google"` resolvable by the transcription factory.

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
      { model: "gemini-2.5-flash", provider: "google", apiKey: { google: "gk" }, language: "en" },
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- transcription/google.test`
Expected: FAIL — `Provider "google" has no transcription API`.

- [ ] **Step 3: Create the Gemini transcription client**

Create `lib/transcription/google.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";
import { Result, success, failure } from "../types/result.js";
import { BaseTranscriptionClient } from "./baseTranscriptionClient.js";
import type { TranscriptionResult } from "../transcription.js";
import type { TokenUsage } from "../types/tokenUsage.js";

/** Sum token counts for a given modality from Gemini usage-detail arrays. */
function modalityTokens(details: unknown, modality: string): number {
  if (!Array.isArray(details)) return 0;
  let sum = 0;
  for (const d of details) {
    if (d && typeof d === "object" && (d as { modality?: string }).modality === modality) {
      const n = (d as { tokenCount?: number }).tokenCount;
      if (typeof n === "number") sum += n;
    }
  }
  return sum;
}

export class GoogleTranscriptionClient extends BaseTranscriptionClient {
  // No try/catch: BaseTranscriptionClient.transcribe() is the exception boundary.
  protected async _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>> {
    if (!this.config.apiKey) {
      return failure("No Google API key provided. Set apiKey.google or GEMINI_API_KEY.");
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
    const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
    const res = await ai.models.generateContent({
      model: this.config.model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: instruction },
        ],
      }],
    });

    const meta = (res as { usageMetadata?: Record<string, unknown> }).usageMetadata;
    let usage: TokenUsage | undefined;
    if (meta) {
      const prompt = (meta.promptTokenCount as number) || 0;
      const audioIn = modalityTokens(meta.promptTokensDetails, "AUDIO");
      usage = {
        inputTokens: Math.max(0, prompt - audioIn),
        outputTokens: (meta.candidatesTokenCount as number) || 0,
        totalTokens: meta.totalTokenCount as number | undefined,
      };
      if (audioIn > 0) usage.inputAudioTokens = audioIn;
    }

    const result: TranscriptionResult = {
      text: (res as { text?: string }).text ?? "",
      raw: res,
    };
    if (usage) result.usage = usage;
    return success(result);
  }
}
```

- [ ] **Step 4: Register the provider**

In `lib/transcription.ts`:

```typescript
import { GoogleTranscriptionClient } from "./transcription/google.js";
// ...
builtinClients["google"] = GoogleTranscriptionClient;   // add
```

- [ ] **Step 5: Add the Gemini STT model record**

In `lib/models.ts`, append to `textModels` a record for the transcription model, OR
augment the existing `gemini-2.5-flash` text record if present. It must declare
`audio` as an input modality and carry audio-input constraints + token rates
(verify prices against Gemini's pricing page at implementation time):

```typescript
  {
    type: "text",
    modelName: "gemini-2.5-flash",
    provider: "google",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65_536,
    modalities: { input: ["text", "image", "pdf", "audio"], output: ["text"] },
    inputTokenCost: 0.30,
    outputTokenCost: 2.50,
    inputAudioTokenCost: 1.00,
    supportedMimeTypes: ["audio/wav", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac", "audio/aiff"],
    maxBytes: 20 * 1024 * 1024,   // Gemini inline request ceiling; confirm current value
  },
```

If `gemini-2.5-flash` already exists in `textModels`, MODIFY that entry instead of
adding a duplicate (the registry key is `provider:modelName`): add `"audio"` to
`modalities.input`, and add `inputAudioTokenCost`, `supportedMimeTypes`, `maxBytes`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm typecheck && pnpm test -- transcription/google.test transcription.guard.test`
Expected: PASS (the guard now accepts `gemini-2.5-flash` because it lists `audio` input).

- [ ] **Step 7: Commit**

```bash
git add lib/transcription/google.ts lib/transcription.ts lib/models.ts lib/transcription/google.test.ts
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
- Consumes: `BaseSpeechClient`; `pcmToWav` (Task 4); `SpeechResult` (`lib/speech.ts`).
- Produces: `class GoogleSpeechClient extends BaseSpeechClient` implementing `_speak`; provider `"google"` resolvable by the speech factory.

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
      provider: "google", apiKey: { google: "gk" },
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
import { BaseSpeechClient } from "./baseSpeechClient.js";
import type { SpeechResult, PcmAudioMetadata } from "../speech.js";
import type { TokenUsage } from "../types/tokenUsage.js";

const GEMINI_PCM: PcmAudioMetadata = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };

function modalityTokens(details: unknown, modality: string): number {
  if (!Array.isArray(details)) return 0;
  let sum = 0;
  for (const d of details) {
    if (d && typeof d === "object" && (d as { modality?: string }).modality === modality) {
      const n = (d as { tokenCount?: number }).tokenCount;
      if (typeof n === "number") sum += n;
    }
  }
  return sum;
}

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

    const dataB64 = (res as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    }).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
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

    const meta = (res as { usageMetadata?: Record<string, unknown> }).usageMetadata;
    let usage: TokenUsage | undefined;
    if (meta) {
      const audioOut =
        modalityTokens(meta.candidatesTokensDetails, "AUDIO") ||
        ((meta.candidatesTokenCount as number) || 0);
      usage = {
        inputTokens: (meta.promptTokenCount as number) || 0,
        outputTokens: 0,
        outputAudioTokens: audioOut,
        totalTokens: meta.totalTokenCount as number | undefined,
      };
    }

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

In `lib/models.ts`, append to `textToSpeechModels` (verify ids/limits/prices against
Gemini docs at implementation time):

```typescript
  {
    type: "text-to-speech",
    modelName: "gemini-2.5-flash-preview-tts",
    provider: "google",
    inputTokenCost: 0.50,          // per 1M text-input tokens; confirm
    outputAudioTokenCost: 10.0,    // per 1M audio-output tokens; confirm
    maxInputChars: 8000,           // confirm current limit
    formats: ["pcm", "wav"],
  },
  {
    type: "text-to-speech",
    modelName: "gemini-2.5-pro-preview-tts",
    provider: "google",
    inputTokenCost: 1.0,           // confirm
    outputAudioTokenCost: 20.0,    // confirm
    maxInputChars: 8000,
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
Then confirm the diff only adds the new Groq/Gemini records:

Run: `git diff --stat data/model-data.json`
Expected: `data/model-data.json` changed (additions only).

- [ ] **Step 3: Extend the seed-data test to the new constraint fields**

In `tests/seed-model-data.test.ts`, add assertions that the committed
`data/model-data.json` carries the new records with their audio constraint/cost
fields — mirror the existing per-model comparison style already in that file for
`whisper-1` / `tts-1`. Add cases for: `whisper-large-v3` (`perMinuteCost`,
`supportedMimeTypes`, `maxBytes`), `playai-tts` (`formats`), `gemini-2.5-flash`
(`modalities.input` includes `"audio"`, `supportedMimeTypes`, `inputAudioTokenCost`),
and `gemini-2.5-flash-preview-tts` (`formats`, `outputAudioTokenCost`).

- [ ] **Step 4: Update the developer docs**

In `docs/dev/audio.md`:
- Update the "Scope (v1)" section: audio STT/TTS now covers OpenAI, **Groq**
  (OpenAI-compatible), and **Google Gemini** (native `generateContent`).
- Add a short subsection "Provider shapes" describing: (a) OpenAI-compatible via
  `makeClient()` base-URL override (Groq); (b) Gemini native multimodal — STT =
  inline audio + instruction; TTS = `responseModalities: ["AUDIO"]` → raw PCM,
  optional WAV wrap; no numeric `speed`.
- Document the B1 guard change (`modelAcceptsAudioInput`) and the token-priced
  cost path (`calculateAudioTokenCost`) alongside the existing per-minute/per-char
  helpers.

In `packages/smoltalk/README.md`, extend the audio section with Gemini and Groq
usage examples:

```typescript
// Groq STT (OpenAI-compatible)
await transcribe(src, { model: "whisper-large-v3", provider: "groq" });

// Gemini STT (native)
await transcribe(src, { model: "gemini-2.5-flash", provider: "google" });

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
- Spec "open items to confirm" (Groq ids/prices, Gemini byte cap/prices, TTS field
  wiring) → surfaced inline in Tasks 2/3/7/8 with concrete starting values and a
  verify note, and resolved in Task 6 (`inputTokenCost`+`outputAudioTokenCost`). ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Pricing
numbers are concrete with an explicit "confirm current value" instruction — real
values, not placeholders.

**Type consistency:** `makeClient()`, `modelAcceptsAudioInput`,
`audioInputConstraints`, `calculateAudioTokenCost`, `pcmToWav`, `SpeechResult.usage`
are defined in one task and consumed with matching signatures downstream.
`TranscriptionResult.usage` already exists; `SpeechResult.usage` added in Task 6
before the Gemini TTS client (Task 8) uses it.

**Ordering note:** Task 5 (guard) and Task 6 (token cost) precede the Gemini
clients (Tasks 7–8), which depend on both. Groq (Tasks 1–3) is independent and
comes first as the simplest slice.
