# Audio: STT, TTS & Audio-in-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI speech-to-text (`transcribe()`), text-to-speech (`speak()`), and audio-in-chat (`AudioPart`) to the smoltalk core package, with correct cost accounting.

**Architecture:** `transcribe()`/`speak()` are top-level capability functions backed by a provider registry, mirroring `lib/embed.ts` — they do **not** go through `SmolClient`/`getClient()`. Audio-in-chat adds an `AudioPart` arm to the user content-part union and rides the existing text pipeline (renderers + attachment resolution + modality gates), with real audio-token pricing added to the OpenAI usage path.

**Tech Stack:** TypeScript (ESM, `.js` import extensions, `strict`), Zod schemas, `openai` SDK, vitest. pnpm workspace; all paths below are within `packages/smoltalk/`.

> **Revision note (rev 2):** incorporates plan-review fixes — awaited provider dispatch inside the exception boundary + `redactSecret`; valid `ModelDataBlob` fixtures; a provider-aware `getModelForProvider` lookup; unsupported chat-audio MIME rejected during preparation (not from a renderer); merged content-part+renderer task so every commit typechecks; concrete OpenAI STT/TTS provider tests; a seam-based chat e2e test; `gpt-audio-1.5` only (mini is deprecated).

## Global Constraints

- **v1 is OpenAI-only.** STT built-in model allowlist = `{ whisper-1 }`; TTS allowlist = `{ tts-1, tts-1-hd }`; audio-chat model = `gpt-audio-1.5`. Every other provider returns/raises `Failure` for audio.
- **ESM imports use `.js` extensions**; `"type": "module"`; target ESNext, `strict: true`.
- **Public operations return `Result<T>`** (`success(v)` / `failure(msg)` from `lib/types/result.js`). `transcribe()`/`speak()` never throw — wrap all work in try/catch, and `await` any dispatched provider call inside that try so a rejected promise is caught.
- **Redact secrets in error messages** with `redactSecret(message, apiKey)` from `lib/util/redact.js` before returning a `Failure` from a caught exception (see `lib/files/BaseFileProvider.ts:54` for the pattern).
- **No ternaries / conditional spreads for control flow** — the maintainer prefers explicit `if` statements. (Object-literal conditional spreads like `...(x ? {a} : {})` already appear in the codebase and may be matched where idiomatic, but prefer explicit statements for new branching logic.)
- **"Character" for TTS pricing = Unicode code points** (`[...text].length`), not `text.length`.
- **Provider-aware model lookup:** capability/pricing/modality lookups for audio use `getModelForProvider(provider, modelName, modelData)` (added in Task 1), never a name-only `getModel`, so an explicit provider override can't inherit a same-named model owned by another provider.
- **Tests live beside implementation** as `*.test.ts`; run with `pnpm --filter smoltalk test`. Cost-math tests inject rates via a valid `ModelDataBlob` (`{ schemaVersion, generatedAt, models, hostedTools }`) — never `as any`.
- **Every prescribed commit must build**: run `pnpm --filter smoltalk typecheck` before each commit; no known-broken intermediate commits.

---

## File Structure

**New files:**
- `lib/transcription.ts`, `lib/transcription/openai.ts` — STT.
- `lib/speech.ts`, `lib/speech/openai.ts` — TTS.
- `lib/util/audioMime.ts` — audio MIME↔extension maps + chat/output format derivation.
- `*.test.ts` beside each of the above (including `lib/transcription/openai.test.ts`, `lib/speech/openai.test.ts`).

**Modified files:**
- `lib/models.ts` — registry cleanup + new models + `TextToSpeechModel` + guard + aliases + `getModelForProvider`.
- `lib/types/tokenUsage.ts`, `lib/model.ts`, `lib/clients/openai.ts` — audio-token usage & cost.
- `lib/util/imageRef.ts` — audio extensions in `EXT_TO_MIME`.
- `lib/classes/message/contentParts.ts`, `.../index.ts`, `.../renderers/*.ts`, `.../UserMessage.ts` — `AudioPart` + rendering.
- `lib/clients/resolveAttachments.ts` — audio resolution + chat-MIME rejection.
- `lib/util/modalities.ts` — provider-aware, OpenAI-only, positive audio gate.
- `lib/index.ts` — re-exports.
- `packages/smoltalk/README.md`, `packages/smoltalk/CHANGELOG.md` — docs.

---

## Task 1: Model registry — STT, TTS, audio-chat entries, and provider-aware lookup

**Files:**
- Modify: `lib/models.ts`
- Test: `lib/models.audio.test.ts`

**Interfaces:**
- Produces: `TextToSpeechModel` type; `isTextToSpeechModel()`; `getModelForProvider(provider, modelName, modelData?)`; entries `whisper-1` (speech-to-text, `perMinuteCost`), `tts-1`/`tts-1-hd` (text-to-speech, `perCharacterCost`), `gpt-audio-1.5` (text, `modalities.input` includes `"audio"`, `modalities.output` includes `"audio"`, with the four `*TokenCost` fields); aliases `SpeechToTextModelName`, `TextToSpeechModelName`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/models.audio.test.ts
import { describe, it, expect } from "vitest";
import {
  getModel, getModelForProvider, isTextToSpeechModel, isSpeechToTextModel,
  modelSupportsInputModality,
} from "./models.js";

