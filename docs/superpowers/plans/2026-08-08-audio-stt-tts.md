# Audio: STT, TTS & Audio-in-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI speech-to-text (`transcribe()`), text-to-speech (`speak()`), and audio-in-chat (`AudioPart`) to the smoltalk core package, with correct cost accounting.

**Architecture:** `transcribe()`/`speak()` are top-level capability functions backed by a provider registry, mirroring `lib/embed.ts` — they do **not** go through `SmolClient`/`getClient()`. Audio-in-chat adds an `AudioPart` arm to the user content-part union and rides the existing text pipeline (renderers + attachment resolution + modality gates), with real audio-token pricing added to the OpenAI usage path.

**Tech Stack:** TypeScript (ESM, `.js` import extensions, `strict`), Zod schemas, `openai` SDK, vitest.

> **Revision note (rev 3):** incorporates the accepted plan-review, anti-pattern-audit, and test-plan findings. In particular, pricing is provider-aware end-to-end; public exports are explicit; MIME and prepared-audio boundaries are total and declarative; STT/TTS interfaces use named nested/context types; and mutation-sensitive public sync/stream chat tests replace the former direct-only parity claim. The approved architecture and OpenAI-only v1 scope are unchanged.

**Working-directory convention:** every file path in this plan is relative to `packages/smoltalk/`, and every command (including `git add`) runs from that package directory.

## Global Constraints

- **v1 is OpenAI-only.** STT built-in model allowlist = `{ whisper-1 }`; TTS allowlist = `{ tts-1, tts-1-hd }`; audio-chat model = `gpt-audio-1.5`. Every other provider returns/raises `Failure` for audio.
- **ESM imports use `.js` extensions**; `"type": "module"`; target ESNext, `strict: true`.
- **Public operations return `Result<T>`** (`success(v)` / `failure(msg)` from `lib/types/result.js`). `transcribe()`/`speak()` never throw — wrap all work in try/catch, and `await` any dispatched provider call inside that try so a rejected promise is caught.
- **Redact and log caught exceptions once.** At the public STT/TTS boundary, call `getLogger().error("transcribe() provider failed:", redactSecret(message, apiKey))` (or the symmetric `speak()` message), then return the same redacted text as `Failure`. Do not log expected provider/model preflight failures, do not log in the OpenAI adapter and public boundary both, and never log raw SDK errors or keys.
- **Readable production snippets:** no nested ternaries, one-line `if` statements, or dense multi-action lines. Conditional object spreads are allowed where they match the existing SDK request style.
- **"Character" for TTS pricing = Unicode code points** (`[...text].length`), not `text.length`.
- **Provider-aware model lookup:** capability/pricing/modality lookups for audio use `getModelForProvider(provider, modelName, modelData)` (added in Task 1), never a name-only `getModel`, so an explicit provider override can't inherit a same-named model owned by another provider.
- **Tests live beside implementation** as `*.test.ts`; run with `pnpm --filter smoltalk test`. Cost/config fixtures use `satisfies ModelDataBlob`, `satisfies SmolConfig`, or an explicit type — never `as any`. Package typecheck excludes tests, so each test snippet must still be type-sound and is exercised by Vitest/esbuild.
- **No real network calls:** mock OpenAI SDK/fetch, use temporary directories for path cases, restore globals/mocks, and remove temp directories in `afterEach`/`finally`.
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
- `README.md`, `CHANGELOG.md` — docs.

---

## Task 1: Model registry — STT, TTS, audio-chat entries, and provider-aware lookup

**Files:**
- Modify: `lib/models.ts`, `scripts/seed-model-data.ts`, `data/model-data.json`
- Test: `lib/models.audio.test.ts`, `lib/index.test.ts`, `tests/seed-model-data.test.ts`

**Interfaces:**
- Produces: `TextToSpeechModel` type; `isTextToSpeechModel()`; `getModelForProvider(provider, modelName, modelData?)`; entries `whisper-1` (speech-to-text, `perMinuteCost`), `tts-1`/`tts-1-hd` (text-to-speech, `perCharacterCost`), `gpt-audio-1.5` (text, `modalities.input` includes `"audio"`, `modalities.output` includes `"audio"`, with the four `*TokenCost` fields); aliases `SpeechToTextModelName`, `TextToSpeechModelName`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/models.audio.test.ts
import { describe, it, expect } from "vitest";
import {
  getAllModels, getModel, getModelForProvider, isTextToSpeechModel,
  isSpeechToTextModel, modelSupportsInputModality,
} from "./models.js";
import type { ModelDataBlob } from "./modelData.js";

