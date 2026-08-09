# Audio: STT, TTS & Audio-in-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI speech-to-text (`transcribe()`), text-to-speech (`speak()`), and audio-in-chat (`AudioPart`) to the smoltalk core package, with correct cost accounting.

**Architecture:** `transcribe()`/`speak()` are top-level capability functions backed by a provider registry, mirroring `lib/embed.ts` — they do **not** go through `SmolClient`/`getClient()`. Audio-in-chat adds an `AudioPart` arm to the user content-part union and rides the existing text pipeline (renderers + attachment resolution + modality gates), with real audio-token pricing added to the OpenAI usage path.

**Tech Stack:** TypeScript (ESM, `.js` import extensions, `strict`), Zod schemas, `openai` SDK, vitest. pnpm workspace; all paths below are within `packages/smoltalk/`.

## Global Constraints

- **v1 is OpenAI-only.** STT built-in model allowlist = `{ whisper-1 }`; TTS allowlist = `{ tts-1, tts-1-hd }`; audio-chat models = `gpt-audio-1.5`, `gpt-audio-mini`. Every other provider returns/raises `Failure` for audio.
- **ESM imports use `.js` extensions**; `"type": "module"`; target ESNext, `strict: true`.
- **Public operations return `Result<T>`** (`success(v)` / `failure(msg)` from `lib/types/result.js`). `transcribe()`/`speak()` never throw — wrap all work in try/catch.
- **No ternaries / conditional spreads for control flow** — the maintainer prefers explicit `if` statements (existing conditional spreads inside object literals, e.g. `...(x ? {a} : {})`, already appear in the codebase and may be matched where idiomatic, but prefer explicit statements for new logic).
- **"Character" for TTS pricing = Unicode code points** (`[...text].length`), not `text.length`.
- **Tests live beside implementation** as `*.test.ts`; run with `pnpm test`. Cost-math tests inject known rates via `config.modelData` so they don't depend on exact catalog pricing.
- **Commit after each task** (frequent commits). Run `pnpm typecheck` before each commit.

---

## File Structure

**New files:**
- `lib/transcription.ts` — `transcribe()`, `TranscribeOptions`, `TranscriptionResult`, `TranscriptionProvider`, `registerTranscriptionProvider`, provider dispatch + allowlist.
- `lib/transcription/openai.ts` — `openaiTranscribe()` (whisper-1) + STT cost.
- `lib/speech.ts` — `speak()`, `SpeakOptions`, `SpeechResult`, `SpeechProvider`, `registerSpeechProvider`, dispatch + allowlist + preflight.
- `lib/speech/openai.ts` — `openaiSpeak()` (tts-1/tts-1-hd) + format→MIME + PCM + cost.
- `lib/util/audioMime.ts` — audio MIME↔extension maps + chat `input_audio` format derivation.
- `*.test.ts` beside each of the above, plus `lib/classes/message/contentParts.test.ts` additions.

**Modified files:**
- `lib/models.ts` — remove `whisper-web` stub + commented entry; add `whisper-1`, `TextToSpeechModel` type + `tts-1`/`tts-1-hd`, `gpt-audio-1.5`/`gpt-audio-mini`; `isTextToSpeechModel`; `TextToSpeechModelName`/`SpeechToTextModelName` aliases; merge into `getAllModels()`.
- `lib/types/tokenUsage.ts` — `inputAudioTokens`/`outputAudioTokens` (+ schema + `addTokenUsage`).
- `lib/model.ts` — `calculateCost()` disjoint text/audio buckets.
- `lib/clients/openai.ts` — parse audio token details in `calculateUsageAndCost()`.
- `lib/util/imageRef.ts` — extend `EXT_TO_MIME` with audio extensions.
- `lib/classes/message/contentParts.ts` — `AudioPart` + schema + unions.
- `lib/classes/message/index.ts` — `audioPart()` helper + export.
- `lib/classes/message/renderers/PartRenderer.ts` — `audio()` method + dispatch.
- `lib/classes/message/renderers/{OpenAIChatRenderer,JSONRenderer,OpenAIResponsesRenderer,GoogleRenderer,AnthropicRenderer}.ts` — `audio()`.
- `lib/classes/message/UserMessage.ts` — Ollama loop audio rejection.
- `lib/clients/resolveAttachments.ts` — audio branch in `messagesHaveAttachments` + `resolveMessageAttachments`.
- `lib/util/modalities.ts` — audio arm (provider-aware, positive) + OpenAI-only provider gate.
- `lib/index.ts` — re-export the new public surface.

---

## Task 1: Model registry — STT, TTS, and audio-chat entries

**Files:**
- Modify: `lib/models.ts` (`speechToTextModels` at ~116-133; `ModelType` union at ~110-114; guards at ~2082-2089; add `TextToSpeechModel`)
- Test: `lib/models.audio.test.ts`

**Interfaces:**
- Produces: `TextToSpeechModel` type; `isTextToSpeechModel(m): m is TextToSpeechModel`; registry entries `whisper-1` (speech-to-text, `perMinuteCost`), `tts-1`/`tts-1-hd` (text-to-speech, `perCharacterCost`), `gpt-audio-1.5`/`gpt-audio-mini` (text, `modalities.input` includes `"audio"`, with `inputTokenCost`/`outputTokenCost`/`inputAudioTokenCost`/`outputAudioTokenCost`); type aliases `SpeechToTextModelName`, `TextToSpeechModelName`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/models.audio.test.ts
import { describe, it, expect } from "vitest";
import {
  getModel,
  isTextToSpeechModel,
  isSpeechToTextModel,
  modelSupportsInputModality,
} from "./models.js";