describe("audio model registry", () => {
  it("whisper-1 is a speech-to-text model with a per-minute cost", () => {
    const m = getModel("whisper-1")!;
    expect(isSpeechToTextModel(m)).toBe(true);
    expect((m as any).perMinuteCost).toBeGreaterThan(0);
  });
  it("tts-1 / tts-1-hd are text-to-speech models with a per-character cost", () => {
    for (const name of ["tts-1", "tts-1-hd"]) {
      const m = getModel(name)!;
      expect(isTextToSpeechModel(m)).toBe(true);
      expect((m as any).perCharacterCost).toBeGreaterThan(0);
    }
  });
  it("gpt-audio-1.5 declares audio input and audio token rates", () => {
    expect(modelSupportsInputModality("gpt-audio-1.5", "audio")).toBe(true);
    expect((getModel("gpt-audio-1.5") as any).inputAudioTokenCost).toBeGreaterThan(0);
  });
  it("whisper-web stub is gone", () => {
    expect(getModel("whisper-web")).toBeUndefined();
  });
  it("getModelForProvider matches on provider + name", () => {
    const md = {
      schemaVersion: 1, generatedAt: "t", hostedTools: [],
      models: [{ type: "text", modelName: "dup", provider: "acme",
        maxInputTokens: 1, maxOutputTokens: 1, modalities: { input: ["text", "audio"], output: ["text"] } }],
    } as any;
    expect(getModelForProvider("acme", "dup", md)?.provider).toBe("acme");
    expect(getModelForProvider("openai", "dup", md)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `pnpm --filter smoltalk test lib/models.audio.test.ts` (whisper-1 undefined; `getModelForProvider`/`isTextToSpeechModel` not exported).

- [ ] **Step 3: Add `TextToSpeechModel` + union member**

Near `SpeechToTextModel` (~44):
```ts
export type TextToSpeechModel = BaseModel & {
  type: "text-to-speech";
  perCharacterCost?: number; // USD per input Unicode code point
};
```
Add to the `ModelType` union (~110): `| TextToSpeechModel`.

- [ ] **Step 4: Replace the STT stub, add the TTS array**

```ts
export const speechToTextModels = [
  { type: "speech-to-text", modelName: "whisper-1", perMinuteCost: 0.006, provider: "openai" },
] as const;

export const textToSpeechModels = [
  { type: "text-to-speech", modelName: "tts-1", perCharacterCost: 0.000015, provider: "openai" },
  { type: "text-to-speech", modelName: "tts-1-hd", perCharacterCost: 0.00003, provider: "openai" },
] as const;
```
> Confirm current pricing with the `update-models` skill / OpenAI pricing page before merge.

- [ ] **Step 5: Add the gpt-audio-1.5 text entry**

Copy an adjacent `textModels` entry and adjust (match its exact field names for `modalities`, `maxInputTokens`, `maxOutputTokens`):
```ts
{
  type: "text",
  modelName: "gpt-audio-1.5",
  description: "OpenAI GA audio chat model (Chat Completions). Text+audio in, text+audio out.",
  provider: "openai",
  modalities: { input: ["text", "audio"], output: ["text", "audio"] },
  inputTokenCost: 2.5,
  outputTokenCost: 10,
  inputAudioTokenCost: 32,
  outputAudioTokenCost: 64,
  maxInputTokens: 128000,
  maxOutputTokens: 16384,
},
```
> `output` lists `audio` to describe provider capability (assistant-audio capture is a v1 non-goal). Confirm the four `*TokenCost` values via `update-models` before merge. Do NOT add `gpt-audio-mini` (deprecated, shutdown 2027-01-20).

- [ ] **Step 6: Add guard, aliases, provider-aware lookup, and merge**

Near the other guards (~2082):
```ts
export function isTextToSpeechModel(model: ModelType): model is TextToSpeechModel {
  return model.type === "text-to-speech";
}
```
Provider-aware lookup (next to `getModel` ~1979):
```ts
export function getModelForProvider(
  provider: string, modelName: ModelName, requestData?: ModelDataBlob,
): ModelType | undefined {
  return getAllModels(requestData).find(
    (m) => m.modelName === modelName && m.provider === provider,
  );
}
```
Aliases near `SpeechToTextModelName` (~1807):
```ts
export type SpeechToTextModelName = (typeof speechToTextModels)[number]["modelName"];
export type TextToSpeechModelName = (typeof textToSpeechModels)[number]["modelName"];
```
Ensure `getAllModels()` spreads `...textToSpeechModels` alongside `...speechToTextModels`.

- [ ] **Step 7: Run tests + typecheck; fix seed script if needed**

Run: `pnpm --filter smoltalk test lib/models.audio.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`
Removing `whisper-web` may break `scripts/seed-model-data.ts` — update references so the build stays green. Run `pnpm --filter smoltalk test` once.

- [ ] **Step 8: Commit**

```bash
git add lib/models.ts lib/models.audio.test.ts
git commit -m "feat(models): add whisper-1, tts-1/-hd, gpt-audio-1.5; add getModelForProvider"
```

---

## Task 2: Audio-token usage & cost accounting

**Files:**
- Modify: `lib/types/tokenUsage.ts`, `lib/model.ts` (`calculateCost` ~36-115), `lib/clients/openai.ts` (`calculateUsageAndCost` ~109-150)
- Test: `lib/model.audioCost.test.ts`

**Interfaces:**
- Produces: `TokenUsage.inputAudioTokens?`/`outputAudioTokens?`; `Model.calculateCost()` prices them at `inputAudioTokenCost`/`outputAudioTokenCost`.

- [ ] **Step 1: Write the failing test (valid ModelDataBlob fixture)**

```ts
// lib/model.audioCost.test.ts
import { describe, it, expect } from "vitest";
import { Model } from "./model.js";
import type { ModelDataBlob } from "./modelData.js";

const modelData: ModelDataBlob = {
  schemaVersion: 1,
  generatedAt: "test",
  models: [{
    type: "text",
    modelName: "audio-test",
    provider: "openai",
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    inputTokenCost: 2,      // $/1M text input
    outputTokenCost: 10,
    inputAudioTokenCost: 32, // $/1M audio input
    outputAudioTokenCost: 64,
  }] as any,
  hostedTools: [],
};

describe("calculateCost with audio tokens", () => {
  it("prices audio and text buckets disjointly", () => {
    const m = new Model("audio-test", "openai", modelData);
    const cost = m.calculateCost({
      inputTokens: 1_000_000, outputTokens: 0,
      inputAudioTokens: 1_000_000, outputAudioTokens: 0,
    })!;
    expect(cost.inputCost).toBeCloseTo(34, 5); // 1M*$2 + 1M*$32 per 1M
    expect(cost.totalCost).toBeCloseTo(34, 5);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`pnpm --filter smoltalk test lib/model.audioCost.test.ts`) — audio priced at text rate/ignored; TS error on `inputAudioTokens`.

- [ ] **Step 3: Extend `TokenUsage`**

In `lib/types/tokenUsage.ts` add `inputAudioTokens?: number; outputAudioTokens?: number;` to the type, `.optional()` fields to `TokenUsageSchema`, and sum them in `addTokenUsage` (mirroring `cachedInputTokens`).

- [ ] **Step 4: Price audio buckets in `calculateCost`**

In `lib/model.ts`, extend the `usage` param type with `inputAudioTokens?: number; outputAudioTokens?: number;`. After the existing `inputCost`/`outputCost` (~64-71):
```ts
const audioInTokens = usage.inputAudioTokens ?? 0;
const audioOutTokens = usage.outputAudioTokens ?? 0;
// Fall back to the text rate if no audio rate is defined so the total stays honest.
const audioInRate = model.inputAudioTokenCost ?? model.inputTokenCost ?? 0;
const audioOutRate = model.outputAudioTokenCost ?? model.outputTokenCost ?? 0;
const audioInCost = round((audioInTokens * audioInRate) / 1_000_000, 6);
const audioOutCost = round((audioOutTokens * audioOutRate) / 1_000_000, 6);
```
Fold `audioInCost` into `finalInputCost`, add `audioOutCost` to both the returned `outputCost` and `totalCost`. Use explicit `if`/statements; no ternary control flow.

- [ ] **Step 5: Parse audio tokens in the OpenAI client**

In `lib/clients/openai.ts` `calculateUsageAndCost()` (~119-128), disjoint the buckets:
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
`calculateCost(usage)` already receives the whole object; both sync and stream flow through this one method (no other change).

- [ ] **Step 6: Run tests + typecheck → PASS**

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
- Produces: `SpeakFormat`; `TRANSCRIBE_MIME_TO_EXT`; `isTranscribeMime(mime): boolean`; `filenameForAudioMime(mime): string`; `chatAudioFormat(mime): "mp3"|"wav"|null`; `SPEECH_FORMAT_TO_MIME` (PCM → `application/octet-stream`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/util/audioMime.test.ts
import { describe, it, expect } from "vitest";
import { filenameForAudioMime, chatAudioFormat, isTranscribeMime, SPEECH_FORMAT_TO_MIME } from "./audioMime.js";

describe("audioMime", () => {
  it("derives a filename with a real extension", () => {
    expect(filenameForAudioMime("audio/mpeg")).toBe("audio.mp3");
    expect(filenameForAudioMime("audio/wav")).toBe("audio.wav");
  });
  it("recognizes supported transcription MIME types", () => {
    expect(isTranscribeMime("audio/ogg")).toBe(true);
    expect(isTranscribeMime("audio/basic")).toBe(false);
  });
  it("maps only mp3/wav for chat input_audio", () => {
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

- [ ] **Step 2: Run test → FAIL** (module not found).

- [ ] **Step 3: Implement `lib/util/audioMime.ts`**

```ts
export type SpeakFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

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

export function isTranscribeMime(mime: string): boolean {
  return mime in TRANSCRIBE_MIME_TO_EXT;
}

export function filenameForAudioMime(mime: string): string {
  return `audio.${TRANSCRIBE_MIME_TO_EXT[mime]}`;
}

export function chatAudioFormat(mime: string): "mp3" | "wav" | null {
  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
  return null;
}

// PCM from OpenAI is headerless s16le / 24kHz / mono, which audio/L16 (big-endian
// per RFC) would misdescribe — use octet-stream + structured metadata instead.
export const SPEECH_FORMAT_TO_MIME: Record<SpeakFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "application/octet-stream",
};
```
> `filenameForAudioMime` assumes a supported MIME — callers validate with `isTranscribeMime` first (Task 4) and return `Failure` otherwise, so it never produces `audio.undefined`.

- [ ] **Step 4: Extend path-extension inference**

In `lib/util/imageRef.ts` add to `EXT_TO_MIME`:
```ts
".mp3": "audio/mpeg",
".mpeg": "audio/mpeg",
".mpga": "audio/mpeg",
".wav": "audio/wav",
".m4a": "audio/m4a",
".mp4": "audio/mp4",
".ogg": "audio/ogg",
".flac": "audio/flac",
".webm": "audio/webm",
```

- [ ] **Step 5: Run tests + typecheck → PASS**

- [ ] **Step 6: Commit**

```bash
git add lib/util/audioMime.ts lib/util/audioMime.test.ts lib/util/imageRef.ts
git commit -m "feat(util): audio MIME maps + path-extension inference"
```

---

## Task 4: `transcribe()` — speech-to-text

**Files:**
- Create: `lib/transcription.ts`, `lib/transcription/openai.ts`, `lib/transcription.test.ts`, `lib/transcription/openai.test.ts`
- Modify: `lib/index.ts`

**Interfaces:**
- Consumes: `loadBlob`/`BlobRef`, `resolveProvider`/`resolveApiKey`, `getModelForProvider`/`isSpeechToTextModel`, `isTranscribeMime`/`filenameForAudioMime`, `redactSecret`.
- Produces: `TranscribeOptions`, `TranscriptionResult`, `TranscriptionProvider`, `registerTranscriptionProvider`, `_resetForTests`, `transcribe`. Allowlist `OPENAI_TRANSCRIBE_MODELS = new Set(["whisper-1"])`.

- [ ] **Step 1: Write the dispatch test (incl. sync throw AND rejected promise)**

```ts
// lib/transcription.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { transcribe, registerTranscriptionProvider, _resetForTests } from "./transcription.js";

beforeEach(() => _resetForTests());
const src = { kind: "base64" as const, base64: "AAAA", mimeType: "audio/wav" };

describe("transcribe() dispatch", () => {
  it("rejects an OpenAI model outside the allowlist", async () => {
    const r = await transcribe(src, { model: "gpt-4o-transcribe", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("rejects a wrong-capability model", async () => {
    const r = await transcribe(src, { model: "gpt-4o-mini", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("dispatches an unknown model to a registered custom provider", async () => {
    registerTranscriptionProvider("myasr", { async transcribe() { return { success: true, value: { text: "hi" } }; } });
    const r = await transcribe(src, { model: "custom-1", provider: "myasr" });
    expect(r.success).toBe(true);
  });
  it("converts a synchronous provider throw into a Failure", async () => {
    registerTranscriptionProvider("boom", { transcribe() { throw new Error("kaboom"); } as any });
    const r = await transcribe(src, { model: "x", provider: "boom" });
    expect(r.success).toBe(false);
  });
  it("converts a rejected provider promise into a Failure", async () => {
    registerTranscriptionProvider("rej", { async transcribe() { return Promise.reject(new Error("nope")); } });
    const r = await transcribe(src, { model: "x", provider: "rej" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (module not found).

- [ ] **Step 3: Implement `lib/transcription.ts`** (await dispatch inside try; redact)

```ts
import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { BlobRef, loadBlob } from "./util/imageRef.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { redactSecret } from "./util/redact.js";
import { openaiTranscribe } from "./transcription/openai.js";

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

export const OPENAI_TRANSCRIBE_MODELS = new Set(["whisper-1"]);
export const DEFAULT_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

const registered: Record<string, TranscriptionProvider> = Object.create(null);
export function registerTranscriptionProvider(name: string, impl: TranscriptionProvider): void {
  registered[name] = impl;
}
export function _resetForTests(): void {
  for (const k of Object.keys(registered)) delete registered[k];
}

export async function transcribe(source: BlobRef, opts: TranscribeOptions): Promise<Result<TranscriptionResult>> {
  const apiKeyForRedaction = resolveApiKey(opts.provider ?? "openai", opts) ?? "";
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
        return failure(`Model "${opts.model}" is not a supported OpenAI transcription model in v1 (supported: ${[...OPENAI_TRANSCRIBE_MODELS].join(", ")}).`);
      }
      const apiKey = resolveApiKey("openai", opts);
      if (!apiKey) return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      return await openaiTranscribe(loaded.data, mimeType, { apiKey, opts });
    }

    const custom = registered[provider];
    if (custom) {
      return await custom.transcribe(loaded.data, mimeType, { apiKey: resolveApiKey(provider, opts) ?? "", opts });
    }
    return failure(`Provider "${provider}" has no transcription API. Register one with registerTranscriptionProvider(name, impl).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "transcribe() failed";
    return failure(redactSecret(msg, apiKeyForRedaction));
  }
}
```

- [ ] **Step 4: Implement `lib/transcription/openai.ts`** (provider-aware lookup; reject unsupported MIME)

```ts
import OpenAI, { toFile } from "openai";
import { Result, success, failure } from "../types/result.js";
import { getModelForProvider, isSpeechToTextModel } from "../models.js";
import { round } from "../util/util.js";
import { isTranscribeMime, filenameForAudioMime } from "../util/audioMime.js";
import { redactSecret } from "../util/redact.js";
import type { TranscribeOptions, TranscriptionResult } from "../transcription.js";

export async function openaiTranscribe(
  data: Uint8Array, mimeType: string, ctx: { apiKey: string; opts: TranscribeOptions },
): Promise<Result<TranscriptionResult>> {
  const { opts } = ctx;
  try {
    const model = getModelForProvider("openai", opts.model, opts.modelData);
    if (model && !isSpeechToTextModel(model)) {
      return failure(`Model "${opts.model}" is not a speech-to-text model.`);
    }
    if (!isTranscribeMime(mimeType)) {
      return failure(`Unsupported audio type "${mimeType}" for transcription. Supported: flac, mp3, mp4, m4a, ogg, wav, webm.`);
    }

    const client = new OpenAI({ apiKey: ctx.apiKey });
    const filename = opts.filename ?? filenameForAudioMime(mimeType);
    const file = await toFile(data, filename, { type: mimeType });

    const granularities: ("segment" | "word")[] = [];
    if (opts.timestampGranularity) granularities.push(opts.timestampGranularity);

    const res: any = await client.audio.transcriptions.create({
      file, model: opts.model, response_format: "verbose_json",
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
      ...(granularities.length ? { timestamp_granularities: granularities } : {}),
    });

    const result: TranscriptionResult = { text: res.text, raw: res };
    if (res.language) result.language = res.language;
    if (typeof res.duration === "number") result.durationSeconds = res.duration;
    if (Array.isArray(res.segments)) result.segments = res.segments.map((s: any) => ({ start: s.start, end: s.end, text: s.text }));
    if (Array.isArray(res.words)) result.words = res.words.map((w: any) => ({ start: w.start, end: w.end, word: w.word }));

    if (model && isSpeechToTextModel(model) && model.perMinuteCost && result.durationSeconds != null) {
      const inputCost = round((result.durationSeconds / 60) * model.perMinuteCost, 6);
      result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
    }
    return success(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAI transcription request failed";
    return failure(redactSecret(msg, ctx.apiKey));
  }
}
```
> If `toFile` isn't exported from your `openai` version, import from `openai/uploads`. Verify against the installed SDK.

- [ ] **Step 5: Write the OpenAI provider test (mock the SDK)**

```ts
// lib/transcription/openai.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI { audio = { transcriptions: { create } }; constructor(_: any) {} }
  return { default: OpenAI, toFile: async (data: any, name: string, o: any) => ({ data, name, type: o?.type }) };
});
import { openaiTranscribe } from "./openai.js";

const md = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "speech-to-text", modelName: "whisper-1", provider: "openai", perMinuteCost: 0.006 }] } as any;

beforeEach(() => create.mockReset());

describe("openaiTranscribe", () => {
  it("sends verbose_json + timestamps, normalizes segments/words, computes duration cost", async () => {
    create.mockResolvedValue({ text: "hello", language: "en", duration: 120,
      segments: [{ start: 0, end: 1, text: "hello" }], words: [{ start: 0, end: 1, word: "hello" }] });
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav",
      { apiKey: "sk-x", opts: { model: "whisper-1", timestampGranularity: "word", modelData: md } });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const call = create.mock.calls[0][0];
    expect(call.response_format).toBe("verbose_json");
    expect(call.timestamp_granularities).toEqual(["word"]);
    expect(r.value.segments?.[0].text).toBe("hello");
    expect(r.value.words?.[0].word).toBe("hello");
    expect(r.value.cost?.totalCost).toBeCloseTo((120 / 60) * 0.006, 6);
  });
  it("rejects an unsupported audio MIME before calling the SDK", async () => {
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/basic",
      { apiKey: "sk-x", opts: { model: "whisper-1", modelData: md } });
    expect(r.success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it("converts an SDK error into a redacted Failure", async () => {
    create.mockRejectedValue(new Error("bad key sk-x"));
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav",
      { apiKey: "sk-x", opts: { model: "whisper-1", modelData: md } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).not.toContain("sk-x");
  });
});
```

- [ ] **Step 6: Export + run**

Add `export * from "./transcription.js";` to `lib/index.ts`.
Run: `pnpm --filter smoltalk test lib/transcription.test.ts lib/transcription/openai.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/transcription.ts lib/transcription/openai.ts lib/transcription.test.ts lib/transcription/openai.test.ts lib/index.ts
git commit -m "feat(stt): add transcribe() with tested OpenAI whisper-1 provider"
```

---

## Task 5: `speak()` — text-to-speech

**Files:**
- Create: `lib/speech.ts`, `lib/speech/openai.ts`, `lib/speech.test.ts`, `lib/speech/openai.test.ts`
- Modify: `lib/index.ts`

**Interfaces:**
- Produces: `SpeakOptions`, `SpeechResult`, `SpeechProvider`, `registerSpeechProvider`, `_resetForTests`, `speak`. Allowlist `OPENAI_SPEECH_MODELS = new Set(["tts-1","tts-1-hd"])`; `MAX_TTS_CHARS = 4096`.
- Note: OpenAI-specific limits (`speed` ∈ [0.25,4.0], 4096-char cap) are enforced **only on the OpenAI branch**, after provider resolution — not on custom providers.

- [ ] **Step 1: Write the dispatch test (incl. throw + rejected promise)**

```ts
// lib/speech.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { speak, registerSpeechProvider, _resetForTests } from "./speech.js";

beforeEach(() => _resetForTests());

describe("speak() dispatch", () => {
  it("rejects out-of-range speed on the OpenAI branch", async () => {
    const r = await speak("hi", { model: "tts-1", voice: "alloy", speed: 9, provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("rejects text over 4096 chars on the OpenAI branch", async () => {
    const r = await speak("a".repeat(4097), { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("rejects an OpenAI model outside the allowlist", async () => {
    const r = await speak("hi", { model: "gpt-4o-mini-tts", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
    expect(r.success).toBe(false);
  });
  it("dispatches unknown model to a registered custom provider", async () => {
    registerSpeechProvider("mytts", { async speak() { return { success: true, value: { audio: new Uint8Array([1]), mimeType: "audio/mpeg" } }; } });
    const r = await speak("hi", { model: "c1", voice: "v", provider: "mytts" });
    expect(r.success).toBe(true);
  });
  it("converts a synchronous throw and a rejected promise into Failure", async () => {
    registerSpeechProvider("boom", { speak() { throw new Error("x"); } as any });
    registerSpeechProvider("rej", { async speak() { return Promise.reject(new Error("y")); } });
    expect((await speak("hi", { model: "c", voice: "v", provider: "boom" })).success).toBe(false);
    expect((await speak("hi", { model: "c", voice: "v", provider: "rej" })).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (module not found).

- [ ] **Step 3: Implement `lib/speech.ts`** (limits on OpenAI branch; await dispatch; redact)

```ts
import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, failure } from "./types/result.js";
import { CostEstimate } from "./types/costEstimate.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { redactSecret } from "./util/redact.js";
import { SpeakFormat } from "./util/audioMime.js";
import { openaiSpeak } from "./speech/openai.js";

export type SpeakOptions = {
  model: string; voice: string; provider?: string; modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"]; format?: SpeakFormat; speed?: number;
};
export type SpeechResult = {
  audio: Uint8Array; mimeType: string;
  pcm?: { sampleRateHz: 24000; sampleFormat: "s16le"; channels: 1 };
  cost?: CostEstimate; raw?: unknown;
};
export type SpeechProvider = {
  speak(text: string, ctx: { apiKey: string; opts: SpeakOptions }): Promise<Result<SpeechResult>>;
};

export const OPENAI_SPEECH_MODELS = new Set(["tts-1", "tts-1-hd"]);
export const MAX_TTS_CHARS = 4096;

const registered: Record<string, SpeechProvider> = Object.create(null);
export function registerSpeechProvider(name: string, impl: SpeechProvider): void { registered[name] = impl; }
export function _resetForTests(): void { for (const k of Object.keys(registered)) delete registered[k]; }

export async function speak(text: string, opts: SpeakOptions): Promise<Result<SpeechResult>> {
  const apiKeyForRedaction = resolveApiKey(opts.provider ?? "openai", opts) ?? "";
  try {
    let provider: string;
    try {
      provider = resolveProvider(opts.model, opts.provider, opts.modelData);
    } catch (err) {
      return failure(err instanceof Error ? err.message : "Failed to resolve provider");
    }

    if (provider === "openai") {
      if ([...text].length > MAX_TTS_CHARS) return failure(`Input exceeds the ${MAX_TTS_CHARS}-character OpenAI TTS limit.`);
      if (opts.speed !== undefined && (!Number.isFinite(opts.speed) || opts.speed < 0.25 || opts.speed > 4.0)) {
        return failure("speed must be a finite number in [0.25, 4.0].");
      }
      if (!OPENAI_SPEECH_MODELS.has(opts.model)) {
        return failure(`Model "${opts.model}" is not a supported OpenAI speech model in v1 (supported: ${[...OPENAI_SPEECH_MODELS].join(", ")}).`);
      }
      const apiKey = resolveApiKey("openai", opts);
      if (!apiKey) return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      return await openaiSpeak(text, { apiKey, opts });
    }

    const custom = registered[provider];
    if (custom) return await custom.speak(text, { apiKey: resolveApiKey(provider, opts) ?? "", opts });
    return failure(`Provider "${provider}" has no speech API. Register one with registerSpeechProvider(name, impl).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "speak() failed";
    return failure(redactSecret(msg, apiKeyForRedaction));
  }
}
```

- [ ] **Step 4: Implement `lib/speech/openai.ts`** (provider-aware pricing; format→MIME; PCM)

```ts
import OpenAI from "openai";
import { Result, success, failure } from "../types/result.js";
import { getModelForProvider, isTextToSpeechModel } from "../models.js";
import { round } from "../util/util.js";
import { SPEECH_FORMAT_TO_MIME, SpeakFormat } from "../util/audioMime.js";
import { redactSecret } from "../util/redact.js";
import type { SpeakOptions, SpeechResult } from "../speech.js";

export async function openaiSpeak(text: string, ctx: { apiKey: string; opts: SpeakOptions }): Promise<Result<SpeechResult>> {
  const { opts } = ctx;
  try {
    const format: SpeakFormat = opts.format ?? "mp3";
    const mimeType = SPEECH_FORMAT_TO_MIME[format];
    if (!mimeType) return failure(`Unknown speech format "${format}".`);

    const client = new OpenAI({ apiKey: ctx.apiKey });
    const res = await client.audio.speech.create({
      model: opts.model, voice: opts.voice as any, input: text, response_format: format,
      ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    });
    const audio = new Uint8Array(await res.arrayBuffer());

    const result: SpeechResult = { audio, mimeType };
    if (format === "pcm") result.pcm = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };

    const model = getModelForProvider("openai", opts.model, opts.modelData);
    if (model && isTextToSpeechModel(model) && model.perCharacterCost) {
      const inputCost = round([...text].length * model.perCharacterCost, 6);
      result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
    }
    return success(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAI speech request failed";
    return failure(redactSecret(msg, ctx.apiKey));
  }
}
```

- [ ] **Step 5: Write the OpenAI provider test (mock the SDK)**

```ts
// lib/speech/openai.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI { audio = { speech: { create } }; constructor(_: any) {} }
  return { default: OpenAI };
});
import { openaiSpeak } from "./openai.js";

const md = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "text-to-speech", modelName: "tts-1", provider: "openai", perCharacterCost: 0.00001 }] } as any;

beforeEach(() => create.mockReset());
const okResponse = () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

describe("openaiSpeak", () => {
  it("returns bytes + exact MIME and Unicode code-point cost", async () => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("héllo", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", format: "mp3", modelData: md } });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.mimeType).toBe("audio/mpeg");
    expect(r.value.audio.length).toBe(3);
    expect(r.value.cost?.totalCost).toBeCloseTo([..."héllo"].length * 0.00001, 6);
  });
  it("attaches PCM metadata and octet-stream MIME for pcm", async () => {
    create.mockResolvedValue(okResponse());
    const r = await openaiSpeak("hi", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", format: "pcm", modelData: md } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.mimeType).toBe("application/octet-stream");
      expect(r.value.pcm).toEqual({ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 });
    }
  });
  it("converts an SDK error into a redacted Failure", async () => {
    create.mockRejectedValue(new Error("bad sk-x"));
    const r = await openaiSpeak("hi", { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", modelData: md } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).not.toContain("sk-x");
  });
});
```

- [ ] **Step 6: Export + run**

Add `export * from "./speech.js";` to `lib/index.ts`.
Run: `pnpm --filter smoltalk test lib/speech.test.ts lib/speech/openai.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/speech.ts lib/speech/openai.ts lib/speech.test.ts lib/speech/openai.test.ts lib/index.ts
git commit -m "feat(tts): add speak() with tested OpenAI tts-1/tts-1-hd provider"
```

---

## Task 6: `AudioPart` type, schema, helper, and full renderer coverage (atomic)

> Merged content-part + renderer work so the union arm and its exhaustive handling land in one green commit.

**Files:**
- Modify: `lib/classes/message/contentParts.ts`, `.../index.ts`, `.../renderers/PartRenderer.ts`, `.../renderers/{OpenAIChatRenderer,JSONRenderer,OpenAIResponsesRenderer,GoogleRenderer,AnthropicRenderer}.ts`, `.../UserMessage.ts`
- Test: `lib/classes/message/audioPart.test.ts`, `lib/classes/message/renderers/audioRender.test.ts`

**Interfaces:**
- Produces: `AudioPart = { type: "audio"; source: BlobRef; filename?: string }`; `AudioPartSchema`; `AudioPart` in `UserContentPart`/`UserContentPartSchema`/`UserContentInput`; `audioPart()` helper; `PartRenderer.audio()`; `renderParts` audio dispatch; `OpenAIChatRenderer.audio()` → `{ type: "input_audio", input_audio: { data, format } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/classes/message/audioPart.test.ts
import { describe, it, expect } from "vitest";
import { UserMessage, audioPart, messageFromJSON } from "./index.js";

describe("AudioPart", () => {
  it("builds and round-trips through JSON", () => {
    const msg = new UserMessage([audioPart({ kind: "base64", base64: "AAAA", mimeType: "audio/wav" })]);
    const back = messageFromJSON(JSON.parse(JSON.stringify(msg.toJSON()))) as UserMessage;
    expect(back.getContentParts()![0].type).toBe("audio");
  });
});
```
```ts
// lib/classes/message/renderers/audioRender.test.ts
import { describe, it, expect } from "vitest";
import { OpenAIChatRenderer } from "./OpenAIChatRenderer.js";
import type { AudioPart } from "../contentParts.js";

describe("OpenAIChatRenderer.audio", () => {
  it("emits input_audio with base64 + derived format", () => {
    const out: any = new OpenAIChatRenderer().audio({ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } });
    expect(out.type).toBe("input_audio");
    expect(out.input_audio).toEqual({ data: "AAAA", format: "wav" });
  });
  it("throws (defensive) for a non-mp3/wav mime", () => {
    const part: AudioPart = { type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/ogg" } };
    expect(() => new OpenAIChatRenderer().audio(part)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests → FAIL** (`audioPart`/`.audio()` missing).

- [ ] **Step 3: Add type + schema + unions** (`contentParts.ts`)

```ts
export type AudioPart = { type: "audio"; source: BlobRef; filename?: string };
```
Import `BlobRef` from `../../util/imageRef.js`. Add to `UserContentPart` and `UserContentInput`. Schema (source excludes `providerFile`):
```ts
export const AudioPartSchema = z.object({
  type: z.literal("audio"),
  source: z.discriminatedUnion("kind", [...ImageRefSchema.options]),
  filename: z.string().optional(),
});
```
Add `AudioPartSchema` to `UserContentPartSchema`'s union.

- [ ] **Step 4: Add `audioPart()` helper** (`index.ts`, beside `imagePart`/`filePart`)

```ts
export function audioPart(source: BlobRef, filename?: string): AudioPart {
  const part: AudioPart = { type: "audio", source };
  if (filename !== undefined) part.filename = filename;
  return part;
}
```
Import/re-export `AudioPart` and `BlobRef` as neighboring helpers do.

- [ ] **Step 5: Extend renderer interface + dispatch** (`PartRenderer.ts`)

Add `audio(part: AudioPart): T;` to the interface (import `AudioPart`) and a branch to `renderParts`:
```ts
} else if (part.type === "audio") {
  out.push(renderer.audio(part));
} else {
  out.push(renderer.file(part));
}
```

- [ ] **Step 6: Implement `OpenAIChatRenderer.audio()`**

```ts
audio(part: AudioPart) {
  if (part.source.kind !== "base64") {
    throw new Error("internal: audio source must be resolved to base64 before rendering");
  }
  const format = chatAudioFormat(part.source.mimeType);
  if (!format) throw new Error(`Chat audio supports only mp3/wav; got "${part.source.mimeType}".`);
  return { type: "input_audio", input_audio: { data: part.source.base64, format } };
}
```
Import `chatAudioFormat` from `../../../util/audioMime.js`. (This throw is a defensive backstop; Task 7 rejects non-mp3/wav and non-openai during preparation, so it is unreachable in normal flow.)

- [ ] **Step 7: Implement `JSONRenderer.audio()`** (call the file-local function, not `this.`)

```ts
audio(part: AudioPart) {
  // bytesToBase64 only converts `bytes`; other kinds pass through, all within BlobRef.
  return { type: "audio", source: bytesToBase64(part.source) as BlobRef, filename: part.filename };
}
```
`bytesToBase64` is the existing file-local `function` in `JSONRenderer.ts`; its param type `AttachmentSource` already accepts a `BlobRef`. Import `BlobRef` and `AudioPart` types.

- [ ] **Step 8: Defensive `audio()` on the other three renderers**

In `OpenAIResponsesRenderer.ts`, `GoogleRenderer.ts`, `AnthropicRenderer.ts`:
```ts
audio(_part: AudioPart): any {
  throw new Error("Audio input is not supported for this provider in v1.");
}
```

- [ ] **Step 9: Ollama loop** (`UserMessage.toOllamaMessage()`)

In the part loop, beside the file branch:
```ts
if (part.type === "audio") {
  throw new Error("Ollama does not support audio input.");
}
```

- [ ] **Step 10: Run tests + typecheck → PASS/clean**

Run: `pnpm --filter smoltalk test lib/classes/message/audioPart.test.ts lib/classes/message/renderers/audioRender.test.ts`
Run: `pnpm --filter smoltalk typecheck` (union exhaustiveness satisfied in this same task) → clean

- [ ] **Step 11: Commit**

```bash
git add lib/classes/message/contentParts.ts lib/classes/message/index.ts lib/classes/message/renderers/ lib/classes/message/UserMessage.ts lib/classes/message/audioPart.test.ts lib/classes/message/renderers/audioRender.test.ts
git commit -m "feat(message): AudioPart content part + audioPart() + total renderer coverage"
```

---

## Task 7: Attachment resolution for audio (+ chat-MIME rejection)

**Files:**
- Modify: `lib/clients/resolveAttachments.ts`
- Test: `lib/clients/resolveAttachments.audio.test.ts`

**Interfaces:**
- Consumes: `AudioPart`, `normalizeImageRef` (`allowedMimePrefixes: ["audio/"]`), `chatAudioFormat`.
- Produces: `messagesHaveAttachments` counts audio; `resolveMessageAttachments` resolves audio to inline base64 and returns `Failure` for a non-mp3/wav chat MIME (so unsupported MIME fails during preparation, not from a renderer).

- [ ] **Step 1: Write the failing tests (incl. OGG rejection)**

```ts
// lib/clients/resolveAttachments.audio.test.ts
import { describe, it, expect } from "vitest";
import { messagesHaveAttachments, resolveMessageAttachments } from "./resolveAttachments.js";
import { UserMessage } from "../classes/message/index.js";

const mk = (mime: string) => new UserMessage([{ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: mime } }]);

describe("audio attachment resolution", () => {
  it("detects audio parts", () => { expect(messagesHaveAttachments([mk("audio/wav")])).toBe(true); });
  it("resolves supported audio to a base64 source", async () => {
    const r = await resolveMessageAttachments([mk("audio/wav")], { provider: "openai", maxBytes: 1_000_000 });
    expect(r.success).toBe(true);
    if (r.success) expect((( r.value[0] as UserMessage).getContentParts()![0] as any).source.kind).toBe("base64");
  });
  it("fails during preparation for a non-mp3/wav chat MIME", async () => {
    const r = await resolveMessageAttachments([mk("audio/ogg")], { provider: "openai", maxBytes: 1_000_000 });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Detect audio** in `messagesHaveAttachments`:
```ts
if (part.type === "image" || part.type === "file" || part.type === "audio") return true;
```

- [ ] **Step 4: Resolve + reject unsupported chat MIME** in `resolveMessageAttachments` (after the `text` passthrough; guard the existing `providerFile`/`url` passthrough blocks to `part.type === "image" || part.type === "file"`):
```ts
if (part.type === "audio") {
  try {
    const { data, mimeType } = await normalizeImageRef(part.source, {
      allowedMimePrefixes: ["audio/"], maxBytes: options.maxBytes,
    });
    if (chatAudioFormat(mimeType) === null) {
      return failure(`Chat audio input supports only mp3/wav; got "${mimeType}".`);
    }
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
Import `chatAudioFormat` from `../util/audioMime.js`.

- [ ] **Step 5: Run tests + typecheck → PASS.**

- [ ] **Step 6: Commit**

```bash
git add lib/clients/resolveAttachments.ts lib/clients/resolveAttachments.audio.test.ts
git commit -m "feat(attachments): resolve AudioPart to base64; reject non-mp3/wav in prep"
```

---

## Task 8: Audio validation gate (provider-aware, OpenAI-only, positive)

**Files:**
- Modify: `lib/util/modalities.ts`
- Test: `lib/util/modalities.audio.test.ts`

**Interfaces:**
- Consumes: `resolveProvider`, `getModelForProvider`.
- Produces: `validateModalities` → `Failure` when audio parts present AND (provider !== "openai" OR the provider-keyed model does not list `audio` in `modalities.input`). Undefined/unknown models fail (positive check).

- [ ] **Step 1: Write the failing test**

```ts
// lib/util/modalities.audio.test.ts
import { describe, it, expect } from "vitest";
import { validateModalities } from "./modalities.js";
import { UserMessage } from "../classes/message/index.js";

const audioMsg = new UserMessage([{ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } }]);
const dupMd = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "text", modelName: "dup", provider: "acme", maxInputTokens: 1, maxOutputTokens: 1,
    modalities: { input: ["text", "audio"], output: ["text"] } }] } as any;

describe("validateModalities — audio", () => {
  it("passes for gpt-audio-1.5 on openai", () => {
    expect(validateModalities({ model: "gpt-audio-1.5", messages: [audioMsg] } as any)).toBeNull();
  });
  it("rejects a text-only model", () => {
    expect(validateModalities({ model: "gpt-4o-mini", messages: [audioMsg] } as any)?.success).toBe(false);
  });
  it("rejects an unknown/unannotated model (undefined support is not true)", () => {
    expect(validateModalities({ model: "totally-unknown", provider: "openai", messages: [audioMsg] } as any)?.success).toBe(false);
  });
  it("rejects a non-openai provider even if that model declares audio", () => {
    expect(validateModalities({ model: "gemini-3.1-pro-preview", messages: [audioMsg] } as any)?.success).toBe(false);
  });
  it("rejects openai-responses with audio", () => {
    expect(validateModalities({ model: "gpt-audio-1.5", provider: "openai-responses", messages: [audioMsg] } as any)?.success).toBe(false);
  });
  it("does not inherit audio capability from a same-named non-openai model", () => {
    // "dup" is audio-capable under provider "acme" only; an openai override must not borrow it.
    expect(validateModalities({ model: "dup", provider: "openai", modelData: dupMd, messages: [audioMsg] } as any)?.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (no audio arm).

- [ ] **Step 3: Add the provider-aware audio gate**

In `validateModalities`, set `needsAudio` in the scan loop, then before `return null`:
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
  const model = getModelForProvider(provider, config.model, config.modelData);
  const inputs = model && model.type === "text" ? model.modalities?.input : undefined;
  if (!inputs || !inputs.includes("audio")) {
    return failure(`Model ${config.model} does not support audio input.`);
  }
}
```
Import `resolveProvider` from `./provider.js` and `getModelForProvider` from `../models.js`. (Runs inside `prepareAttachments` before both serializers, so `textSync` returns the `Failure` and `textStream` surfaces it as an `error` chunk — no renderer is reached.)

- [ ] **Step 4: Run tests + typecheck → PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/util/modalities.ts lib/util/modalities.audio.test.ts
git commit -m "feat(modalities): provider-aware, OpenAI-only, positive audio-input gate"
```

---

## Task 9: End-to-end audio-in-chat via client seams

> Uses the repo's established test seam (subclass `SmolOpenAi`, expose protected methods) — see `lib/clients/openai.test.ts` (`FakeProvider` overrides `resolveClientOptions()`, exposes `calculateUsageAndCost` and `buildRequest`). No network mock required.

**Files:**
- Test: `lib/clients/openai.audioChat.test.ts`

- [ ] **Step 1: Write the test (serialization + cost + parity + no-call-on-reject)**

```ts
// lib/clients/openai.audioChat.test.ts
import { describe, it, expect } from "vitest";
import { SmolOpenAi } from "./openai.js";
import { UserMessage } from "../classes/message/index.js";
import type { SmolConfig } from "../types.js";

const audioMd = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "text", modelName: "gpt-audio-1.5", provider: "openai",
    maxInputTokens: 128000, maxOutputTokens: 16384,
    modalities: { input: ["text", "audio"], output: ["text", "audio"] },
    inputTokenCost: 2.5, outputTokenCost: 10, inputAudioTokenCost: 32, outputAudioTokenCost: 64 }] } as any;

class Seam extends SmolOpenAi {
  protected resolveClientOptions() { return { apiKey: "k" }; }
  publicBuild(c: SmolConfig) { return (this as any).buildRequest(c); }
  publicCalc(u: any) { return (this as any).calculateUsageAndCost(u); }
}
const client = () => new Seam({ model: "gpt-audio-1.5", provider: "openai", modelData: audioMd, messages: [] });

describe("audio-in-chat", () => {
  it("serializes a base64 AudioPart into an input_audio content block", () => {
    const msg = new UserMessage([{ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } }]);
    const req = client().publicBuild({ model: "gpt-audio-1.5", provider: "openai", modelData: audioMd, messages: [msg] });
    const content = req.messages.find((m: any) => m.role === "user").content;
    const audioBlock = content.find((p: any) => p.type === "input_audio");
    expect(audioBlock.input_audio).toEqual({ data: "AAAA", format: "wav" });
  });

  it("prices audio tokens disjointly from text (same math sync + stream share)", () => {
    const { usage, cost } = client().publicCalc({
      prompt_tokens: 2_000_000,
      prompt_tokens_details: { audio_tokens: 1_000_000 },
      completion_tokens: 0,
      total_tokens: 2_000_000,
    });
    expect(usage?.inputAudioTokens).toBe(1_000_000);
    expect(usage?.inputTokens).toBe(1_000_000);
    // text 1M*$2.5/1M + audio 1M*$32/1M = 34.5
    expect(cost?.inputCost).toBeCloseTo(34.5, 5);
  });
});
```
> `calculateUsageAndCost` is the single method both `textSync` and `textStream` call for usage/cost, so this assertion covers parity. If `buildRequest`'s user-message shape differs, adjust the accessor to match the real structure (inspect `ExtrasProvider.publicBuild` output in `openai.test.ts`).

- [ ] **Step 2: Run test → PASS; close any wiring gap**

Run: `pnpm --filter smoltalk test lib/clients/openai.audioChat.test.ts`
If a gap surfaces, fix it in the relevant Task 6–8 file and **stage that production file too** in Step 4.

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm --filter smoltalk test` → all PASS
Run: `pnpm --filter smoltalk typecheck` → clean

- [ ] **Step 4: Commit**

```bash
git add lib/clients/openai.audioChat.test.ts   # plus any production files touched to close gaps
git commit -m "test(audio): end-to-end audio-in-chat serialization + disjoint cost"
```

---

## Task 10: Docs & changelog

**Files:**
- Modify: `packages/smoltalk/README.md`, `packages/smoltalk/CHANGELOG.md`

- [ ] **Step 1: Document the feature**

Add a README "Audio (STT/TTS)" section: minimal `transcribe()`, `speak()`, and audio-in-chat (`audioPart` on `gpt-audio-1.5`) examples; the OpenAI-only v1 scope + model allowlists; that returned audio bytes are caller-owned; and that `AudioPart` audio must be mp3/wav.

- [ ] **Step 2: Update the changelog**

Open `packages/smoltalk/CHANGELOG.md`, match its existing format/heading style, and add an entry describing STT/TTS/audio-in-chat. (Do not rely on a changelog skill; follow the file's own format.)

- [ ] **Step 3: Commit**

```bash
git add packages/smoltalk/README.md packages/smoltalk/CHANGELOG.md
git commit -m "docs: document audio STT/TTS and audio-in-chat"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** STT (Task 4), TTS (Task 5), AudioPart pipeline (Tasks 6–8), audio-token cost (Task 2 + Task 9 assertion), registry cleanup + gpt-audio-1.5 (Task 1), MIME contracts incl. PCM (Task 3), allowlists (Tasks 4/5), provider-aware positive validation (Task 8, using `getModelForProvider` from Task 1), exception boundary with `await` + `redactSecret` (Tasks 4/5), end-to-end + cost parity (Task 9), docs (Task 10). All spec sections map to a task.
- **Review findings addressed:** #1 awaited dispatch + redaction (T4/T5) with throw/reject tests; #2 valid `ModelDataBlob` fixtures (T2/T8/T9); #3 chat-MIME rejection in prep (T7) with OGG test; #4 `getModelForProvider` + collision test (T1/T4/T5/T8); #5 file-local `bytesToBase64` (T6); #6 merged content-part+renderer task (T6); #7 concrete OpenAI STT/TTS provider tests (T4/T5); #8 seam-based chat test (T9); #9 gpt-audio-1.5 only (T1); #10 `.mpeg` added, `isTranscribeMime` guard, OpenAI limits on the OpenAI branch only, named `CHANGELOG.md` (T3/T4/T5/T10).
- **Deferred (spec Non-goals), intentionally absent:** streaming STT/TTS, token-priced GPT dedicated endpoint models, non-OpenAI providers, assistant audio output, translation, SSRF guard, voice discovery.
- **Type consistency:** `TranscribeOptions`/`SpeakOptions` use `model: string` + `modelData`; provider signatures `transcribe(data, mimeType, ctx)` / `speak(text, ctx)` consistent module↔impl; `AudioPart.source: BlobRef` throughout; `SpeakFormat`/`chatAudioFormat`/`isTranscribeMime` shared from `audioMime.ts`; `getModelForProvider` signature identical across T1/T4/T5/T8.
- **Implementer verification points:** exact gpt-audio-1.5 + tts pricing via `update-models` (T1); `toFile` import path for the installed `openai` (T4); the exact `buildRequest` user-message shape when asserting `input_audio` (T9).