describe("audio model registry", () => {
  it("has the verified STT/TTS prices, providers, and registry inclusion", () => {
    const m = getModel("whisper-1")!;
    expect(isSpeechToTextModel(m)).toBe(true);
    if (!isSpeechToTextModel(m)) {
      throw new Error("expected STT model");
    }
    expect(m).toMatchObject({ provider: "openai", perMinuteCost: 0.006 });
    const expected = { "tts-1": 0.000015, "tts-1-hd": 0.00003 } as const;
    for (const [name, rate] of Object.entries(expected)) {
      const speech = getModel(name)!;
      expect(isTextToSpeechModel(speech)).toBe(true);
      if (!isTextToSpeechModel(speech)) {
        throw new Error("expected TTS model");
      }
      expect(speech).toMatchObject({ provider: "openai", perCharacterCost: rate });
    }
    const names = getAllModels().map((model) => model.modelName);
    expect(names).toEqual(expect.arrayContaining(["whisper-1", "tts-1", "tts-1-hd", "gpt-audio-1.5"]));
  });
  it("has exact audio-chat rates and modalities", () => {
    expect(modelSupportsInputModality("gpt-audio-1.5", "audio")).toBe(true);
    expect(getModel("gpt-audio-1.5")).toMatchObject({
      provider: "openai",
      modalities: { input: ["text", "audio"], output: ["text", "audio"] },
      inputTokenCost: 2.5,
      outputTokenCost: 10,
      inputAudioTokenCost: 32,
      outputAudioTokenCost: 64,
    });
  });
  it("whisper-web stub is gone", () => {
    expect(getModel("whisper-web")).toBeUndefined();
  });
  it("getModelForProvider matches on provider + name", () => {
    const md = {
      schemaVersion: 1, generatedAt: "t", hostedTools: [],
      models: [
        { type: "text", modelName: "dup", provider: "acme", maxInputTokens: 1,
          maxOutputTokens: 1, inputTokenCost: 99,
          modalities: { input: ["text", "audio"], output: ["text"] } },
        { type: "text", modelName: "dup", provider: "openai", maxInputTokens: 2,
          maxOutputTokens: 2, inputTokenCost: 7,
          modalities: { input: ["text"], output: ["text"] } },
      ],
    } satisfies ModelDataBlob;
    expect(getModelForProvider("acme", "dup", md)?.provider).toBe("acme");
    expect(getModelForProvider("openai", "dup", md)?.inputTokenCost).toBe(7);
  });
});
```
Add an exact overlay-precedence regression using a colliding `provider:modelName`: baked-in < globally registered blob < request `modelData`, while an entry with the same name under another provider never contributes fields. Reset global model data after the test. Add public export/compile assertions for the new model type, name alias, guard, and provider-aware lookup in the existing index test.

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

- [ ] **Step 7: Update and verify the seed catalog**

`scripts/seed-model-data.ts` explicitly enumerates each model array. Import `textToSpeechModels` and spread it beside `speechToTextModels`; this is mandatory, not conditional. Extend `tests/seed-model-data.test.ts` to assert that `tts-1` and `tts-1-hd` are present and `whisper-web` is absent. Run `pnpm seed-data` from the package directory to regenerate `data/model-data.json`, then assert the generated blob contains the new STT/TTS/audio-chat entries and no `whisper-web`.

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter smoltalk test lib/models.audio.test.ts lib/index.test.ts tests/seed-model-data.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`
Run: `pnpm --filter smoltalk test` → PASS

- [ ] **Step 9: Commit**

```bash
git add lib/models.ts lib/models.audio.test.ts lib/index.test.ts scripts/seed-model-data.ts tests/seed-model-data.test.ts data/model-data.json
git commit -m "feat(models): add whisper-1, tts-1/-hd, gpt-audio-1.5; add getModelForProvider"
```

---

## Task 2: Audio-token usage & cost accounting

**Files:**
- Modify: `lib/types/tokenUsage.ts`, `lib/model.ts` (`calculateCost` ~36-115), `lib/clients/openai.ts` (`calculateUsageAndCost` ~109-150)
- Test: `lib/model.audioCost.test.ts`, `lib/clients/openai.test.ts`

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
  }],
  hostedTools: [],
};

describe("calculateCost with audio tokens", () => {
  it("prices all four buckets disjointly", () => {
    const m = new Model("audio-test", "openai", modelData);
    const cost = m.calculateCost({
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      inputAudioTokens: 1_000_000, outputAudioTokens: 1_000_000,
    })!;
    expect(cost.inputCost).toBe(34);
    expect(cost.outputCost).toBe(74);
    expect(cost.totalCost).toBe(108);
  });
});
```

In the same file add mutation-sensitive cases with fully typed blobs: (a) omit both audio rates and expect audio buckets to use text rates; (b) parse all audio fields through `TokenUsageSchema`; (c) verify `addTokenUsage` sums them; (d) retain the existing cached-token behavior with audio present; (e) no usage produces no OpenAI usage/cost; and (f) an ordinary non-audio model produces its unchanged known cost. Use exact numeric assertions, not `> 0`.

- [ ] **Step 2: Run test → FAIL** (`pnpm --filter smoltalk test lib/model.audioCost.test.ts`) — audio priced at text rate/ignored; TS error on `inputAudioTokens`.

- [ ] **Step 3: Extend `TokenUsage`**

In `lib/types/tokenUsage.ts` add `inputAudioTokens?: number; outputAudioTokens?: number;` to the type, `.optional()` fields to `TokenUsageSchema`, and sum them in `addTokenUsage` (mirroring `cachedInputTokens`).

- [ ] **Step 4: Price audio buckets in `calculateCost`**

Import both lookups and use the provider whenever available:
```ts
import {
  ModelName,
  getModel,
  getModelForProvider,
  isTextModel,
  ModelNameSchema,
  Provider,
} from "./models.js";

let model: ModelType | undefined;
if (this.provider !== undefined) {
  model = getModelForProvider(this.provider, this.model, this.modelData);
} else {
  model = getModel(this.model, this.modelData);
}
```
Import `ModelType` as a type. This is the only permitted name-only fallback: `this.provider` must be absent. Widen every provider-bearing `Model` signature consistently from the closed built-in `Provider` union to `string`: the private field, constructor parameter, `getProvider()`, `lookupProvider()`, and `Model.create()` parameter. Remove the obsolete `Provider` import and the `as Provider` cast in `lookupProvider()`; this widening is required because OpenAI-compatible/custom providers are valid pricing keys. In `lib/model.ts`, extend the `usage` param type with `inputAudioTokens?: number; outputAudioTokens?: number;`. Name the pricing unit and use it throughout:
```ts
const TOKEN_COST_UNIT = 1_000_000;
const audioInTokens = usage.inputAudioTokens ?? 0;
const audioOutTokens = usage.outputAudioTokens ?? 0;
// Fall back to the text rate if no audio rate is defined so the total stays honest.
const audioInRate = model.inputAudioTokenCost ?? model.inputTokenCost ?? 0;
const audioOutRate = model.outputAudioTokenCost ?? model.outputTokenCost ?? 0;
const audioInCost = round((audioInTokens * audioInRate) / TOKEN_COST_UNIT, 6);
const audioOutCost = round((audioOutTokens * audioOutRate) / TOKEN_COST_UNIT, 6);
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
if (cached > 0) {
  usage.cachedInputTokens = cached;
}
if (audioIn > 0) {
  usage.inputAudioTokens = audioIn;
}
if (audioOut > 0) {
  usage.outputAudioTokens = audioOut;
}
```
`calculateCost(usage)` already receives the whole object; both sync and stream flow through this one method (no other change).

In `SmolOpenAi` retain the effective call provider instead of discarding it:
```ts
this.model = new Model(config.model, config.provider ?? "openai", config.modelData);
```
Add an OpenAI usage seam test whose `ModelDataBlob` has the same model name under `openai` and `acme` with deliberately different text/audio rates. Construct `SmolOpenAi` with `provider: "openai"`, pass all four usage buckets, and assert the exact OpenAI cost. Also subclass `resolveCostUsd()` to return `12.34` and assert that provider-supplied cost still overrides registry math.

- [ ] **Step 6: Run tests + typecheck → PASS**

- [ ] **Step 7: Commit**

```bash
git add lib/types/tokenUsage.ts lib/model.ts lib/clients/openai.ts lib/model.audioCost.test.ts lib/clients/openai.test.ts
git commit -m "feat(cost): price audio input/output tokens disjointly from text"
```

---

## Task 3: Audio MIME support

**Files:**
- Create: `lib/util/audioMime.ts`, `lib/util/audioMime.test.ts`
- Modify: `lib/util/imageRef.ts` (`EXT_TO_MIME` ~30-37)

**Interfaces:**
- Produces: `SpeakFormat`; total `transcriptionAudioType(mime): { extension; filename } | null`; `chatAudioFormat(mime): "mp3"|"wav"|null`; `SPEECH_FORMAT_TO_MIME` (PCM → `application/octet-stream`). No caller has a validate-then-unsafe-call ordering contract.

- [ ] **Step 1: Write the failing test**

```ts
// lib/util/audioMime.test.ts
import { describe, it, expect } from "vitest";
import { transcriptionAudioType, chatAudioFormat, SPEECH_FORMAT_TO_MIME } from "./audioMime.js";