describe("audio model registry", () => {
  it("has whisper-1 as a speech-to-text model with a per-minute cost", () => {
    const m = getModel("whisper-1");
    expect(m).toBeDefined();
    expect(isSpeechToTextModel(m!)).toBe(true);
    expect((m as any).perMinuteCost).toBeGreaterThan(0);
  });

  it("has tts-1 / tts-1-hd as text-to-speech models with a per-character cost", () => {
    for (const name of ["tts-1", "tts-1-hd"]) {
      const m = getModel(name);
      expect(isTextToSpeechModel(m!)).toBe(true);
      expect((m as any).perCharacterCost).toBeGreaterThan(0);
    }
  });

  it("declares audio input modality on gpt-audio-1.5 and gpt-audio-mini", () => {
    for (const name of ["gpt-audio-1.5", "gpt-audio-mini"]) {
      expect(modelSupportsInputModality(name, "audio")).toBe(true);
      const m = getModel(name)!;
      expect((m as any).inputAudioTokenCost).toBeGreaterThan(0);
    }
  });

  it("no longer exposes the whisper-web stub", () => {
    expect(getModel("whisper-web")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/models.audio.test.ts`
Expected: FAIL (whisper-1 undefined; `isTextToSpeechModel` not exported).

- [ ] **Step 3: Add the `TextToSpeechModel` type and union member**

In `lib/models.ts`, near `SpeechToTextModel` (~44) add:

```ts
export type TextToSpeechModel = BaseModel & {
  type: "text-to-speech";
  perCharacterCost?: number; // USD per input character (Unicode code point)
};
```

Add it to the `ModelType` union (~110):

```ts
export type ModelType =
  | SpeechToTextModel
  | TextToSpeechModel
  | TextModel
  | EmbeddingsModel
  | ImageModel;
```

- [ ] **Step 4: Replace the STT stub and add the TTS array**

Replace the `speechToTextModels` body (~116-133) and add `textToSpeechModels`:

```ts
export const speechToTextModels = [
  {
    type: "speech-to-text",
    modelName: "whisper-1",
    perMinuteCost: 0.006,
    provider: "openai",
  },
] as const;

export const textToSpeechModels = [
  { type: "text-to-speech", modelName: "tts-1", perCharacterCost: 0.000015, provider: "openai" },
  { type: "text-to-speech", modelName: "tts-1-hd", perCharacterCost: 0.00003, provider: "openai" },
] as const;
```

> Pricing note: these are the long-standing published rates. Before merge, confirm current pricing (and fill gpt-audio rates in Step 5) with the repo's `update-models` skill or the OpenAI pricing page.

- [ ] **Step 5: Add the audio-chat text-model entries**

Add to the `textModels` array (near the other OpenAI entries) two entries with the `audio` input modality and audio token rates:

```ts
{
  type: "text",
  modelName: "gpt-audio-1.5",
  description: "OpenAI GA audio chat model (Chat Completions). Text+audio in, text+audio out.",
  provider: "openai",
  modalities: { input: ["text", "audio"], output: ["text"] },
  inputTokenCost: 2.5,
  outputTokenCost: 10,
  inputAudioTokenCost: 32,
  outputAudioTokenCost: 64,
  maxInputTokens: 128000,
  maxOutputTokens: 16384,
},
{
  type: "text",
  modelName: "gpt-audio-mini",
  description: "Cost-efficient OpenAI audio chat model (Chat Completions).",
  provider: "openai",
  modalities: { input: ["text", "audio"], output: ["text"] },
  inputTokenCost: 0.6,
  outputTokenCost: 2.4,
  inputAudioTokenCost: 10,
  outputAudioTokenCost: 20,
  maxInputTokens: 128000,
  maxOutputTokens: 16384,
},
```

> Match the exact field names/shape used by neighboring `textModels` entries (copy an adjacent entry and adjust). Verify `modalities`/`maxInputTokens`/`maxOutputTokens` field names against a sibling entry before saving. Confirm the four `*TokenCost` values via `update-models` before merge.

- [ ] **Step 6: Add the guard and name aliases**

Near the other guards (~2082):

```ts
export function isTextToSpeechModel(model: ModelType): model is TextToSpeechModel {
  return model.type === "text-to-speech";
}
```

Near the existing `SpeechToTextModelName` alias (~1807):

```ts
export type SpeechToTextModelName = (typeof speechToTextModels)[number]["modelName"];
export type TextToSpeechModelName = (typeof textToSpeechModels)[number]["modelName"];
```

Ensure `getAllModels()` (search for where `speechToTextModels` is spread) also spreads `...textToSpeechModels`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/models.audio.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`
Also run the full suite once (removing `whisper-web` may touch `scripts/seed-model-data.ts` references — update any that break): `pnpm --filter smoltalk test`

- [ ] **Step 8: Commit**

```bash
git add lib/models.ts lib/models.audio.test.ts
git commit -m "feat(models): add whisper-1, tts-1/-hd, gpt-audio-1.5/mini; drop whisper-web stub"
```

---

## Task 2: Audio-token usage & cost accounting

**Files:**
- Modify: `lib/types/tokenUsage.ts`, `lib/model.ts` (`calculateCost` ~36-115), `lib/clients/openai.ts` (`calculateUsageAndCost` ~109-150)
- Test: `lib/model.audioCost.test.ts`

**Interfaces:**
- Consumes: `TextModel.inputAudioTokenCost`/`outputAudioTokenCost` (Task 1 sets them on gpt-audio models).
- Produces: `TokenUsage` gains `inputAudioTokens?`/`outputAudioTokens?`; `Model.calculateCost()` accepts and prices them.

- [ ] **Step 1: Write the failing test**

```ts
// lib/model.audioCost.test.ts
import { describe, it, expect } from "vitest";
import { Model } from "./model.js";

// Inject rates via modelData so the test is independent of catalog pricing.
const modelData = {
  textModels: [
    {
      type: "text",
      modelName: "audio-test",
      provider: "openai",
      inputTokenCost: 2, // $/1M text input
      outputTokenCost: 10,
      inputAudioTokenCost: 32, // $/1M audio input
      outputAudioTokenCost: 64,
    },
  ],
} as any;

describe("calculateCost with audio tokens", () => {
  it("prices audio and text buckets disjointly", () => {
    const m = new Model("audio-test", "openai", modelData);
    const cost = m.calculateCost({
      inputTokens: 1_000_000, // text-only portion
      outputTokens: 0,
      inputAudioTokens: 1_000_000, // audio portion
      outputAudioTokens: 0,
    });
    // text: 1M * $2/1M = $2 ; audio: 1M * $32/1M = $32
    expect(cost!.inputCost).toBeCloseTo(34, 5);
    expect(cost!.totalCost).toBeCloseTo(34, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/model.audioCost.test.ts`
Expected: FAIL — `inputCost` is 34-under (audio priced at text rate or ignored), and TS error on unknown `inputAudioTokens`.

- [ ] **Step 3: Extend `TokenUsage`**

In `lib/types/tokenUsage.ts` add the two optional fields to the type, the Zod schema, and `addTokenUsage`:

```ts
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  inputAudioTokens?: number;
  outputAudioTokens?: number;
  totalTokens?: number;
};
```
Add `inputAudioTokens: z.number().optional()` and `outputAudioTokens: z.number().optional()` to `TokenUsageSchema`, and sum them in `addTokenUsage` (mirroring `cachedInputTokens`).

- [ ] **Step 4: Price audio buckets in `calculateCost`**

In `lib/model.ts`, extend the `usage` param type with `inputAudioTokens?: number; outputAudioTokens?: number;`, then add audio dollars. After the existing `inputCost`/`outputCost` computation (~64-71):

```ts
const audioInputTokens = usage.inputAudioTokens ?? 0;
const audioOutputTokens = usage.outputAudioTokens ?? 0;
// Audio tokens are billed separately; fall back to the text rate if no audio
// rate is defined so the total stays honest rather than dropping the charge.
const audioInputRate = model.inputAudioTokenCost ?? model.inputTokenCost ?? 0;
const audioOutputRate = model.outputAudioTokenCost ?? model.outputTokenCost ?? 0;
const audioInputCost = round((audioInputTokens * audioInputRate) / 1_000_000, 6);
const audioOutputCost = round((audioOutputTokens * audioOutputRate) / 1_000_000, 6);
```

Fold `audioInputCost` into `finalInputCost` and `audioOutputCost` into the output side of `totalCost`:
- `finalInputCost = round(inputCost + foldedInputDollars + audioInputCost, 6)`
- add `audioOutputCost` to both the returned `outputCost` and `totalCost`.

Use explicit `if`/statements consistent with the file; do not introduce ternary control flow.

- [ ] **Step 5: Parse audio tokens in the OpenAI client**

In `lib/clients/openai.ts` `calculateUsageAndCost()` (~119-128), after reading `cached`, read the audio subsets and subtract them from the text buckets so buckets are disjoint:

```ts
const cached = usageData.prompt_tokens_details?.cached_tokens ?? 0;
const audioIn = usageData.prompt_tokens_details?.audio_tokens ?? 0;
const audioOut = usageData.completion_tokens_details?.audio_tokens ?? 0;
usage = {
  inputTokens: Math.max(0, (usageData.prompt_tokens || 0) - cached - audioIn),
  outputTokens: Math.max(0, (usageData.completion_tokens || 0) - audioOut),
  totalTokens: usageData.total_tokens,
};
if (cached > 0) usage.cachedInputTokens = cached;
if (audioIn > 0) usage.inputAudioTokens = audioIn;
if (audioOut > 0) usage.outputAudioTokens = audioOut;
```

`calculateCost(usage)` already receives the whole `usage` object, so no other change is needed there. (Both sync and stream flow through this one method.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/model.audioCost.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/types/tokenUsage.ts lib/model.ts lib/clients/openai.ts lib/model.audioCost.test.ts
git commit -m "feat(cost): price audio input/output tokens disjointly from text"
```

---

## Task 3: Audio MIME support

**Files:**
- Create: `lib/util/audioMime.ts`, `lib/util/audioMime.test.ts`
- Modify: `lib/util/imageRef.ts` (`EXT_TO_MIME` ~30-37)

**Interfaces:**
- Produces:
  - `TRANSCRIBE_MIME_TO_EXT: Record<string,string>` and `filenameForAudioMime(mime, fallback?): string`.
  - `chatAudioFormat(mime: string): "mp3" | "wav" | null` (for Chat `input_audio`).
  - `SPEECH_FORMAT_TO_MIME: Record<SpeakFormat, string>` where PCM → `application/octet-stream`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/util/audioMime.test.ts
import { describe, it, expect } from "vitest";
import { filenameForAudioMime, chatAudioFormat, SPEECH_FORMAT_TO_MIME } from "./audioMime.js";

describe("audioMime", () => {
  it("derives a filename with a real extension from a MIME type", () => {
    expect(filenameForAudioMime("audio/mpeg")).toBe("audio.mp3");
    expect(filenameForAudioMime("audio/wav")).toBe("audio.wav");
  });
  it("maps only mp3/wav for chat input_audio, null otherwise", () => {
    expect(chatAudioFormat("audio/mpeg")).toBe("mp3");
    expect(chatAudioFormat("audio/wav")).toBe("wav");
    expect(chatAudioFormat("audio/ogg")).toBeNull();
  });
  it("maps pcm output to application/octet-stream", () => {
    expect(SPEECH_FORMAT_TO_MIME.pcm).toBe("application/octet-stream");
    expect(SPEECH_FORMAT_TO_MIME.mp3).toBe("audio/mpeg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/util/audioMime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/util/audioMime.ts`**

```ts
export type SpeakFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

// Transcription upload MIME → canonical extension (API-reference formats).
export const TRANSCRIBE_MIME_TO_EXT: Record<string, string> = {
  "audio/flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

export function filenameForAudioMime(mime: string, fallback = "bin"): string {
  const ext = TRANSCRIBE_MIME_TO_EXT[mime] ?? fallback;
  return `audio.${ext}`;
}

// Chat Completions input_audio accepts only mp3 and wav.
export function chatAudioFormat(mime: string): "mp3" | "wav" | null {
  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
  return null;
}

// speak() output format → exact MIME. PCM is headerless s16le/24kHz/mono, which
// audio/L16 (big-endian per RFC) would misdescribe, so use octet-stream.
export const SPEECH_FORMAT_TO_MIME: Record<SpeakFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "application/octet-stream",
};
```

- [ ] **Step 4: Extend path-extension inference**

In `lib/util/imageRef.ts`, add audio extensions to `EXT_TO_MIME`:

```ts
".mp3": "audio/mpeg",
".wav": "audio/wav",
".m4a": "audio/m4a",
".mp4": "audio/mp4",
".ogg": "audio/ogg",
".flac": "audio/flac",
".webm": "audio/webm",
".mpga": "audio/mpeg",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/util/audioMime.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 6: Commit**

```bash
git add lib/util/audioMime.ts lib/util/audioMime.test.ts lib/util/imageRef.ts
git commit -m "feat(util): audio MIME maps + path-extension inference"
```

---

## Task 4: `transcribe()` — speech-to-text

**Files:**
- Create: `lib/transcription.ts`, `lib/transcription/openai.ts`, `lib/transcription.test.ts`
- Modify: `lib/index.ts` (exports)

**Interfaces:**
- Consumes: `loadBlob`/`BlobRef` (`util/imageRef.js`), `resolveProvider`/`resolveApiKey` (`util/provider.js`), `getModel`/`isSpeechToTextModel` (`models.js`), `filenameForAudioMime` (Task 3).
- Produces:
  ```ts
  export type TranscribeOptions = {
    model: string; provider?: string; modelData?: ModelDataBlob;
    apiKey?: SmolConfig["apiKey"]; language?: string; prompt?: string;
    timestampGranularity?: "segment" | "word"; maxBytes?: number; filename?: string;
  };
  export type TranscriptionResult = {
    text: string; language?: string; durationSeconds?: number;
    segments?: { start: number; end: number; text: string }[];
    words?: { start: number; end: number; word: string }[];
    usage?: TokenUsage; cost?: CostEstimate; raw?: unknown;
  };
  export type TranscriptionProvider = {
    transcribe(data: Uint8Array, mimeType: string,
      ctx: { apiKey: string; opts: TranscribeOptions }): Promise<Result<TranscriptionResult>>;
  };
  export function registerTranscriptionProvider(name: string, impl: TranscriptionProvider): void;
  export function transcribe(source: BlobRef, opts: TranscribeOptions): Promise<Result<TranscriptionResult>>;
  ```
- Built-in allowlist: `OPENAI_TRANSCRIBE_MODELS = new Set(["whisper-1"])`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/transcription.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribe, registerTranscriptionProvider } from "./transcription.js";

describe("transcribe()", () => {
  it("rejects an OpenAI model outside the built-in allowlist", async () => {
    const r = await transcribe(
      { kind: "base64", base64: "AAAA", mimeType: "audio/wav" },
      { model: "gpt-4o-transcribe", provider: "openai", apiKey: { openAi: "sk-x" } },
    );
    expect(r.success).toBe(false);
  });

  it("rejects a wrong-capability model", async () => {
    const r = await transcribe(
      { kind: "base64", base64: "AAAA", mimeType: "audio/wav" },
      { model: "gpt-4o-mini", provider: "openai", apiKey: { openAi: "sk-x" } },
    );
    expect(r.success).toBe(false);
  });

  it("dispatches an unknown model to an explicitly registered custom provider", async () => {
    registerTranscriptionProvider("myasr", {
      async transcribe() { return { success: true, value: { text: "hi" } }; },
    });
    const r = await transcribe(
      { kind: "base64", base64: "AAAA", mimeType: "audio/wav" },
      { model: "custom-1", provider: "myasr" },
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.value.text).toBe("hi");
  });

  it("converts a provider throw into a Failure", async () => {
    registerTranscriptionProvider("boom", {
      async transcribe() { throw new Error("kaboom"); },
    });
    const r = await transcribe(
      { kind: "base64", base64: "AAAA", mimeType: "audio/wav" },
      { model: "x", provider: "boom" },
    );
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/transcription.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/transcription.ts`**

```ts
import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, success, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { BlobRef, loadBlob } from "./util/imageRef.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { openaiTranscribe } from "./transcription/openai.js";

export type TranscribeOptions = {
  model: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  filename?: string;
};

export type TranscriptionResult = {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments?: { start: number; end: number; text: string }[];
  words?: { start: number; end: number; word: string }[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  raw?: unknown;
};

export type TranscriptionProvider = {
  transcribe(
    data: Uint8Array,
    mimeType: string,
    ctx: { apiKey: string; opts: TranscribeOptions },
  ): Promise<Result<TranscriptionResult>>;
};

export const OPENAI_TRANSCRIBE_MODELS = new Set(["whisper-1"]);
export const DEFAULT_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

const registered: Record<string, TranscriptionProvider> = Object.create(null);
export function registerTranscriptionProvider(name: string, impl: TranscriptionProvider): void {
  registered[name] = impl;
}
/** Test-only: clear custom providers so registrations don't leak across tests. */
export function _resetForTests(): void {
  for (const k of Object.keys(registered)) delete registered[k];
}

export async function transcribe(
  source: BlobRef,
  opts: TranscribeOptions,
): Promise<Result<TranscriptionResult>> {
  try {
    let provider: string;
    try {
      provider = resolveProvider(opts.model, opts.provider, opts.modelData);
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Failed to resolve provider");
    }

    const maxBytes = opts.maxBytes ?? DEFAULT_TRANSCRIBE_BYTES;
    let loaded: { data: Uint8Array; mimeType?: string };
    try {
      loaded = await loadBlob(source, { maxBytes });
    } catch (err) {
      return failure(`Failed to load audio for transcription: ${(err as Error).message}`);
    }
    const mimeType = loaded.mimeType ?? "application/octet-stream";

    if (provider === "openai") {
      if (!OPENAI_TRANSCRIBE_MODELS.has(opts.model)) {
        return failure(
          `Model "${opts.model}" is not a supported OpenAI transcription model in v1 (supported: ${[...OPENAI_TRANSCRIBE_MODELS].join(", ")}).`,
        );
      }
      const apiKey = resolveApiKey("openai", opts);
      if (!apiKey) {
        return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      }
      return openaiTranscribe(loaded.data, mimeType, { apiKey, opts });
    }

    const custom = registered[provider];
    if (custom) {
      return custom.transcribe(loaded.data, mimeType, { apiKey: resolveApiKey(provider, opts) ?? "", opts });
    }
    return failure(
      `Provider "${provider}" has no transcription API. Register one with registerTranscriptionProvider(name, impl).`,
    );
  } catch (err) {
    return failure(err instanceof Error ? err.message : "transcribe() failed");
  }
}
```

- [ ] **Step 4: Implement `lib/transcription/openai.ts`**

```ts
import OpenAI, { toFile } from "openai";
import { Result, success, failure } from "../types/result.js";
import { getModel, isSpeechToTextModel } from "../models.js";
import { round } from "../util/util.js";
import { filenameForAudioMime } from "../util/audioMime.js";
import type { TranscribeOptions, TranscriptionResult } from "../transcription.js";

export async function openaiTranscribe(
  data: Uint8Array,
  mimeType: string,
  ctx: { apiKey: string; opts: TranscribeOptions },
): Promise<Result<TranscriptionResult>> {
  try {
    const { opts } = ctx;
    // A wrong-capability model must fail even though the allowlist gate ran upstream.
    const model = getModel(opts.model, opts.modelData);
    if (model && !isSpeechToTextModel(model)) {
      return failure(`Model "${opts.model}" is not a speech-to-text model.`);
    }

    const client = new OpenAI({ apiKey: ctx.apiKey });
    const filename = opts.filename ?? filenameForAudioMime(mimeType);
    const file = await toFile(data, filename, { type: mimeType });

    const granularities: ("segment" | "word")[] = [];
    if (opts.timestampGranularity) granularities.push(opts.timestampGranularity);

    const res: any = await client.audio.transcriptions.create({
      file,
      model: opts.model,
      response_format: "verbose_json",
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
      ...(granularities.length ? { timestamp_granularities: granularities } : {}),
    });

    const result: TranscriptionResult = { text: res.text, raw: res };
    if (res.language) result.language = res.language;
    if (typeof res.duration === "number") result.durationSeconds = res.duration;
    if (Array.isArray(res.segments)) {
      result.segments = res.segments.map((s: any) => ({ start: s.start, end: s.end, text: s.text }));
    }
    if (Array.isArray(res.words)) {
      result.words = res.words.map((w: any) => ({ start: w.start, end: w.end, word: w.word }));
    }

    if (model && isSpeechToTextModel(model) && model.perMinuteCost && result.durationSeconds != null) {
      const inputCost = round((result.durationSeconds / 60) * model.perMinuteCost, 6);
      result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
    }
    return success(result);
  } catch (err) {
    return failure(err instanceof Error ? err.message : "OpenAI transcription request failed");
  }
}
```

> If `toFile` is not exported from your `openai` version, import it from `openai/uploads`. Verify against the installed SDK before finalizing.

- [ ] **Step 5: Export from the package index**

In `lib/index.ts`, add `export * from "./transcription.js";` (place near the `embed`/`image` exports).

- [ ] **Step 6: Add `_resetForTests()` to the test file**

Add `beforeEach(() => _resetForTests())` (import it) so registered providers don't leak.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/transcription.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 8: Commit**

```bash
git add lib/transcription.ts lib/transcription/openai.ts lib/transcription.test.ts lib/index.ts
git commit -m "feat(stt): add transcribe() with OpenAI whisper-1 provider"
```

---

## Task 5: `speak()` — text-to-speech

**Files:**
- Create: `lib/speech.ts`, `lib/speech/openai.ts`, `lib/speech.test.ts`
- Modify: `lib/index.ts`

**Interfaces:**
- Consumes: `resolveProvider`/`resolveApiKey`, `getModel`/`isTextToSpeechModel`, `SPEECH_FORMAT_TO_MIME`/`SpeakFormat` (Task 3).
- Produces:
  ```ts
  export type SpeakOptions = {
    model: string; voice: string; provider?: string; modelData?: ModelDataBlob;
    apiKey?: SmolConfig["apiKey"]; format?: SpeakFormat; speed?: number;
  };
  export type SpeechResult = {
    audio: Uint8Array; mimeType: string;
    pcm?: { sampleRateHz: 24000; sampleFormat: "s16le"; channels: 1 };
    cost?: CostEstimate; raw?: unknown;
  };
  export type SpeechProvider = { speak(text: string, ctx: { apiKey: string; opts: SpeakOptions }): Promise<Result<SpeechResult>>; };
  export function registerSpeechProvider(name: string, impl: SpeechProvider): void;
  export function speak(text: string, opts: SpeakOptions): Promise<Result<SpeechResult>>;
  ```
- Built-in allowlist: `OPENAI_SPEECH_MODELS = new Set(["tts-1", "tts-1-hd"])`. Constants: `MAX_TTS_CHARS = 4096`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/speech.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { speak, registerSpeechProvider, _resetForTests } from "./speech.js";

beforeEach(() => _resetForTests());

describe("speak()", () => {
  it("rejects out-of-range speed", async () => {
    const r = await speak("hi", { model: "tts-1", voice: "alloy", speed: 9, apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("rejects text over the 4096-char limit", async () => {
    const r = await speak("a".repeat(4097), { model: "tts-1", voice: "alloy", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("rejects an OpenAI model outside the allowlist", async () => {
    const r = await speak("hi", { model: "gpt-4o-mini-tts", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("dispatches unknown model to a registered custom provider", async () => {
    registerSpeechProvider("mytts", {
      async speak() { return { success: true, value: { audio: new Uint8Array([1]), mimeType: "audio/mpeg" } }; },
    });
    const r = await speak("hi", { model: "c1", voice: "v", provider: "mytts" });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/speech.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/speech.ts`**

```ts
import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, failure } from "./types/result.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { SpeakFormat } from "./util/audioMime.js";
import { openaiSpeak } from "./speech/openai.js";

export type SpeakOptions = {
  model: string;
  voice: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  format?: SpeakFormat;
  speed?: number;
};

export type SpeechResult = {
  audio: Uint8Array;
  mimeType: string;
  pcm?: { sampleRateHz: 24000; sampleFormat: "s16le"; channels: 1 };
  cost?: CostEstimate;
  raw?: unknown;
};

export type SpeechProvider = {
  speak(text: string, ctx: { apiKey: string; opts: SpeakOptions }): Promise<Result<SpeechResult>>;
};

export const OPENAI_SPEECH_MODELS = new Set(["tts-1", "tts-1-hd"]);
export const MAX_TTS_CHARS = 4096;

const registered: Record<string, SpeechProvider> = Object.create(null);
export function registerSpeechProvider(name: string, impl: SpeechProvider): void {
  registered[name] = impl;
}
export function _resetForTests(): void {
  for (const k of Object.keys(registered)) delete registered[k];
}

export async function speak(text: string, opts: SpeakOptions): Promise<Result<SpeechResult>> {
  try {
    if ([...text].length > MAX_TTS_CHARS) {
      return failure(`Input exceeds the ${MAX_TTS_CHARS}-character TTS limit.`);
    }
    if (opts.speed !== undefined) {
      if (!Number.isFinite(opts.speed) || opts.speed < 0.25 || opts.speed > 4.0) {
        return failure("speed must be a finite number in [0.25, 4.0].");
      }
    }

    let provider: string;
    try {
      provider = resolveProvider(opts.model, opts.provider, opts.modelData);
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Failed to resolve provider");
    }

    if (provider === "openai") {
      if (!OPENAI_SPEECH_MODELS.has(opts.model)) {
        return failure(
          `Model "${opts.model}" is not a supported OpenAI speech model in v1 (supported: ${[...OPENAI_SPEECH_MODELS].join(", ")}).`,
        );
      }
      const apiKey = resolveApiKey("openai", opts);
      if (!apiKey) return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      return openaiSpeak(text, { apiKey, opts });
    }

    const custom = registered[provider];
    if (custom) {
      return custom.speak(text, { apiKey: resolveApiKey(provider, opts) ?? "", opts });
    }
    return failure(
      `Provider "${provider}" has no speech API. Register one with registerSpeechProvider(name, impl).`,
    );
  } catch (err) {
    return failure(err instanceof Error ? err.message : "speak() failed");
  }
}
```

- [ ] **Step 4: Implement `lib/speech/openai.ts`**

```ts
import OpenAI from "openai";
import { Result, success, failure } from "../types/result.js";
import { getModel, isTextToSpeechModel } from "../models.js";
import { round } from "../util/util.js";
import { SPEECH_FORMAT_TO_MIME, SpeakFormat } from "../util/audioMime.js";
import type { SpeakOptions, SpeechResult } from "../speech.js";

export async function openaiSpeak(
  text: string,
  ctx: { apiKey: string; opts: SpeakOptions },
): Promise<Result<SpeechResult>> {
  try {
    const { opts } = ctx;
    const format: SpeakFormat = opts.format ?? "mp3";
    const mimeType = SPEECH_FORMAT_TO_MIME[format];
    if (!mimeType) return failure(`Unknown speech format "${format}".`);

    const client = new OpenAI({ apiKey: ctx.apiKey });
    const res = await client.audio.speech.create({
      model: opts.model,
      voice: opts.voice as any,
      input: text,
      response_format: format,
      ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    });
    const audio = new Uint8Array(await res.arrayBuffer());

    const result: SpeechResult = { audio, mimeType };
    if (format === "pcm") {
      result.pcm = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };
    }

    const model = getModel(opts.model, opts.modelData);
    if (model && isTextToSpeechModel(model) && model.perCharacterCost) {
      const inputCost = round([...text].length * model.perCharacterCost, 6);
      result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
    }
    return success(result);
  } catch (err) {
    return failure(err instanceof Error ? err.message : "OpenAI speech request failed");
  }
}
```

- [ ] **Step 5: Export from the package index**

In `lib/index.ts`, add `export * from "./speech.js";`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/speech.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/speech.ts lib/speech/openai.ts lib/speech.test.ts lib/index.ts
git commit -m "feat(tts): add speak() with OpenAI tts-1/tts-1-hd provider"
```

---

## Task 6: `AudioPart` type, schema, union & helper

**Files:**
- Modify: `lib/classes/message/contentParts.ts`, `lib/classes/message/index.ts`
- Test: `lib/classes/message/audioPart.test.ts`

**Interfaces:**
- Produces: `AudioPart = { type: "audio"; source: BlobRef; filename?: string }`; `AudioPartSchema`; `AudioPart` added to `UserContentPart`, `UserContentPartSchema`, `UserContentInput`; `audioPart(source, filename?)` helper (exported).

> Note: `AudioPart.source` is `BlobRef` (bytes/base64/path/url), NOT `AttachmentSource` — Chat `input_audio` has no `providerFile`/URL form.

- [ ] **Step 1: Write the failing test**

```ts
// lib/classes/message/audioPart.test.ts
import { describe, it, expect } from "vitest";
import { UserMessage, audioPart } from "./index.js";
import { messageFromJSON } from "./index.js";

describe("AudioPart", () => {
  it("builds an audio part and round-trips through JSON", () => {
    const part = audioPart({ kind: "base64", base64: "AAAA", mimeType: "audio/wav" });
    expect(part.type).toBe("audio");
    const msg = new UserMessage([part]);
    const json = JSON.parse(JSON.stringify(msg.toJSON()));
    const back = messageFromJSON(json) as UserMessage;
    const parts = back.getContentParts()!;
    expect(parts[0].type).toBe("audio");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/classes/message/audioPart.test.ts` → FAIL (`audioPart` not exported).

- [ ] **Step 3: Add the type, schema, and unions**

In `lib/classes/message/contentParts.ts`:

```ts
export type AudioPart = {
  type: "audio";
  source: BlobRef; // bytes | base64 | path | url — resolved to base64 before send
  filename?: string;
};
```
Import `BlobRef` from `../../util/imageRef.js`. Add `AudioPart` to `UserContentPart` and `UserContentInput`. Add the schema (source is the ImageRef union without `providerFile`):

```ts
export const AudioPartSchema = z.object({
  type: z.literal("audio"),
  source: z.discriminatedUnion("kind", [...ImageRefSchema.options]),
  filename: z.string().optional(),
});
```
Add `AudioPartSchema` to `UserContentPartSchema`'s discriminated union.

- [ ] **Step 4: Add the `audioPart()` helper**

In `lib/classes/message/index.ts`, beside `imagePart`/`filePart` (~56-60):

```ts
export function audioPart(source: BlobRef, filename?: string): AudioPart {
  const part: AudioPart = { type: "audio", source };
  if (filename !== undefined) part.filename = filename;
  return part;
}
```
Import/re-export `AudioPart` and `BlobRef` as the neighboring helpers do.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/classes/message/audioPart.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

> Typecheck will likely surface non-exhaustive switches now that `UserContentPart` has a new arm. That is expected and is fixed in Task 7; if the build blocks progress, proceed directly to Task 7 before committing.

- [ ] **Step 6: Commit**

```bash
git add lib/classes/message/contentParts.ts lib/classes/message/index.ts lib/classes/message/audioPart.test.ts
git commit -m "feat(message): add AudioPart content part + audioPart() helper"
```

---

## Task 7: Renderer dispatch for `AudioPart`

**Files:**
- Modify: `lib/classes/message/renderers/PartRenderer.ts`, `.../OpenAIChatRenderer.ts`, `.../JSONRenderer.ts`, `.../OpenAIResponsesRenderer.ts`, `.../GoogleRenderer.ts`, `.../AnthropicRenderer.ts`, `lib/classes/message/UserMessage.ts`
- Test: `lib/classes/message/renderers/audioRender.test.ts`

**Interfaces:**
- Consumes: `AudioPart` (Task 6), `chatAudioFormat` (Task 3).
- Produces: `PartRenderer.audio(part: AudioPart): T`; `renderParts` dispatches `type === "audio"`; `OpenAIChatRenderer.audio()` emits `{ type: "input_audio", input_audio: { data, format } }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/classes/message/renderers/audioRender.test.ts
import { describe, it, expect } from "vitest";
import { OpenAIChatRenderer } from "./OpenAIChatRenderer.js";
import type { AudioPart } from "../contentParts.js";

describe("OpenAIChatRenderer.audio", () => {
  it("emits input_audio with base64 data and derived format", () => {
    const r = new OpenAIChatRenderer();
    const part: AudioPart = { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } };
    const out: any = r.audio(part);
    expect(out.type).toBe("input_audio");
    expect(out.input_audio.format).toBe("wav");
    expect(out.input_audio.data).toBe("AAAA");
  });
  it("throws for a non-mp3/wav audio mime", () => {
    const r = new OpenAIChatRenderer();
    const part: AudioPart = { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/ogg" } };
    expect(() => r.audio(part)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/classes/message/renderers/audioRender.test.ts` → FAIL (`audio` not on renderer).

- [ ] **Step 3: Extend the interface and dispatch**

In `PartRenderer.ts` add `audio(part: AudioPart): T;` to the interface (import `AudioPart`), and add a branch to `renderParts`:

```ts
} else if (part.type === "audio") {
  out.push(renderer.audio(part));
} else {
  out.push(renderer.file(part));
}
```

- [ ] **Step 4: Implement `OpenAIChatRenderer.audio()`**

By the time a renderer runs, the source is base64 (Task 8 resolves it). Emit `input_audio`:

```ts
audio(part: AudioPart) {
  if (part.source.kind !== "base64") {
    throw new Error("internal: audio source must be resolved to base64 before rendering");
  }
  const format = chatAudioFormat(part.source.mimeType);
  if (!format) {
    throw new Error(`Chat audio supports only mp3/wav; got "${part.source.mimeType}".`);
  }
  return { type: "input_audio", input_audio: { data: part.source.base64, format } };
}
```
Import `chatAudioFormat` from `../../../util/audioMime.js`.

- [ ] **Step 5: Implement `JSONRenderer.audio()`**

Mirror its `image()`/`file()` — materialize bytes to base64:

```ts
audio(part: AudioPart) {
  return { type: "audio", source: this.bytesToBase64(part.source), filename: part.filename };
}
```

- [ ] **Step 6: Add defensive `audio()` backstops to the other three renderers**

In `OpenAIResponsesRenderer.ts`, `GoogleRenderer.ts`, `AnthropicRenderer.ts`:

```ts
audio(_part: AudioPart): any {
  throw new Error("Audio input is not supported for this provider in v1.");
}
```
(These should never be reached — Task 9 rejects them before serialization — but keep the interface total.)

- [ ] **Step 7: Handle audio in the Ollama loop**

In `UserMessage.toOllamaMessage()`, add to the part loop, beside the file branch:

```ts
if (part.type === "audio") {
  throw new Error("Ollama does not support audio input.");
}
```
(Task 9 rejects Ollama+audio earlier; this keeps the loop exhaustive.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/classes/message/renderers/audioRender.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck` (exhaustiveness errors from Task 6 now resolved) → clean

- [ ] **Step 9: Commit**

```bash
git add lib/classes/message/renderers/ lib/classes/message/UserMessage.ts lib/classes/message/renderers/audioRender.test.ts
git commit -m "feat(message): render AudioPart as OpenAI input_audio; total renderer coverage"
```

---

## Task 8: Attachment resolution for audio

**Files:**
- Modify: `lib/clients/resolveAttachments.ts` (`messagesHaveAttachments` ~21-37; `resolveMessageAttachments` ~47-118)
- Test: `lib/clients/resolveAttachments.audio.test.ts`

**Interfaces:**
- Consumes: `AudioPart`; `normalizeImageRef` with `allowedMimePrefixes: ["audio/"]`.
- Produces: audio parts detected by `messagesHaveAttachments`; resolved to `{ type: "audio", source: { kind: "base64", ... } }` by `resolveMessageAttachments` (no providerFile/URL passthrough).

- [ ] **Step 1: Write the failing test**

```ts
// lib/clients/resolveAttachments.audio.test.ts
import { describe, it, expect } from "vitest";
import { messagesHaveAttachments, resolveMessageAttachments } from "./resolveAttachments.js";
import { UserMessage } from "../classes/message/index.js";

describe("audio attachment resolution", () => {
  const msg = () => new UserMessage([{ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } }]);

  it("detects audio parts", () => {
    expect(messagesHaveAttachments([msg()])).toBe(true);
  });

  it("resolves audio to a base64 source", async () => {
    const r = await resolveMessageAttachments([msg()], { provider: "openai", maxBytes: 1_000_000 });
    expect(r.success).toBe(true);
    if (r.success) {
      const parts = (r.value[0] as UserMessage).getContentParts()!;
      expect(parts[0].type).toBe("audio");
      expect((parts[0] as any).source.kind).toBe("base64");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/clients/resolveAttachments.audio.test.ts`
Expected: FAIL — `messagesHaveAttachments` misses audio; resolver drops/mishandles it.

- [ ] **Step 3: Detect audio parts**

In `messagesHaveAttachments`, widen the condition:

```ts
if (part.type === "image" || part.type === "file" || part.type === "audio") {
  return true;
}
```

- [ ] **Step 4: Resolve audio to base64**

In `resolveMessageAttachments`, add an audio branch (audio has no providerFile/URL passthrough — always normalize to base64). Place it after the `text` passthrough:

```ts
if (part.type === "audio") {
  try {
    const { data, mimeType } = await normalizeImageRef(part.source, {
      allowedMimePrefixes: ["audio/"],
      maxBytes: options.maxBytes,
    });
    resolvedParts.push({
      type: "audio",
      source: { kind: "base64", base64: Buffer.from(data).toString("base64"), mimeType },
      filename: part.filename,
    });
  } catch (err) {
    return failure(`Failed to load audio attachment: ${(err as Error).message}`);
  }
  continue;
}
```
Ensure the existing `providerFile`/`url` passthrough blocks are guarded to `part.type === "image" || part.type === "file"` so they don't run for audio (audio's `source` type has no `providerFile` arm).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/clients/resolveAttachments.audio.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 6: Commit**

```bash
git add lib/clients/resolveAttachments.ts lib/clients/resolveAttachments.audio.test.ts
git commit -m "feat(attachments): resolve AudioPart to inline base64"
```

---

## Task 9: Audio validation gates (provider-aware, OpenAI-only, positive)

**Files:**
- Modify: `lib/util/modalities.ts` (`validateModalities` ~5-34)
- Test: `lib/util/modalities.audio.test.ts`

**Interfaces:**
- Consumes: `resolveProvider`, `modelSupportsInputModality`.
- Produces: `validateModalities` returns `Failure` when audio parts are present AND (provider !== "openai" OR audio support is not exactly `true`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/util/modalities.audio.test.ts
import { describe, it, expect } from "vitest";
import { validateModalities } from "./modalities.js";
import { UserMessage } from "../classes/message/index.js";

const audioMsg = new UserMessage([{ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } }]);

describe("validateModalities — audio", () => {
  it("passes for gpt-audio-1.5 on openai", () => {
    const r = validateModalities({ model: "gpt-audio-1.5", messages: [audioMsg] } as any);
    expect(r).toBeNull();
  });
  it("rejects a text-only model", () => {
    const r = validateModalities({ model: "gpt-4o-mini", messages: [audioMsg] } as any);
    expect(r?.success).toBe(false);
  });
  it("rejects an unknown/unannotated model (undefined support is not true)", () => {
    const r = validateModalities({ model: "totally-unknown", provider: "openai", messages: [audioMsg] } as any);
    expect(r?.success).toBe(false);
  });
  it("rejects a non-openai provider even if the model declares audio (e.g. gemini)", () => {
    const r = validateModalities({ model: "gemini-3.1-pro-preview", messages: [audioMsg] } as any);
    expect(r?.success).toBe(false);
  });
  it("rejects openai-responses with audio", () => {
    const r = validateModalities({ model: "gpt-audio-1.5", provider: "openai-responses", messages: [audioMsg] } as any);
    expect(r?.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter smoltalk test lib/util/modalities.audio.test.ts` → FAIL (no audio arm).

- [ ] **Step 3: Add the audio gate**

In `validateModalities`, detect audio parts in the scan loop (`needsAudio`), then before the final `return null`:

```ts
if (needsAudio) {
  let provider: string;
  try {
    provider = resolveProvider(config.model, config.provider, config.modelData);
  } catch {
    return failure(`Model ${config.model} is not recognized; audio input requires an OpenAI audio chat model.`);
  }
  if (provider !== "openai") {
    return failure(`Audio input is only supported on the "openai" provider in v1 (got "${provider}").`);
  }
  if (modelSupportsInputModality(config.model, "audio", config.modelData) !== true) {
    return failure(`Model ${config.model} does not support audio input.`);
  }
}
```
Import `resolveProvider` from `./provider.js`. (This runs in `prepareAttachments` before both sync and stream serialize, so `textSync` returns the `Failure` and `textStream` surfaces it as an `error` chunk — no renderer is reached.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter smoltalk test lib/util/modalities.audio.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 5: Commit**

```bash
git add lib/util/modalities.ts lib/util/modalities.audio.test.ts
git commit -m "feat(modalities): OpenAI-only, positive audio-input validation gate"
```

---

## Task 10: End-to-end audio-in-chat (mocked) + cost

**Files:**
- Test: `lib/clients/openai.audioChat.test.ts`

**Interfaces:**
- Consumes: everything above. Verifies the whole path: `AudioPart` → resolve → validate → render → OpenAI Chat call → usage with audio tokens → cost.

- [ ] **Step 1: Write the test (sync + stream + cost)**

Mock the OpenAI SDK so no network is hit. Build a `UserMessage` with an audio part, call `textSync`/`textStream` on `gpt-audio-1.5`, and assert the request body carries an `input_audio` block and the result cost reflects audio-token pricing. Follow the existing OpenAI client test setup in the repo for how the SDK is mocked (search `lib/clients/openai*.test.ts`).

```ts
// lib/clients/openai.audioChat.test.ts
import { describe, it, expect, vi } from "vitest";
// NOTE: match the existing OpenAI mock pattern used in lib/clients/openai*.test.ts.
// Return a completion whose usage includes prompt_tokens_details.audio_tokens and
// completion_tokens with no audio output, then assert:
//  - the create() call received a message content array containing { type: "input_audio" }
//  - result.usage.inputAudioTokens is set
//  - result.cost.inputCost reflects audio priced at inputAudioTokenCost (not text rate)
// Provide rates via config.modelData for gpt-audio-1.5 so the assertion is exact.
```

Implement the test concretely using the repo's established OpenAI mock (copy the mock scaffolding from the nearest existing `openai*.test.ts`; do not invent a new mocking approach). Assert both `textSync` and one `textStream` run produce the same `cost`.

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pnpm --filter smoltalk test lib/clients/openai.audioChat.test.ts`
If any wiring gap surfaces (e.g. a missing branch), fix it in the relevant file from Tasks 6–9, then re-run to PASS.

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm --filter smoltalk test` → all PASS
Run: `pnpm --filter smoltalk typecheck` → clean

- [ ] **Step 4: Commit**

```bash
git add lib/clients/openai.audioChat.test.ts
git commit -m "test(audio): end-to-end audio-in-chat with audio-token cost (sync+stream)"
```

---

## Task 11: Docs & changelog

**Files:**
- Modify: `packages/smoltalk/README.md` (add an "Audio (STT/TTS)" section), `CHANGELOG` per repo convention (see `util:changelog` skill).

- [ ] **Step 1: Document `transcribe()`, `speak()`, and `AudioPart`**

Add a README section with a minimal example of each, the OpenAI-only v1 scope, the model allowlists, and the caller-owned nature of returned bytes. Mention audio-in-chat requires `gpt-audio-1.5`/`gpt-audio-mini`.

- [ ] **Step 2: Update the changelog**

Follow the repo's changelog format (invoke the `util:changelog` skill if available).

- [ ] **Step 3: Commit**

```bash
git add packages/smoltalk/README.md
git commit -m "docs: document audio STT/TTS and audio-in-chat"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** STT (Task 4), TTS (Task 5), AudioPart pipeline (Tasks 6–9), audio-token cost (Task 2), registry cleanup + gpt-audio models (Task 1), MIME contracts incl. PCM (Task 3), allowlists (Tasks 4/5), provider-aware positive validation (Task 9), exception boundary (Tasks 4/5), end-to-end + stream parity (Task 10), docs (Task 11). All spec sections map to a task.
- **Deferred (per spec Non-goals/Follow-ups), intentionally absent:** streaming STT/TTS, token-priced GPT dedicated endpoint models, non-OpenAI providers, assistant audio output, translation, SSRF guard, voice discovery.
- **Type consistency:** `TranscribeOptions`/`SpeakOptions` use `model: string` + `modelData`; `TranscriptionProvider.transcribe(data, mimeType, ctx)` and `SpeechProvider.speak(text, ctx)` signatures are consistent between the module (Tasks 4/5) and their OpenAI impls; `AudioPart.source: BlobRef` consistent across Tasks 6–9; `SpeakFormat` shared from `audioMime.ts` across Tasks 3/5; `chatAudioFormat` used identically in Tasks 3/7.
- **Known verification points flagged for the implementer:** exact gpt-audio pricing (Task 1, via `update-models`); `toFile` import path for the installed `openai` version (Task 4); the repo's existing OpenAI mock pattern (Task 10).