describe("audioMime", () => {
  it("derives a filename with a real extension", () => {
    expect(transcriptionAudioType("audio/mpeg")).toEqual({ extension: "mp3", filename: "audio.mp3" });
    expect(transcriptionAudioType("audio/wav")).toEqual({ extension: "wav", filename: "audio.wav" });
  });
  it("recognizes supported transcription MIME types", () => {
    expect(transcriptionAudioType("audio/ogg")).toEqual({ extension: "ogg", filename: "audio.ogg" });
    expect(transcriptionAudioType("audio/basic")).toBeNull();
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

const TRANSCRIBE_MIME_TO_EXT: Readonly<Record<string, string>> = {
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

export type TranscriptionAudioType = {
  extension: string;
  filename: string;
};

export function transcriptionAudioType(mime: string): TranscriptionAudioType | null {
  const extension = TRANSCRIBE_MIME_TO_EXT[mime];
  if (extension === undefined) {
    return null;
  }
  return { extension, filename: `audio.${extension}` };
}

export function chatAudioFormat(mime: string): "mp3" | "wav" | null {
  if (mime === "audio/mpeg" || mime === "audio/mp3") {
    return "mp3";
  }
  if (mime === "audio/wav" || mime === "audio/x-wav") {
    return "wav";
  }
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
Add a table test for every transcription alias (`flac`, `mpeg/mp3`, `mp4`, `m4a/x-m4a`, `ogg`, `wav/x-wav`, `webm`) with deterministic extension/filename; every speech output mapping; all chat aliases and OGG rejection. Test extension inference directly for `.mp3`, `.mpeg`, `.mpga`, `.wav`, `.m4a`, `.mp4`, `.ogg`, `.flac`, and `.webm`. `extname()` is lowercased by the current helper; lock that contract with an uppercase `.WAV` path assertion.

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
- Test: `lib/index.test.ts`

**Interfaces:**
- Consumes: `loadBlob`/`BlobRef`, `resolveProvider`/`resolveApiKey`, `getModelForProvider`/`isSpeechToTextModel`, total `transcriptionAudioType`, `redactSecret`, `getLogger`.
- Produces: named `TranscriptionSegment`, `TranscriptionWord`, `TranscriptionProviderOptions`, and `TranscriptionProviderContext`; `TranscribeOptions`, `TranscriptionResult`, `TranscriptionProvider`, `registerTranscriptionProvider`, internal-only `_resetForTests`, `transcribe`. Allowlist `OPENAI_TRANSCRIBE_MODELS = new Set(["whisper-1"])`.

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
    registerTranscriptionProvider("boom", {
      transcribe() {
        throw new Error("kaboom");
      },
    });
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
import { getLogger } from "./util/logger.js";
import { openaiTranscribe } from "./transcription/openai.js";

export type TranscribeOptions = {
  model: string; provider?: string; modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"]; language?: string; prompt?: string;
  timestampGranularity?: "segment" | "word"; maxBytes?: number; filename?: string;
};
export type TranscriptionSegment = { start: number; end: number; text: string };
export type TranscriptionWord = { start: number; end: number; word: string };
export type TranscriptionResult = {
  text: string; language?: string; durationSeconds?: number;
  segments?: TranscriptionSegment[];
  words?: TranscriptionWord[];
  usage?: TokenUsage; cost?: CostEstimate; raw?: unknown;
};
export type TranscriptionProviderOptions = Omit<TranscribeOptions, "apiKey">;
export type TranscriptionProviderContext = {
  apiKey: string;
  opts: TranscriptionProviderOptions;
};
export type TranscriptionProvider = {
  transcribe(data: Uint8Array, mimeType: string,
    ctx: TranscriptionProviderContext): Promise<Result<TranscriptionResult>>;
};

export const OPENAI_TRANSCRIBE_MODELS = new Set(["whisper-1"]);
export const DEFAULT_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

const registered: Record<string, TranscriptionProvider> = Object.create(null);
export function registerTranscriptionProvider(name: string, impl: TranscriptionProvider): void {
  registered[name] = impl;
}
export function _resetForTests(): void {
  for (const key of Object.keys(registered)) {
    delete registered[key];
  }
}

function providerContext(
  apiKey: string,
  opts: TranscribeOptions,
): TranscriptionProviderContext {
  const { apiKey: _callerKey, ...providerOptions } = opts;
  return { apiKey, opts: providerOptions };
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
      if (!apiKey) {
        return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      }
      return await openaiTranscribe(loaded.data, mimeType, providerContext(apiKey, opts));
    }

    const custom = registered[provider];
    if (custom) {
      const apiKey = resolveApiKey(provider, opts) ?? "";
      return await custom.transcribe(
        loaded.data,
        mimeType,
        providerContext(apiKey, opts),
      );
    }
    return failure(`Provider "${provider}" has no transcription API. Register one with registerTranscriptionProvider(name, impl).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "transcribe() failed";
    const redacted = redactSecret(msg, apiKeyForRedaction);
    getLogger().error("transcribe() provider failed:", redacted);
    return failure(redacted);
  }
}
```
`TranscriptionProviderContext` carries the resolved key plus provider options with the caller's `apiKey` field removed, so plugins receive one secret source rather than two. Do not add SDK clients. Keep STT and TTS structurally symmetric. Extract a shared helper only if the final implementations otherwise duplicate the same provider-selection/secret-redacted exception code exactly; do not introduce a generic capability dispatcher.

- [ ] **Step 4: Implement `lib/transcription/openai.ts`** (provider-aware lookup; reject unsupported MIME)

```ts
import OpenAI, { toFile } from "openai";
import { Result, success, failure } from "../types/result.js";
import { getModelForProvider, isSpeechToTextModel } from "../models.js";
import { round } from "../util/util.js";
import { transcriptionAudioType } from "../util/audioMime.js";
import type {
  TranscriptionProviderContext,
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionWord,
} from "../transcription.js";

export async function openaiTranscribe(
  data: Uint8Array,
  mimeType: string,
  ctx: TranscriptionProviderContext,
): Promise<Result<TranscriptionResult>> {
  const { opts } = ctx;
  // Deliberately do not catch SDK exceptions here: transcribe() is the single
  // redacting/logging exception boundary.
  const model = getModelForProvider("openai", opts.model, opts.modelData);
    if (model && !isSpeechToTextModel(model)) {
      return failure(`Model "${opts.model}" is not a speech-to-text model.`);
    }
    const audioType = transcriptionAudioType(mimeType);
    if (audioType === null) {
      return failure(`Unsupported audio type "${mimeType}" for transcription. Supported: flac, mp3, mp4, m4a, ogg, wav, webm.`);
    }

    const client = new OpenAI({ apiKey: ctx.apiKey });
    const filename = opts.filename ?? audioType.filename;
    const file = await toFile(data, filename, { type: mimeType });

    const granularities: ("segment" | "word")[] = [];
    if (opts.timestampGranularity) {
      granularities.push(opts.timestampGranularity);
    }

    const res: any = await client.audio.transcriptions.create({
      file, model: opts.model, response_format: "verbose_json",
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
      ...(granularities.length ? { timestamp_granularities: granularities } : {}),
    });

    const result: TranscriptionResult = { text: res.text, raw: res };
    if (res.language) {
      result.language = res.language;
    }
    if (typeof res.duration === "number") {
      result.durationSeconds = res.duration;
    }
    if (Array.isArray(res.segments)) {
      result.segments = res.segments.map((segment: TranscriptionSegment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
      }));
    }
    if (Array.isArray(res.words)) {
      result.words = res.words.map((word: TranscriptionWord) => ({
        start: word.start,
        end: word.end,
        word: word.word,
      }));
    }

    if (model && isSpeechToTextModel(model) && model.perMinuteCost && result.durationSeconds != null) {
      const inputCost = round((result.durationSeconds / 60) * model.perMinuteCost, 6);
      result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
    }
    return success(result);
}
```
> If `toFile` isn't exported from your `openai` version, import from `openai/uploads`. Verify against the installed SDK.

- [ ] **Step 5: Write the OpenAI provider test (mock the SDK)**

```ts
// lib/transcription/openai.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelDataBlob } from "../modelData.js";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI { audio = { transcriptions: { create } }; constructor(_: any) {} }
  return { default: OpenAI, toFile: async (data: any, name: string, o: any) => ({ data, name, type: o?.type }) };
});
import { openaiTranscribe } from "./openai.js";

const md = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "speech-to-text", modelName: "whisper-1", provider: "openai", perMinuteCost: 0.006 }],
} satisfies ModelDataBlob;

beforeEach(() => create.mockReset());

describe("openaiTranscribe", () => {
  it("sends verbose_json + timestamps, normalizes segments/words, computes duration cost", async () => {
    create.mockResolvedValue({ text: "hello", language: "en", duration: 120,
      segments: [{ start: 0, end: 1, text: "hello" }], words: [{ start: 0, end: 1, word: "hello" }] });
    const r = await openaiTranscribe(new Uint8Array([1]), "audio/wav",
      { apiKey: "sk-x", opts: { model: "whisper-1", timestampGranularity: "word", modelData: md } });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
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
});
```
Expand these two files with the full STT mutation-sensitive matrix: happy path; separate segment and word requests/normalization; exact duration cost; oversize and missing key; derived multipart MIME+filename and explicit filename override; language/prompt forwarding; every supported MIME/alias; unsupported MIME; injected `modelData` cannot bypass the OpenAI allowlist; unknown model without provider; unregistered custom provider; registered custom provider receives exact bytes, MIME, resolved key, and options and returns no library-added cost; built-in registration cannot override OpenAI; synchronous throw; rejected custom-provider promise; rejected SDK promise converted by the public boundary to one redacted/logged `Failure`; and omitted cost when duration or rate is absent. Every preflight case must assert a specific error substring **and** `create`/provider spy not called. Make the SDK mock capture `toFile(data, name, { type })`, and assert exact bytes/name/type rather than merely success. Spy on `getLogger().error` for exception cases and assert one redacted log, not the raw key.

- [ ] **Step 6: Export + run**

Match the existing Files API pattern; keep `_resetForTests` internal:
```ts
export {
  transcribe,
  registerTranscriptionProvider,
  OPENAI_TRANSCRIBE_MODELS,
  DEFAULT_TRANSCRIBE_BYTES,
} from "./transcription.js";
export type {
  TranscribeOptions,
  TranscriptionSegment,
  TranscriptionWord,
  TranscriptionResult,
  TranscriptionProviderOptions,
  TranscriptionProviderContext,
  TranscriptionProvider,
} from "./transcription.js";
```
Add `lib/index.test.ts` compile/runtime assertions for the intended exports and assert `"_resetForTests" in smoltalk` is false.
Run: `pnpm --filter smoltalk test lib/transcription.test.ts lib/transcription/openai.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/transcription.ts lib/transcription/openai.ts lib/transcription.test.ts lib/transcription/openai.test.ts lib/index.ts lib/index.test.ts
git commit -m "feat(stt): add transcribe() with tested OpenAI whisper-1 provider"
```

---

## Task 5: `speak()` — text-to-speech

**Files:**
- Create: `lib/speech.ts`, `lib/speech/openai.ts`, `lib/speech.test.ts`, `lib/speech/openai.test.ts`
- Modify: `lib/index.ts`
- Test: `lib/index.test.ts`

**Interfaces:**
- Produces: named `PcmAudioMetadata`, `SpeechProviderOptions`, `SpeechProviderContext`; `SpeakOptions`, `SpeechResult`, `SpeechProvider`, `registerSpeechProvider`, internal-only `_resetForTests`, `speak`. Allowlist `OPENAI_SPEECH_MODELS = new Set(["tts-1","tts-1-hd"])`; `MAX_TTS_CHARS = 4096`; `MIN_OPENAI_TTS_SPEED = 0.25`; `MAX_OPENAI_TTS_SPEED = 4`.
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
    const input = "😀".repeat(4096) + "a";
    expect(input.length).not.toBe([...input].length);
    const r = await speak(input, { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "sk-x" } });
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
    registerSpeechProvider("boom", {
      speak() {
        throw new Error("x");
      },
    });
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
import { getLogger } from "./util/logger.js";
import { SpeakFormat } from "./util/audioMime.js";
import { openaiSpeak } from "./speech/openai.js";

export type SpeakOptions = {
  model: string; voice: string; provider?: string; modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"]; format?: SpeakFormat; speed?: number;
};
export type PcmAudioMetadata = {
  sampleRateHz: 24000;
  sampleFormat: "s16le";
  channels: 1;
};
export type SpeechResult = {
  audio: Uint8Array; mimeType: string;
  pcm?: PcmAudioMetadata;
  cost?: CostEstimate; raw?: unknown;
};
export type SpeechProviderOptions = Omit<SpeakOptions, "apiKey">;
export type SpeechProviderContext = {
  apiKey: string;
  opts: SpeechProviderOptions;
};
export type SpeechProvider = {
  speak(text: string, ctx: SpeechProviderContext): Promise<Result<SpeechResult>>;
};

export const OPENAI_SPEECH_MODELS = new Set(["tts-1", "tts-1-hd"]);
export const MAX_TTS_CHARS = 4096;
export const MIN_OPENAI_TTS_SPEED = 0.25;
export const MAX_OPENAI_TTS_SPEED = 4;

const registered: Record<string, SpeechProvider> = Object.create(null);
export function registerSpeechProvider(name: string, impl: SpeechProvider): void {
  registered[name] = impl;
}
export function _resetForTests(): void {
  for (const key of Object.keys(registered)) {
    delete registered[key];
  }
}

function providerContext(apiKey: string, opts: SpeakOptions): SpeechProviderContext {
  const { apiKey: _callerKey, ...providerOptions } = opts;
  return { apiKey, opts: providerOptions };
}

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
      if ([...text].length > MAX_TTS_CHARS) {
        return failure(`Input exceeds the ${MAX_TTS_CHARS}-character OpenAI TTS limit.`);
      }
      if (opts.speed !== undefined && (!Number.isFinite(opts.speed) || opts.speed < MIN_OPENAI_TTS_SPEED || opts.speed > MAX_OPENAI_TTS_SPEED)) {
        return failure(`speed must be a finite number in [${MIN_OPENAI_TTS_SPEED}, ${MAX_OPENAI_TTS_SPEED}].`);
      }
      if (!OPENAI_SPEECH_MODELS.has(opts.model)) {
        return failure(`Model "${opts.model}" is not a supported OpenAI speech model in v1 (supported: ${[...OPENAI_SPEECH_MODELS].join(", ")}).`);
      }
      const apiKey = resolveApiKey("openai", opts);
      if (!apiKey) {
        return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
      }
      return await openaiSpeak(text, providerContext(apiKey, opts));
    }

    const custom = registered[provider];
    if (custom) {
      const apiKey = resolveApiKey(provider, opts) ?? "";
      return await custom.speak(text, providerContext(apiKey, opts));
    }
    return failure(`Provider "${provider}" has no speech API. Register one with registerSpeechProvider(name, impl).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "speak() failed";
    const redacted = redactSecret(msg, apiKeyForRedaction);
    getLogger().error("speak() provider failed:", redacted);
    return failure(redacted);
  }
}
```

- [ ] **Step 4: Implement `lib/speech/openai.ts`** (provider-aware pricing; format→MIME; PCM)

```ts
import OpenAI from "openai";
import type { SpeechCreateParams } from "openai/resources/audio/speech";
import { Result, success, failure } from "../types/result.js";
import { getModelForProvider, isTextToSpeechModel } from "../models.js";
import { round } from "../util/util.js";
import { SPEECH_FORMAT_TO_MIME, SpeakFormat } from "../util/audioMime.js";
import type { SpeechProviderContext, SpeechResult } from "../speech.js";

export async function openaiSpeak(
  text: string,
  ctx: SpeechProviderContext,
): Promise<Result<SpeechResult>> {
  const { opts } = ctx;
  // speak() is the single redacting/logging exception boundary.
    const format: SpeakFormat = opts.format ?? "mp3";
    const mimeType = SPEECH_FORMAT_TO_MIME[format];
    if (!mimeType) {
      return failure(`Unknown speech format "${format}".`);
    }

    const client = new OpenAI({ apiKey: ctx.apiKey });
    const res = await client.audio.speech.create({
      model: opts.model,
      voice: opts.voice as SpeechCreateParams["voice"],
      input: text,
      response_format: format,
      ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    });
    const audio = new Uint8Array(await res.arrayBuffer());

    const result: SpeechResult = { audio, mimeType };
    if (format === "pcm") {
      result.pcm = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };
    }

    const model = getModelForProvider("openai", opts.model, opts.modelData);
    if (model && isTextToSpeechModel(model) && model.perCharacterCost) {
      const inputCost = round([...text].length * model.perCharacterCost, 6);
      result.cost = { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
    }
    return success(result);
}
```

- [ ] **Step 5: Write the OpenAI provider test (mock the SDK)**

```ts
// lib/speech/openai.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelDataBlob } from "../modelData.js";

const create = vi.fn();
vi.mock("openai", () => {
  class OpenAI { audio = { speech: { create } }; constructor(_: any) {} }
  return { default: OpenAI };
});
import { openaiSpeak } from "./openai.js";

const md = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "text-to-speech", modelName: "tts-1", provider: "openai", perCharacterCost: 0.00001 }],
} satisfies ModelDataBlob;

beforeEach(() => create.mockReset());
const okResponse = () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

describe("openaiSpeak", () => {
  it("returns bytes + exact MIME and Unicode code-point cost", async () => {
    create.mockResolvedValue(okResponse());
    const input = "a😀b";
    expect(input.length).not.toBe([...input].length);
    const r = await openaiSpeak(input, { apiKey: "sk-x", opts: { model: "tts-1", voice: "alloy", format: "mp3", modelData: md } });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    expect(r.value.mimeType).toBe("audio/mpeg");
    expect(r.value.audio.length).toBe(3);
    expect(r.value.cost?.totalCost).toBeCloseTo(3 * 0.00001, 6);
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
});
```
Expand with the complete TTS matrix: exact SDK `{ model, voice, input, response_format, speed }`; table of all six format/MIME pairs; PCM metadata; astral `a😀b` code-point cost; min/max speed accepted; `NaN`, infinities, below-min, and above-max rejected; 4096 code points accepted and 4097 rejected, including astral input; runtime unknown format; injected model data cannot bypass allowlist; custom provider is not subject to OpenAI limits and receives exact text/resolved-key/options; built-in cannot be overridden; missing key; synchronous and rejected custom-provider errors; rejected SDK promise converted by the public boundary to one redacted/logged `Failure`; and cost omitted without a rate. Every preflight test asserts the specific `Failure.error` and that the SDK/provider spy was not called. Spy on `getLogger().error` for exception cases and assert one redacted log, not the raw key.

- [ ] **Step 6: Export + run**

Use explicit root exports (never `export *`) so `_resetForTests` remains internal and cannot collide:
```ts
export {
  speak,
  registerSpeechProvider,
  OPENAI_SPEECH_MODELS,
  MAX_TTS_CHARS,
  MIN_OPENAI_TTS_SPEED,
  MAX_OPENAI_TTS_SPEED,
} from "./speech.js";
export type {
  SpeakOptions,
  PcmAudioMetadata,
  SpeechResult,
  SpeechProviderOptions,
  SpeechProviderContext,
  SpeechProvider,
} from "./speech.js";
```
Extend `lib/index.test.ts` with compile/runtime coverage for these exports and continued absence of `_resetForTests`.
Run: `pnpm --filter smoltalk test lib/speech.test.ts lib/speech/openai.test.ts` → PASS
Run: `pnpm --filter smoltalk typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/speech.ts lib/speech/openai.ts lib/speech.test.ts lib/speech/openai.test.ts lib/index.ts lib/index.test.ts
git commit -m "feat(tts): add speak() with tested OpenAI tts-1/tts-1-hd provider"
```

---

## Task 6: `AudioPart` type, schema, helper, and full renderer coverage (atomic)

> Merged content-part + renderer work so the union arm and its exhaustive handling land in one green commit.

**Files:**
- Modify: `lib/classes/message/contentParts.ts`, `.../index.ts`, `.../renderers/PartRenderer.ts`, `.../renderers/{OpenAIChatRenderer,JSONRenderer,OpenAIResponsesRenderer,GoogleRenderer,AnthropicRenderer}.ts`, `.../UserMessage.ts`
- Test: `lib/classes/message/audioPart.test.ts`, `lib/classes/message/renderers/audioRender.test.ts`

**Interfaces:**
- Produces: `AudioPart = { type: "audio"; source: BlobRef; filename?: string }`; a file-local `PreparedAudioPart` renderer type with a base64-only source; `AudioPartSchema`; `AudioPart` in `UserContentPart`/`UserContentPartSchema`/`UserContentInput`; options-object `audioPart()` helper; `PartRenderer.audio()`; `renderParts` audio dispatch; `OpenAIChatRenderer.audio()` accepts only prepared audio and emits `{ type: "input_audio", input_audio: { data, format } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/classes/message/audioPart.test.ts
import { describe, it, expect } from "vitest";
import { UserMessage, audioPart, messageFromJSON } from "./index.js";

describe("AudioPart", () => {
  it("builds and round-trips through JSON", () => {
    const source = { kind: "base64" as const, base64: "AQID", mimeType: "audio/wav" };
    const msg = new UserMessage([audioPart(source, { filename: "clip.wav" })]);
    const back = messageFromJSON(JSON.parse(JSON.stringify(msg.toJSON()))) as UserMessage;
    expect(back.getContentParts()![0]).toEqual({ type: "audio", source, filename: "clip.wav" });
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
export function audioPart(source: BlobRef, options: { filename?: string } = {}): AudioPart {
  const part: AudioPart = { type: "audio", source };
  if (options.filename !== undefined) {
    part.filename = options.filename;
  }
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
  const prepared = requirePreparedAudioPart(part);
  const format = chatAudioFormat(prepared.source.mimeType);
  if (!format) {
    throw new Error(`Chat audio supports only mp3/wav; got "${prepared.source.mimeType}".`);
  }
  return {
    type: "input_audio",
    input_audio: { data: prepared.source.base64, format },
  };
}
```
Define one file-local boundary helper and no generic framework:
```ts
type PreparedAudioPart = AudioPart & {
  source: Extract<BlobRef, { kind: "base64" }>;
};

function requirePreparedAudioPart(part: AudioPart): PreparedAudioPart {
  if (part.source.kind !== "base64") {
    throw new Error("internal: audio source must be prepared as base64 before rendering");
  }
  return part as PreparedAudioPart;
}
```
Import `chatAudioFormat` from `../../../util/audioMime.js` and the `BlobRef` type from `../../../util/imageRef.js`. `resolveMessageAttachments` is the only producer of prepared audio; `BaseClient.prepareAttachments` establishes this renderer precondition. Keep defensive tests for unresolved and unsupported direct renderer calls, but public flow must reject before rendering.

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

The tests in this task must additionally prove bytes JSON serialization becomes exact base64, `renderParts` dispatches to `audio` rather than `file`, MP3 and WAV exact wire formats, and defensive unresolved/unsupported renderer behavior. Task 8/9 supplies the public-pipeline non-OpenAI rejection proving those defensive throws are not the user-facing path.

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
  it("converts exact bytes to exact base64", async () => {
    const message = new UserMessage([{ type: "audio", source: {
      kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav",
    }, filename: "clip.wav" }]);
    const r = await resolveMessageAttachments([message], { provider: "openai", maxBytes: 1_000_000 });
    expect(r.success).toBe(true);
    if (!r.success) {
      throw new Error(r.error);
    }
    const part = (r.value[0] as UserMessage).getContentParts()![0];
    expect(part).toEqual({
      type: "audio",
      source: { kind: "base64", base64: "AQID", mimeType: "audio/wav" },
      filename: "clip.wav",
    });
  });
  it("fails during preparation for a non-mp3/wav chat MIME", async () => {
    const r = await resolveMessageAttachments([mk("audio/ogg")], { provider: "openai", maxBytes: 1_000_000 });
    expect(r.success).toBe(false);
  });
});
```
Add three transformation tests using `mkdtemp`/`writeFile` and a restored `globalThis.fetch`: a temp `.wav` (and one `.mp3` alias) without MIME infers exact MIME and base64; a mocked audio URL returns fetched bytes/MIME as base64 and the result contains no URL; base64 remains byte-for-byte unchanged. Add byte-cap rejection with the exact error. Clean the temporary directory and restore fetch in `afterEach`. Task 9 provides the public-pipeline zero-SDK-call assertion.

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Detect audio** in `messagesHaveAttachments`:
```ts
if (part.type === "image" || part.type === "file" || part.type === "audio") {
  return true;
}
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
      source: {
        kind: "base64",
        base64: Buffer.from(data).toString("base64"),
        mimeType,
      },
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
import type { ModelDataBlob } from "../modelData.js";
import type { SmolConfig } from "../types.js";

const audioMsg = new UserMessage([{ type: "audio", source: { kind: "base64", base64: "AAAA", mimeType: "audio/wav" } }]);
const dupMd = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "text", modelName: "dup", provider: "acme", maxInputTokens: 1, maxOutputTokens: 1,
    modalities: { input: ["text", "audio"], output: ["text"] }],
} satisfies ModelDataBlob;

describe("validateModalities — audio", () => {
  it("passes for gpt-audio-1.5 on openai", () => {
    const config = { model: "gpt-audio-1.5", messages: [audioMsg] } satisfies SmolConfig;
    expect(validateModalities(config)).toBeNull();
  });
  it("rejects a text-only model", () => {
    expect(validateModalities({ model: "gpt-4o-mini", messages: [audioMsg] } satisfies SmolConfig)?.success).toBe(false);
  });
  it("rejects an unknown/unannotated model (undefined support is not true)", () => {
    expect(validateModalities({ model: "totally-unknown", provider: "openai", messages: [audioMsg] } satisfies SmolConfig)?.success).toBe(false);
  });
  it("rejects a non-openai provider even if that model declares audio", () => {
    expect(validateModalities({ model: "gemini-3.1-pro-preview", messages: [audioMsg] } satisfies SmolConfig)?.success).toBe(false);
  });
  it("rejects openai-responses with audio", () => {
    expect(validateModalities({ model: "gpt-audio-1.5", provider: "openai-responses", messages: [audioMsg] } satisfies SmolConfig)?.success).toBe(false);
  });
  it("does not inherit audio capability from a same-named non-openai model", () => {
    // "dup" is audio-capable under provider "acme" only; an openai override must not borrow it.
    expect(validateModalities({ model: "dup", provider: "openai", modelData: dupMd, messages: [audioMsg] } satisfies SmolConfig)?.success).toBe(false);
  });
});
```
Add positive custom OpenAI `modelData` opt-in, duplicate-provider conflicting modalities in both directions, mixed text+audio detection, text-only unaffected, image/PDF regression, and unknown non-audio behavior unchanged. Keep existing non-OpenAI negatives. Each negative public-pipeline test in Task 9 must pair the specific error with a zero-call SDK assertion.

- [ ] **Step 2: Run test → FAIL** (no audio arm).

- [ ] **Step 3: Add the provider-aware audio gate**

In `validateModalities`, set `needsAudio` in the scan loop, then before `return null`:
```ts
if (needsAudio) {
  let provider: string;
  try {
    provider = resolveProvider(config.model, config.provider, config.modelData);
  } catch (err) {
    const detail = err instanceof Error ? err.message : `Model ${config.model} is not recognized`;
    return failure(`${detail}; audio input requires an OpenAI audio chat model.`);
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

## Task 9: Public sync/stream audio-in-chat integration

> These tests must call public `textSync()` and fully consume public `textStream()`. Direct `buildRequest`/cost seam tests may remain as unit tests, but must not be described as parity or end-to-end coverage.

**Files:**
- Test: `lib/clients/openai.audioChat.test.ts`

- [ ] **Step 1: Install a complete in-memory OpenAI SDK mock**

```ts
// lib/clients/openai.audioChat.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { textStream, textSync } from "../functions.js";
import { audioPart, userMessage } from "../classes/message/index.js";
import type { ModelDataBlob } from "../modelData.js";
import type { SmolConfig, StreamChunk } from "../types.js";

const create = vi.fn();
vi.mock("openai", () => {
  class FakeOpenAI {
    chat = { completions: { create } };
  }
  return { default: FakeOpenAI };
});

const audioMd = { schemaVersion: 1, generatedAt: "t", hostedTools: [],
  models: [{ type: "text", modelName: "gpt-audio-1.5", provider: "openai",
    maxInputTokens: 128000, maxOutputTokens: 16384,
    modalities: { input: ["text", "audio"], output: ["text", "audio"] },
    inputTokenCost: 2.5, outputTokenCost: 10, inputAudioTokenCost: 32, outputAudioTokenCost: 64 }],
} satisfies ModelDataBlob;

const usage = {
  prompt_tokens: 2_000_000,
  prompt_tokens_details: { audio_tokens: 1_000_000 },
  completion_tokens: 2_000_000,
  completion_tokens_details: { audio_tokens: 1_000_000 },
  total_tokens: 4_000_000,
};
const config = {
  model: "gpt-audio-1.5",
  provider: "openai",
  modelData: audioMd,
  apiKey: { openAi: "test-key" },
  messages: [userMessage(["describe", audioPart({
    kind: "bytes", data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav",
  })])],
} satisfies SmolConfig;

function syncResponse() {
  return {
    data: { choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage },
    response: new Response(null, { status: 200 }),
  };
}

async function* streamResponse() {
  yield { choices: [{ delta: { content: "ok" }, finish_reason: null }] };
  yield { choices: [{ delta: {}, finish_reason: "stop" }], usage };
}

describe("audio-in-chat", () => {
  beforeEach(() => create.mockReset());

  it("sends exact input_audio and gives identical four-bucket sync/stream usage and cost", async () => {
    create.mockReturnValueOnce({ withResponse: async () => syncResponse() });
    const sync = await textSync(config);
    expect(sync.success).toBe(true);
    expect(create.mock.calls[0][0].messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "input_audio", input_audio: { data: "AQID", format: "wav" } },
    ]);

    create.mockResolvedValueOnce(streamResponse());
    const chunks: StreamChunk[] = [];
    for await (const chunk of textStream(config)) {
      chunks.push(chunk);
    }
    expect(create.mock.calls[1][0]).toMatchObject({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "describe" },
          { type: "input_audio", input_audio: { data: "AQID", format: "wav" } },
        ],
      }],
      stream: true,
      stream_options: { include_usage: true },
    });
    const done = chunks.find((chunk) => chunk.type === "done");
    expect(done?.type).toBe("done");
    if (!sync.success || done?.type !== "done") {
      throw new Error("expected successful sync and stream results");
    }
    expect(done.result.usage).toEqual(sync.value.usage);
    expect(done.result.cost).toEqual(sync.value.cost);
    expect(sync.value.usage).toMatchObject({
      inputTokens: 1_000_000, inputAudioTokens: 1_000_000,
      outputTokens: 1_000_000, outputAudioTokens: 1_000_000,
    });
    expect(sync.value.cost).toMatchObject({ inputCost: 34.5, outputCost: 74, totalCost: 108.5 });
  });
});
```

Use the exact `.withResponse()` and stream iterator shapes consumed by the installed `openai.ts`; this is a complete mock, not a real network request. Add rejection tests for the new preflight contract: invalid model through `textSync()` returns a specific `Failure`; OGG through consumed `textStream()` yields exactly one `error` and no `done`; and `create` is not called in either case. Do not change or re-specify the pre-existing text client's SDK-exception behavior as part of this feature. Add successful MP3 path and mocked WAV URL public-pipeline cases (bytes is covered above), asserting fetched/path bytes become base64 and URLs never reach the request. Restore fetch and temp directories.

Also exercise public non-OpenAI/provider-capability failures from Task 8. For unknown/text-only models that are meant to reach `validateModalities()`, set `provider: "openai"` and provide a key; assert the exact returned `Failure` and zero OpenAI SDK calls. Preserve the existing behavior for a wholly unknown model without an explicit provider (client construction rejects before attachment preparation) rather than changing that contract.

For a custom text provider, register a minimal fake `BaseClient` through `registerProvider()` and clean it up with `unregisterProvider()`. Give it `_textSync` and `_textStream` dispatch spies, pass an audio message, and assert the public provider-gate error while both custom dispatch spies and the OpenAI `create` spy remain untouched. Repeat the zero-dispatch assertion for the conflicting duplicate-name case. This establishes rejection before both the defensive renderer and provider execution.

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
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Document the feature**

Add a README "Audio (STT/TTS)" section: minimal `transcribe()`, `speak()`, and audio-in-chat (`audioPart` on `gpt-audio-1.5`) examples; the OpenAI-only v1 scope + model allowlists; that returned audio bytes are caller-owned; and that `AudioPart` audio must be mp3/wav.

- [ ] **Step 2: Update the changelog**

Open `CHANGELOG.md`, match its existing format/heading style, and add an entry describing STT/TTS/audio-in-chat. (Do not rely on a changelog skill; follow the file's own format.)

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document audio STT/TTS and audio-in-chat"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** STT (Task 4), TTS (Task 5), AudioPart/preparation/rendering (Tasks 6–8), four-bucket audio cost (Task 2 plus public parity in Task 9), exact registry data (Task 1), all MIME surfaces (Task 3), allowlists/custom dispatch (Tasks 4/5), provider-aware positive validation (Task 8), exception/redaction/logging boundary (Tasks 4/5), public sync/stream integration (Task 9), and docs (Task 10). All approved v1 sections map to an independently green task.
- **Review/audit findings addressed:** provider-aware `Model.calculateCost` and OpenAI construction (T2); explicit root exports keeping both reset helpers private (T4/T5); valid throw-test syntax (T4/T5); genuine public sync/consumed-stream tests with SDK spy (T9); package-relative paths and seed staging (T1/T10); typed fixtures (all tasks); total transcription MIME lookup (T3/T4); prepared-audio renderer boundary and options-object helper (T6/T7); symmetric, small STT/TTS modules without a generic dispatcher (T4/T5); named nested/context types (T4/T5); single redacted logger boundary (T4/T5); named speed/token constants (T2/T5); and mutation-sensitive matrices for registry, cost, MIME, STT, TTS, attachments, modality, AudioPart, and public chat.
- **Deferred (spec Non-goals), intentionally absent:** streaming STT/TTS, token-priced GPT dedicated endpoint models, non-OpenAI providers, assistant audio output, translation, SSRF guard, voice discovery.
- **Type consistency:** provider contexts carry one resolved key plus exact options; `AudioPart.source` is `BlobRef` while internal `PreparedAudioPart.source` is base64; `transcriptionAudioType` is total; `getModelForProvider` is used consistently by capability, modality, and pricing paths. Test fixtures use `satisfies`/explicit types even though package typecheck excludes tests.
- **Implementer verification points:** verify exact current prices via `update-models` (T1), installed `toFile` and speech-resource import paths (T4/T5), and installed SDK sync/stream mock shapes (T9). These are explicit verification steps, not scope expansion.
