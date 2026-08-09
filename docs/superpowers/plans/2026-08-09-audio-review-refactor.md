# Audio PR #36 Review Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all open review comments on PR #36 by moving STT/TTS to the class-based provider pattern (mirroring `BaseClient`), making validation model-data-driven, and cleaning up file responsibilities.

**Architecture:** `transcribe()`/`speak()` stay the declarative public entry points and become thin wrappers over internal client factories that instantiate `BaseTranscriptionClient`/`BaseSpeechClient` subclasses. Base classes own everything shared (runtime validation of declarative model constraints, blob loading, cost, and the redaction boundary); subclasses own only SDK calls and response mapping. Provider constraints live in model data, MIME aliases live only in `AUDIO_FORMATS`, and attachment support lives in non-contradictory per-client capability declarations.

**Tech Stack:** TypeScript strict ESM (`.js` import extensions), vitest, pnpm, `openai` SDK.

## Global Constraints

- Run everything from `packages/smoltalk/`. Tests: `pnpm test` (vitest). Typecheck: `pnpm typecheck`.
- **No ternaries, no conditional spreads** — user explicitly requires explicit `if` statements (PR #14 feedback). Plain object spread (`{ ...opts }`) is fine.
- All fallible operations return `Result<T>` (`success(v)` / `failure(msg)` from `lib/types/result.js`), never throw across public boundaries.
- Internal imports use `.js` extensions (ESM).
- Breaking changes to the public API are explicitly allowed (package has no users). The PR branch is `audio-stt-tts`; commit directly to it.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Registering a provider named after a built-in (e.g. `"openai"`) must **not** override the built-in — an existing test pins this.
- `_resetForTests()` helpers stay exported from modules but off the public `lib/index.ts` surface.

---

### Task 1: Revert CHANGELOG.md

Reviewer instruction: "undo all changelog changes."

**Files:**
- Modify: `CHANGELOG.md` (restore to main's version)

- [ ] **Step 1: Restore the file from main**

```bash
git checkout main -- CHANGELOG.md
```

- [ ] **Step 2: Verify only the Unreleased block disappeared**

Run: `git diff main -- CHANGELOG.md`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: revert changelog changes per review"
```

---

### Task 2: Consolidate MIME knowledge into `lib/util/mime.ts`; rename `imageRef.ts` → `blobRef.ts`

Addresses: "Why do we have audio data inside a file that has to do with images? And isn't this code duplication with audioMime.ts?" — `imageRef.ts` has an ext→MIME table including audio, while `audioMime.ts` hand-maintains the inverse MIME→ext table. Single-source both from one `AUDIO_FORMATS` table. The file stopped being image-specific when Files API added `BlobRef`/`loadBlob`, so rename it.

**Files:**
- Create: `lib/util/mime.ts`
- Create: `lib/util/mime.test.ts`
- Rename: `lib/util/imageRef.ts` → `lib/util/blobRef.ts` (via `git mv`)
- Rename: `lib/util/imageRef.test.ts` → `lib/util/blobRef.test.ts` (via `git mv`)
- Modify: `lib/util/audioMime.ts` (derive lookups from `mime.ts`)
- Modify importers of `./util/imageRef.js`: `lib/classes/message/contentParts.ts`, `lib/classes/message/index.ts`, `lib/clients/resolveAttachments.ts`, `lib/files.ts`, `lib/image.ts`, `lib/image/google.ts`, `lib/image/openai.ts`, `lib/index.ts`, `lib/transcription.ts`, `lib/util/attachments.ts`
- Modify: `lib/index.test.ts` (its "exports builders and normalizeImageRef" test at line 10 asserts `smoltalk.normalizeImageRef` — update to `normalizeBlob`)
- Test: `lib/util/mime.test.ts`, `lib/util/audioMime.test.ts` (existing, should keep passing), `lib/util/blobRef.test.ts`, `lib/index.test.ts`

**Interfaces:**
- Produces: `AUDIO_FORMATS: readonly AudioFormat[]`, `EXT_TO_MIME: Record<string, string>`, `canonicalizeMime(mime: string): string`, `audioFormatForMime(mime: string): AudioFormat | null` from `lib/util/mime.js`.
- Produces: `BlobRef` (primary type, replaces `ImageRef`), `ImageRef` (alias, kept for image call-site readability), `normalizeBlob(ref, opts)` (renamed from `normalizeImageRef`), `loadBlob(ref, opts)` from `lib/util/blobRef.js`.
- Later tasks import `canonicalizeMime` from `mime.js` and `BlobRef`/`loadBlob` from `blobRef.js`.

- [ ] **Step 1: Write failing tests for the new mime module**

Create `lib/util/mime.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AUDIO_FORMATS, EXT_TO_MIME, canonicalizeMime, audioFormatForMime } from "./mime.js";

describe("canonicalizeMime", () => {
  it("strips codec parameters and lowercases", () => {
    expect(canonicalizeMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(canonicalizeMime("AUDIO/WAV; codecs=1")).toBe("audio/wav");
  });
});

describe("audioFormatForMime", () => {
  it("matches canonical MIME types", () => {
    expect(audioFormatForMime("audio/mpeg")?.extension).toBe("mp3");
    expect(audioFormatForMime("audio/flac")?.extension).toBe("flac");
  });
  it("matches alias MIME types", () => {
    expect(audioFormatForMime("audio/mp3")?.extension).toBe("mp3");
    expect(audioFormatForMime("audio/x-wav")?.extension).toBe("wav");
    expect(audioFormatForMime("video/mp4")?.extension).toBe("mp4");
  });
  it("matches through codec parameters", () => {
    expect(audioFormatForMime("audio/webm;codecs=opus")?.extension).toBe("webm");
  });
  it("returns null for non-audio MIME types", () => {
    expect(audioFormatForMime("image/png")).toBeNull();
  });
});

describe("EXT_TO_MIME", () => {
  it("contains image, pdf, and derived audio entries", () => {
    expect(EXT_TO_MIME[".png"]).toBe("image/png");
    expect(EXT_TO_MIME[".pdf"]).toBe("application/pdf");
    expect(EXT_TO_MIME[".mp3"]).toBe("audio/mpeg");
    expect(EXT_TO_MIME[".mpga"]).toBe("audio/mpeg");
    expect(EXT_TO_MIME[".webm"]).toBe("audio/webm");
  });
  it("derives every audio extension from AUDIO_FORMATS (no drift)", () => {
    for (const format of AUDIO_FORMATS) {
      expect(EXT_TO_MIME[`.${format.extension}`]).toBe(format.mimeType);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/util/mime.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `lib/util/mime.ts`**

```typescript
/**
 * Shared extension/MIME knowledge for attachments and audio. One table per
 * format; every other ext↔MIME mapping in the package derives from these so
 * the forward and inverse maps can't drift apart.
 */

export type AudioFormat = {
  /** Primary file extension, without the dot. */
  extension: string;
  /** Canonical MIME type. */
  mimeType: string;
  /** Other MIME strings that identify the same container. */
  aliasMimeTypes: readonly string[];
  /** Other extensions that map to this format. */
  aliasExtensions: readonly string[];
};

export const AUDIO_FORMATS: readonly AudioFormat[] = [
  { extension: "mp3", mimeType: "audio/mpeg", aliasMimeTypes: ["audio/mp3"], aliasExtensions: ["mpeg", "mpga"] },
  { extension: "wav", mimeType: "audio/wav", aliasMimeTypes: ["audio/x-wav"], aliasExtensions: [] },
  { extension: "m4a", mimeType: "audio/m4a", aliasMimeTypes: ["audio/x-m4a"], aliasExtensions: [] },
  { extension: "mp4", mimeType: "audio/mp4", aliasMimeTypes: ["video/mp4"], aliasExtensions: [] },
  { extension: "ogg", mimeType: "audio/ogg", aliasMimeTypes: [], aliasExtensions: [] },
  { extension: "flac", mimeType: "audio/flac", aliasMimeTypes: [], aliasExtensions: [] },
  { extension: "webm", mimeType: "audio/webm", aliasMimeTypes: [], aliasExtensions: [] },
];

const IMAGE_AND_DOCUMENT_EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function buildExtToMime(): Record<string, string> {
  const table: Record<string, string> = { ...IMAGE_AND_DOCUMENT_EXT_TO_MIME };
  for (const format of AUDIO_FORMATS) {
    table[`.${format.extension}`] = format.mimeType;
    for (const alias of format.aliasExtensions) {
      table[`.${alias}`] = format.mimeType;
    }
  }
  return table;
}

/** Extension (with leading dot, lowercase) → MIME, across images, PDF, and audio. */
export const EXT_TO_MIME: Record<string, string> = buildExtToMime();

// Strips parameters (e.g. ";codecs=opus") and normalizes case, so MediaRecorder-
// style MIME strings like "audio/webm;codecs=opus" or "AUDIO/MPEG" still match.
export function canonicalizeMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

/** The audio format a MIME string identifies, or null when unrecognized. */
export function audioFormatForMime(mime: string): AudioFormat | null {
  const canonical = canonicalizeMime(mime);
  for (const format of AUDIO_FORMATS) {
    if (format.mimeType === canonical) {
      return format;
    }
    if (format.aliasMimeTypes.includes(canonical)) {
      return format;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run mime tests**

Run: `pnpm vitest run lib/util/mime.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `lib/util/audioMime.ts` on top of `mime.ts`**

Delete `TRANSCRIBE_MIME_TO_EXT` and the local `canonicalizeMime`. New content:

```typescript
import { audioFormatForMime } from "./mime.js";

export type SpeakFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

export type TranscriptionAudioType = {
  extension: string;
  filename: string;
};

export function transcriptionAudioType(mime: string): TranscriptionAudioType | null {
  const format = audioFormatForMime(mime);
  if (format === null) {
    return null;
  }
  return { extension: format.extension, filename: `audio.${format.extension}` };
}

export function chatAudioFormat(mime: string): "mp3" | "wav" | null {
  const format = audioFormatForMime(mime);
  if (format === null) {
    return null;
  }
  if (format.extension === "mp3" || format.extension === "wav") {
    return format.extension;
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

- [ ] **Step 6: Run existing audioMime tests to confirm behavior is unchanged**

Run: `pnpm vitest run lib/util/audioMime.test.ts`
Expected: PASS (the existing tests cover `;codecs=` variants, uppercase, `video/mp4`, aliases).

- [ ] **Step 7: Rename `imageRef.ts` → `blobRef.ts` and de-image its names**

```bash
git mv lib/util/imageRef.ts lib/util/blobRef.ts
git mv lib/util/imageRef.test.ts lib/util/blobRef.test.ts
```

In `lib/util/blobRef.ts`:
- Make `BlobRef` the primary union type; keep `export type ImageRef = BlobRef;` as an alias (image call sites read better with it, and it documents intent).
- Rename `normalizeImageRef` → `normalizeBlob`, `NormalizedImage` → `NormalizedBlob`.
- Delete the local `EXT_TO_MIME` table; `import { EXT_TO_MIME } from "./mime.js";` instead. The `loadRef` path-case lookup is unchanged.
- Doc comment on `normalizeBlob`: same body as before, it is a rename only.

- [ ] **Step 8: Update every importer**

Mechanical: in `lib/classes/message/contentParts.ts`, `lib/classes/message/index.ts`, `lib/clients/resolveAttachments.ts`, `lib/files.ts`, `lib/image.ts`, `lib/image/google.ts`, `lib/image/openai.ts`, `lib/index.ts`, `lib/transcription.ts`, `lib/util/attachments.ts`:
- `from "./util/imageRef.js"` (and relative variants) → `.../blobRef.js`
- `normalizeImageRef(` → `normalizeBlob(`
- In `lib/index.ts` export the new names: `export { normalizeBlob, loadBlob } from "./util/blobRef.js";` and `export type { BlobRef, ImageRef } from "./util/blobRef.js";`

Also update test-file imports (`grep -rl "imageRef" lib` to catch stragglers, including `lib/util/blobRef.test.ts` itself and any renderer/files tests importing `normalizeImageRef`). In `lib/index.test.ts`, change the `expect(typeof smoltalk.normalizeImageRef).toBe("function")` assertion to `normalizeBlob` — do this here, not in the final sweep, so this task's checkpoint is honestly green.

- [ ] **Step 9: Move the audio-extension tests out of the blobRef test file**

The `describe("EXT_TO_MIME: audio extension inference")` block at the bottom of `lib/util/blobRef.test.ts` duplicates what `mime.test.ts` now covers at the table level. Keep exactly one behavioral test in `blobRef.test.ts` proving path-based loading still infers audio MIME through the shared table (the `.WAV` uppercase case), and delete the 9-case parametrized block (table-level coverage lives in `mime.test.ts`).

- [ ] **Step 10: Typecheck + full test run**

Run: `pnpm typecheck && pnpm vitest run`
Expected: clean typecheck; all tests pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: single-source MIME tables in util/mime.ts; rename imageRef to blobRef"
```

---

### Task 3: Split `resolveMessageAttachments` into per-part resolvers

Addresses: "This function is already quite long… re-factor this function into different subfunctions that all handle the different types in different ways." Pure refactor — the existing tests (`resolveAttachments.audio.test.ts` and friends) must pass unchanged. (Task 7 later threads a per-client `audioFormats` policy through `ResolveOptions`; here the mp3/wav check stays hardcoded so this task remains behavior-preserving.)

**Files:**
- Modify: `lib/clients/resolveAttachments.ts`
- Test: existing `lib/clients/resolveAttachments.audio.test.ts` + other attachment tests (no new tests; behavior identical)

**Interfaces:**
- Consumes: `normalizeBlob`, `BlobRef` from Task 2; `chatAudioFormat` from `util/audioMime.js`.
- Produces: `resolveMessageAttachments(messages, options)` — signature unchanged. Internal (non-exported): `resolveUserPart`, `resolveAudioPart`, `resolveImagePart`, `resolveFilePart`, each `(part, options: ResolveOptions) => Promise<Result<UserContentPart>>` with `type ResolveOptions = { provider: string; maxBytes: number }`.

- [ ] **Step 1: Refactor**

Replace the body of the per-part `for` loop with a dispatcher call; extract helpers. Target shape (imports of `AudioPart`/`ImagePart`/`FilePart` come from `../classes/message/contentParts.js`):

```typescript
type ResolveOptions = { provider: string; maxBytes: number };

/** Load a ref to inline base64, gated to `allowed` MIME prefixes. Throws on failure. */
async function toBase64Source(
  source: BlobRef,
  allowed: string[],
  maxBytes: number,
): Promise<{ kind: "base64"; base64: string; mimeType: string }> {
  const { data, mimeType } = await normalizeBlob(source, {
    allowedMimePrefixes: allowed,
    maxBytes,
  });
  return { kind: "base64", base64: Buffer.from(data).toString("base64"), mimeType };
}

/** Error message when a providerFile ref targets the wrong provider family, else null. */
function providerFileError(fileProvider: string, targetProvider: string): string | null {
  const family = fileFamily(targetProvider);
  if (family === null || fileProvider !== family) {
    return (
      `Attachment references a "${fileProvider}" file, but this call targets provider ` +
      `"${targetProvider}" (file family ${family ?? "none"}).`
    );
  }
  return null;
}

// Audio has no providerFile/URL passthrough: Chat input_audio requires
// inline base64, so every audio source is normalized here.
async function resolveAudioPart(part: AudioPart, options: ResolveOptions): Promise<Result<UserContentPart>> {
  try {
    const source = await toBase64Source(part.source, ["audio/"], options.maxBytes);
    if (chatAudioFormat(source.mimeType) === null) {
      return failure(`Chat audio input supports only mp3/wav; got "${source.mimeType}".`);
    }
    const resolved: UserContentPart = { type: "audio", source };
    if (part.filename !== undefined) {
      resolved.filename = part.filename;
    }
    return success(resolved);
  } catch (err) {
    return failure(`Failed to load audio attachment: ${(err as Error).message}`);
  }
}

async function resolveImagePart(part: ImagePart, options: ResolveOptions): Promise<Result<UserContentPart>> {
  if (part.source.kind === "providerFile") {
    const mismatch = providerFileError(part.source.provider, options.provider);
    if (mismatch !== null) {
      return failure(mismatch);
    }
    if (options.provider === "openai") {
      return failure(
        "An image file reference requires the openai-responses provider (OpenAI Chat Completions has no image-by-file_id form).",
      );
    }
    return success(part);
  }
  if (part.source.kind === "url" && acceptsRemoteUrl(options.provider, "image")) {
    return success(part);
  }
  try {
    const source = await toBase64Source(part.source, ["image/"], options.maxBytes);
    return success({ type: "image", source });
  } catch (err) {
    return failure(`Failed to load image attachment: ${(err as Error).message}`);
  }
}

async function resolveFilePart(part: FilePart, options: ResolveOptions): Promise<Result<UserContentPart>> {
  if (part.source.kind === "providerFile") {
    const mismatch = providerFileError(part.source.provider, options.provider);
    if (mismatch !== null) {
      return failure(mismatch);
    }
    return success(part);
  }
  if (part.source.kind === "url" && acceptsRemoteUrl(options.provider, "file")) {
    return success(part);
  }
  try {
    const source = await toBase64Source(part.source, ["application/pdf"], options.maxBytes);
    return success({ type: "file", source, filename: part.filename });
  } catch (err) {
    return failure(`Failed to load file attachment: ${(err as Error).message}`);
  }
}

async function resolveUserPart(part: UserContentPart, options: ResolveOptions): Promise<Result<UserContentPart>> {
  if (part.type === "text") {
    return success(part);
  }
  if (part.type === "audio") {
    return resolveAudioPart(part, options);
  }
  if (part.type === "image") {
    return resolveImagePart(part, options);
  }
  return resolveFilePart(part, options);
}
```

`resolveMessageAttachments` keeps its message loop and becomes:

```typescript
export async function resolveMessageAttachments(
  messages: Message[],
  options: ResolveOptions,
): Promise<Result<Message[]>> {
  const out: Message[] = [];
  for (const msg of messages) {
    if (!(msg instanceof UserMessage)) {
      out.push(msg);
      continue;
    }
    const parts = msg.getContentParts();
    if (parts === null) {
      out.push(msg);
      continue;
    }
    const resolvedParts: UserContentPart[] = [];
    for (const part of parts) {
      const resolved = await resolveUserPart(part, options);
      if (!resolved.success) {
        return resolved;
      }
      resolvedParts.push(resolved.value);
    }
    out.push(new UserMessage(resolvedParts, { name: msg.name, rawData: msg.rawData }));
  }
  return success(out);
}
```

Behavior notes (must not change): the old code's error message for a failed PDF load was `Failed to load file attachment:` via `${part.type}` interpolation — the new literal strings must match what tests assert (check `resolveAttachments` tests; the old interpolation produced `"file"` and `"image"` exactly as the literals above).

- [ ] **Step 2: Run the attachment tests**

Run: `pnpm vitest run lib/clients/resolveAttachments.audio.test.ts && pnpm vitest run -t attachment`
Then the full suite: `pnpm vitest run`
Expected: PASS, no behavior change.

- [ ] **Step 3: Commit**

```bash
git add lib/clients/resolveAttachments.ts
git commit -m "refactor: split resolveMessageAttachments into per-part resolvers"
```

---

### Task 4: Move audio model constraints into the registry; add cost helpers to `model.ts`

Addresses: "So much logic hardcoded to OpenAI… each model has a data block that defines things like the max input and output tokens. That would be a better way to do this, keeping the model and the logic for validating it separate."

**Files:**
- Modify: `lib/models.ts` (extend `SpeechToTextModel`/`TextToSpeechModel` types + `whisper-1`/`tts-1`/`tts-1-hd` entries)
- Modify: `lib/model.ts` (add `calculateTranscriptionCost`/`calculateSpeechCost`)
- Regenerate: `data/model-data.json` (the committed catalog has whisper-1/tts-1/tts-1-hd entries around line 2113 that carry only pricing today — they must pick up the new constraint fields or the refreshed catalog will disagree with the baked-in registry)
- Modify if needed: `scripts/seed-model-data.ts` (check whether it copies whole model objects — if so regeneration alone suffices; if it cherry-picks fields, add the new ones)
- Test: `lib/models.audio.test.ts` (extend), `lib/model.audioCost.test.ts` (extend), `tests/seed-model-data.test.ts` (parity assertion)

**Interfaces:**
- Produces (types in `models.ts`):

```typescript
export type SpeechToTextModel = BaseModel & {
  type: "speech-to-text";
  perMinuteCost?: number;
  /** Canonical MIME types accepted after alias normalization through AUDIO_FORMATS. */
  supportedMimeTypes?: readonly string[];
  /** Provider upload cap in bytes. */
  maxBytes?: number;
};

export type TextToSpeechModel = BaseModel & {
  type: "text-to-speech";
  perCharacterCost?: number; // USD per input Unicode code point
  /** Input cap in Unicode code points. */
  maxInputChars?: number;
  /** Accepted values for the speed option. */
  speedRange?: { min: number; max: number };
  /** Output formats the provider can render for this model. */
  formats?: readonly string[];
};
```

- Produces (functions in `model.ts`):

```typescript
export function calculateTranscriptionCost(
  model: ModelType | undefined,
  durationSeconds: number | undefined,
): CostEstimate | undefined;

export function calculateSpeechCost(
  model: ModelType | undefined,
  charCount: number,
): CostEstimate | undefined;
```

- Tasks 5 and 6 consume both.

- [ ] **Step 1: Write failing tests**

`lib/models.audio.test.ts` already imports `getModelForProvider`, `isSpeechToTextModel`, and `isTextToSpeechModel`; append only the new `describe` block (do not add duplicate imports):

```typescript
describe("audio model constraint data", () => {
  // Throw (don't just skip assertions) when the guard fails, so a wrong type
  // or missing entry fails the test instead of silently passing it.
  it("whisper-1 declares its MIME allowlist and 25MB cap", () => {
    const model = getModelForProvider("openai", "whisper-1");
    if (model === undefined || !isSpeechToTextModel(model)) {
      throw new Error("expected a speech-to-text registry entry for openai:whisper-1");
    }
    expect(model.supportedMimeTypes).toContain("audio/mpeg");
    expect(model.supportedMimeTypes).toContain("audio/mp4");
    expect(model.supportedMimeTypes).not.toContain("video/mp4");
    expect(model.maxBytes).toBe(25 * 1024 * 1024);
  });

  it("tts-1 declares char cap, speed range, and formats", () => {
    const model = getModelForProvider("openai", "tts-1");
    if (model === undefined || !isTextToSpeechModel(model)) {
      throw new Error("expected a text-to-speech registry entry for openai:tts-1");
    }
    expect(model.maxInputChars).toBe(4096);
    expect(model.speedRange).toEqual({ min: 0.25, max: 4 });
    expect(model.formats).toEqual(["mp3", "opus", "aac", "flac", "wav", "pcm"]);
  });
});
```

Append to `lib/model.audioCost.test.ts`:

```typescript
import { calculateTranscriptionCost, calculateSpeechCost } from "./model.js";

describe("calculateTranscriptionCost", () => {
  const model = { type: "speech-to-text", modelName: "m", provider: "p", perMinuteCost: 0.006 } as const;
  it("prices by the minute", () => {
    expect(calculateTranscriptionCost(model, 120)).toEqual({
      inputCost: 0.012, outputCost: 0, totalCost: 0.012, currency: "USD",
    });
  });
  it("reports a present zero cost for a 0 rate", () => {
    const free = { ...model, perMinuteCost: 0 };
    expect(calculateTranscriptionCost(free, 120)).toEqual({
      inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD",
    });
  });
  it("returns undefined without a rate, a duration, or a model", () => {
    expect(calculateTranscriptionCost({ ...model, perMinuteCost: undefined }, 120)).toBeUndefined();
    expect(calculateTranscriptionCost(model, undefined)).toBeUndefined();
    expect(calculateTranscriptionCost(undefined, 120)).toBeUndefined();
  });
});

describe("calculateSpeechCost", () => {
  const model = { type: "text-to-speech", modelName: "m", provider: "p", perCharacterCost: 0.000015 } as const;
  it("prices per code point", () => {
    expect(calculateSpeechCost(model, 1000)).toEqual({
      inputCost: 0.015, outputCost: 0, totalCost: 0.015, currency: "USD",
    });
  });
  it("returns undefined for a non-TTS model or missing rate", () => {
    expect(calculateSpeechCost(undefined, 10)).toBeUndefined();
    expect(calculateSpeechCost({ ...model, perCharacterCost: undefined }, 10)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/models.audio.test.ts lib/model.audioCost.test.ts`
Expected: FAIL (missing fields / missing exports).

- [ ] **Step 3: Implement**

In `lib/models.ts`: extend the two type definitions as shown in Interfaces, then the entries:

```typescript
export const speechToTextModels = [
  {
    type: "speech-to-text",
    modelName: "whisper-1",
    perMinuteCost: 0.006,
    provider: "openai",
    supportedMimeTypes: [
      "audio/flac", "audio/mpeg", "audio/mp4", "audio/m4a", "audio/ogg",
      "audio/wav", "audio/webm",
    ],
    maxBytes: 25 * 1024 * 1024,
  },
] as const;

export const textToSpeechModels = [
  {
    type: "text-to-speech",
    modelName: "tts-1",
    perCharacterCost: 0.000015,
    provider: "openai",
    maxInputChars: 4096,
    speedRange: { min: 0.25, max: 4 },
    formats: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
  },
  {
    type: "text-to-speech",
    modelName: "tts-1-hd",
    perCharacterCost: 0.00003,
    provider: "openai",
    maxInputChars: 4096,
    speedRange: { min: 0.25, max: 4 },
    formats: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
  },
] as const;
```

In `lib/model.ts` (imports: `isSpeechToTextModel`, `isTextToSpeechModel`, `ModelType` from `./models.js`; `CostEstimate` from `./types/costEstimate.js`; `round` already imported):

```typescript
/**
 * Per-minute STT pricing from a registry entry. Returns undefined (cost
 * omitted, no error) when the model, rate, or duration is unknown — a rate of
 * 0 still yields a present zero cost.
 */
export function calculateTranscriptionCost(
  model: ModelType | undefined,
  durationSeconds: number | undefined,
): CostEstimate | undefined {
  if (model === undefined || !isSpeechToTextModel(model)) {
    return undefined;
  }
  if (model.perMinuteCost === undefined || durationSeconds === undefined || durationSeconds === null) {
    return undefined;
  }
  const inputCost = round((durationSeconds / 60) * model.perMinuteCost, 6);
  return { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
}

/** Per-code-point TTS pricing from a registry entry; same omission semantics. */
export function calculateSpeechCost(
  model: ModelType | undefined,
  charCount: number,
): CostEstimate | undefined {
  if (model === undefined || !isTextToSpeechModel(model)) {
    return undefined;
  }
  if (model.perCharacterCost === undefined) {
    return undefined;
  }
  const inputCost = round(charCount * model.perCharacterCost, 6);
  return { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
}
```

Check `CostEstimate`'s exact field names in `lib/types/costEstimate.ts` before writing; match them.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run lib/models.audio.test.ts lib/model.audioCost.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Regenerate `data/model-data.json` and add a parity test**

Find the generation command: read `package.json` scripts and `scripts/seed-model-data.ts` (likely `pnpm tsx scripts/seed-model-data.ts` or a named script). Regenerate the file, then confirm the committed whisper-1/tts-1/tts-1-hd entries now carry `supportedMimeTypes`/`maxBytes`/`maxInputChars`/`speedRange`/`formats`.

Add to `tests/seed-model-data.test.ts` a parity assertion against the **committed JSON file** (not just the in-memory seed builder — an in-memory-only test cannot detect a stale generated file). Add the `node:fs` import and compare every new constraint to the corresponding baked registry entry rather than repeating literals:

```typescript
import { readFileSync } from "node:fs";
import { getModelForProvider } from "../lib/models.js";

it("committed model-data.json carries the audio constraint fields from the baked registry", () => {
  const blob = JSON.parse(readFileSync(new URL("../data/model-data.json", import.meta.url), "utf8"));
  const committedWhisper = blob.models.find(
    (m: { modelName: string; provider: string }) => m.modelName === "whisper-1" && m.provider === "openai",
  );
  const bakedWhisper = getModelForProvider("openai", "whisper-1");
  if (committedWhisper === undefined || bakedWhisper?.type !== "speech-to-text") {
    throw new Error("missing committed or baked openai:whisper-1");
  }
  expect(committedWhisper.maxBytes).toBe(bakedWhisper.maxBytes);
  expect(committedWhisper.supportedMimeTypes).toEqual(bakedWhisper.supportedMimeTypes);

  for (const modelName of ["tts-1", "tts-1-hd"]) {
    const committed = blob.models.find(
      (m: { modelName: string; provider: string }) => m.modelName === modelName && m.provider === "openai",
    );
    const baked = getModelForProvider("openai", modelName);
    if (committed === undefined || baked?.type !== "text-to-speech") {
      throw new Error(`missing committed or baked openai:${modelName}`);
    }
    expect(committed.maxInputChars).toBe(baked.maxInputChars);
    expect(committed.speedRange).toEqual(baked.speedRange);
    expect(committed.formats).toEqual(baked.formats);
  }
});
```

The file uses the `ModelDataBlob` envelope, so `blob.models` is the correct access path. Ignore generated timestamp fields.

Run: `pnpm vitest run tests/seed-model-data.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/models.ts lib/model.ts lib/models.audio.test.ts lib/model.audioCost.test.ts data/model-data.json scripts/seed-model-data.ts tests/seed-model-data.test.ts
git commit -m "feat: move audio model constraints into registry; add STT/TTS cost helpers"
```

---

### Task 5: `BaseTranscriptionClient` + OpenAI subclass + factory-based `transcription.ts`

Addresses: the class-based provider pattern ("move shared functionality into a base class"), "ignored existing patterns" for model data/request/cost, and "everything is hardcoded to openai" in `transcription.ts`. Mirrors `BaseClient`/`getClient()`/`registerProvider()`.

**Files:**
- Create: `lib/transcription/baseTranscriptionClient.ts`
- Rewrite: `lib/transcription/openai.ts` (function → subclass)
- Rewrite: `lib/transcription.ts` (dispatch → factory)
- Modify: `lib/index.ts` (export surface)
- Modify: `lib/index.test.ts` (replace the `OPENAI_TRANSCRIBE_MODELS` assertions with `BaseTranscriptionClient`/registration assertions; assert the internal factory, built-in client, and `_resetForTests` stay off the package-root surface)
- Test: `lib/transcription.test.ts`, `lib/transcription/openai.test.ts` (update registration style + removed-allowlist expectations), `lib/index.test.ts`

**Interfaces:**
- Consumes: `calculateTranscriptionCost` (Task 4), `canonicalizeMime` (Task 2), `loadBlob`/`BlobRef` (Task 2), `getModelForProvider`/`isSpeechToTextModel` from `models.js`, `resolveProvider`/`resolveApiKey` from `util/provider.js`, `redactSecret`, `getLogger`.
- Produces: declarative operations, extension base class, and registration are public via `lib/index.ts`; the configured-client factory remains module-internal and is exported only from `transcription.ts` for focused tests.

```typescript
// lib/transcription/baseTranscriptionClient.ts
export type TranscriptionClientConfig = {
  model: string;
  provider: string;          // resolved, never undefined here
  apiKey: string;            // resolved; "" when none found
  modelData?: ModelDataBlob;
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  metadata?: Record<string, unknown>;  // plugin escape hatch, mirrors SmolConfig
};
export abstract class BaseTranscriptionClient {
  constructor(config: TranscriptionClientConfig);
  transcribe(source: BlobRef): Promise<Result<TranscriptionResult>>;
  protected abstract _transcribe(data: Uint8Array, mimeType: string): Promise<Result<TranscriptionResult>>;
}

// lib/transcription.ts
export type TranscribeOptions = {
  model: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  metadata?: Record<string, unknown>;
};
export type TranscriptionClientClass = new (config: TranscriptionClientConfig) => BaseTranscriptionClient;
export function registerTranscriptionProvider(name: string, cls: TranscriptionClientClass): void;
export function transcribe(source: BlobRef, opts: TranscribeOptions): Promise<Result<TranscriptionResult>>;
// Internal/test-only module export, deliberately omitted from lib/index.ts:
export function getTranscriptionClient(opts: TranscribeOptions): Result<BaseTranscriptionClient>;
// TranscriptionResult / TranscriptionSegment / TranscriptionWord types unchanged.
// DEFAULT_TRANSCRIBE_BYTES stays exported (now lives in baseTranscriptionClient.ts, re-exported).
```

- **Removed from the public surface** (breaking, intended): `OPENAI_TRANSCRIBE_MODELS`, `TranscriptionProvider`, `TranscriptionProviderOptions`, `TranscriptionProviderContext`, `getTranscriptionClient`, and the transport-specific `TranscribeOptions.filename`.

- [ ] **Step 1: Rewrite the registration/dispatch tests to the class pattern (failing first)**

In `lib/transcription.test.ts`, convert every `registerTranscriptionProvider(name, { async transcribe(...) })` object literal into a subclass. Pattern for each:

```typescript
import { BaseTranscriptionClient } from "./transcription/baseTranscriptionClient.js";
import type { TranscriptionResult } from "./transcription.js";
import { Result, success } from "./types/result.js";

class FakeAsr extends BaseTranscriptionClient {
  protected async _transcribe(): Promise<Result<TranscriptionResult>> {
    return success({ text: "hi" });
  }
}
registerTranscriptionProvider("myasr", FakeAsr);
```

Specific conversions:
- The "passes options through" test: assert via a captured `this.config` (have the fake stash `this.config` into a module-level variable inside `_transcribe`) — it should see `model`, `provider: "myasr"`, `language: "en"`, and resolved `apiKey`.
- The custom-key test: fake stashes `this.config.apiKey`; expect `"secret-123"` for `apiKey: { acme: "secret-123" }`.
- The no-override test **changes expectation**: registering `"openai"` still must not override the built-in, but the failure text changes because the allowlist is gone. With `model: "gpt-4o-transcribe", provider: "openai"` and no registry entry for that model, the built-in client now proceeds and fails at the SDK layer — so instead assert the *built-in class* is selected: `const client = getTranscriptionClient({ model: "whisper-1", provider: "openai", apiKey: { openAi: "sk-x" } }); expect(client.success && client.value instanceof OpenAITranscriptionClient).toBe(true);` after registering a fake under `"openai"`.
- Throw/reject tests: fake `_transcribe` throws / rejects; expectations unchanged (one redacted logged error, Failure returned).
- Add a new test: `getTranscriptionClient` returns Failure `Provider "x" has no transcription API. Register one with registerTranscriptionProvider(name, ClientClass).` for an unknown provider.
- Add a new test (model-data-driven validation now lives in the base): `transcribe(src, { model: "whisper-1", provider: "openai", apiKey: { openAi: "k" } })` with an unsupported MIME source fails with `Unsupported audio type`.
- Add throwing-constructor tests (the internal factory backs a public Result boundary): register a class whose constructor does `throw new Error("boom " + config.apiKey)`; call both `getTranscriptionClient(...)` and `transcribe(...)` with `apiKey: { evil: "sk-secret-xyz" }`. Assert each returns a Failure, exactly one redacted error is logged, and neither the Failure message nor the logged message contains `sk-secret-xyz`.
- Add maxBytes-cap tests through the public path with a fake provider + `modelData` declaring `maxBytes` on a speech-to-text entry: (a) caller limit **below** the model cap → a source between the two limits fails size validation; (b) caller limit **above** the model cap → a source between them still fails (cap wins); (c) no caller limit → model cap applies; (d) `maxBytes: -1` → Failure `maxBytes must be a positive finite number`.
- Add runtime model-constraint tests: a valid cap supplied through global `registerModelData` is enforced; parsed `maxBytes: "invalid"` and programmatically registered `NaN`/`Infinity` each return `Model "..." has an invalid maxBytes value` before blob loading; non-string `supportedMimeTypes` entries return an invalid-model-data Failure.
- Add alias-normalization tests: sources labeled `audio/mp3`, `audio/x-wav`, `audio/x-m4a`, and `video/mp4` validate against canonical model entries without repeating aliases in `supportedMimeTypes`.
- Delete the existing `"honors an explicit filename override"` test from `lib/transcription/openai.test.ts`; `filename` is intentionally no longer public/provider-neutral. Keep the derived-filename test, which verifies that OpenAI receives the synthetic name inferred from MIME.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/transcription.test.ts`
Expected: FAIL (no `baseTranscriptionClient.js`, changed API).

- [ ] **Step 3: Create `lib/transcription/baseTranscriptionClient.ts`**

```typescript
import type { ModelDataBlob } from "../modelData.js";
import {
  getModelForProvider,
  isSpeechToTextModel,
  type SpeechToTextModel,
} from "../models.js";
import { calculateTranscriptionCost } from "../model.js";
import { Result, success, failure } from "../types/result.js";
import { BlobRef, loadBlob } from "../util/blobRef.js";
import { audioFormatForMime, canonicalizeMime } from "../util/mime.js";
import { redactSecret } from "../util/redact.js";
import { getLogger } from "../util/logger.js";
import type { TranscriptionResult } from "../transcription.js";

export const DEFAULT_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

export type TranscriptionClientConfig = {
  model: string;
  /** Resolved provider name. */
  provider: string;
  /** Resolved API key; empty string when none was found. */
  apiKey: string;
  modelData?: ModelDataBlob;
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  metadata?: Record<string, unknown>;
};

/** Validate the declarative STT constraint block once before consuming it. */
function transcriptionConstraintError(model: SpeechToTextModel): string | null {
  const modelMaxBytes: unknown = model.maxBytes;
  if (
    modelMaxBytes !== undefined &&
    (typeof modelMaxBytes !== "number" || !Number.isFinite(modelMaxBytes) || modelMaxBytes <= 0)
  ) {
    return `Model "${model.modelName}" has an invalid maxBytes value.`;
  }
  const supportedMimeTypes: unknown = model.supportedMimeTypes;
  if (
    supportedMimeTypes !== undefined &&
    (!Array.isArray(supportedMimeTypes) ||
      !supportedMimeTypes.every((mime): mime is string => typeof mime === "string"))
  ) {
    return `Model "${model.modelName}" has invalid supportedMimeTypes.`;
  }
  return null;
}

function resolveTranscriptionMaxBytes(
  callerMaxBytes: number | undefined,
  model: SpeechToTextModel | undefined,
): Result<number> {
  if (
    callerMaxBytes !== undefined &&
    (!Number.isFinite(callerMaxBytes) || callerMaxBytes <= 0)
  ) {
    return failure(`maxBytes must be a positive finite number (got ${callerMaxBytes}).`);
  }
  const limits: number[] = [];
  if (callerMaxBytes !== undefined) {
    limits.push(callerMaxBytes);
  }
  if (model?.maxBytes !== undefined) {
    limits.push(model.maxBytes);
  }
  if (limits.length === 0) {
    return success(DEFAULT_TRANSCRIBE_BYTES);
  }
  return success(Math.min(...limits));
}

/**
 * Shared transcription behavior, mirroring BaseClient for text generation:
 * the public transcribe() template method owns blob loading, model-data-driven
 * validation, cost, and the single redacting/logging exception boundary.
 * Subclasses implement only _transcribe(): SDK call + response mapping.
 */
export abstract class BaseTranscriptionClient {
  protected config: TranscriptionClientConfig;

  constructor(config: TranscriptionClientConfig) {
    this.config = config;
  }

  async transcribe(source: BlobRef): Promise<Result<TranscriptionResult>> {
    try {
      const model = getModelForProvider(this.config.provider, this.config.model, this.config.modelData);
      if (model !== undefined && !isSpeechToTextModel(model)) {
        return failure(`Model "${this.config.model}" is not a speech-to-text model.`);
      }

      if (model !== undefined) {
        const constraintError = transcriptionConstraintError(model);
        if (constraintError !== null) {
          return failure(constraintError);
        }
      }
      const effectiveLimit = resolveTranscriptionMaxBytes(this.config.maxBytes, model);
      if (!effectiveLimit.success) {
        return effectiveLimit;
      }

      let loaded: { data: Uint8Array; mimeType?: string };
      try {
        loaded = await loadBlob(source, { maxBytes: effectiveLimit.value });
      } catch (err) {
        return failure(`Failed to load audio for transcription: ${(err as Error).message}`);
      }
      const mimeType = loaded.mimeType ?? "application/octet-stream";

      if (model !== undefined && model.supportedMimeTypes !== undefined) {
        const audioFormat = audioFormatForMime(mimeType);
        const normalizedMime = audioFormat?.mimeType ?? canonicalizeMime(mimeType);
        if (!model.supportedMimeTypes.includes(normalizedMime)) {
          return failure(
            `Unsupported audio type "${mimeType}" for model "${this.config.model}". ` +
              `Supported: ${model.supportedMimeTypes.join(", ")}.`,
          );
        }
      }

      const result = await this._transcribe(loaded.data, mimeType);
      if (!result.success) {
        return result;
      }
      const cost = calculateTranscriptionCost(model, result.value.durationSeconds);
      if (cost !== undefined) {
        result.value.cost = cost;
      }
      return result;
    } catch (err) {
      let msg = "transcribe() failed";
      if (err instanceof Error) {
        msg = err.message;
      }
      const redacted = redactSecret(msg, this.config.apiKey);
      getLogger().error("transcribe() provider failed:", redacted);
      return failure(redacted);
    }
  }

  /** Provider hook: SDK call + response mapping only; validation and cost live in the base. */
  protected abstract _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>>;
}
```

Note the `model` narrowing: after the `!isSpeechToTextModel(model)` early return, TypeScript narrows `model` to `SpeechToTextModel | undefined`, so `model.maxBytes`/`model.supportedMimeTypes` typecheck directly. The `TranscriptionResult` import is type-only, so the `transcription.ts ↔ transcription/openai.ts` module cycle has no runtime edge.

- [ ] **Step 4: Rewrite `lib/transcription/openai.ts` as a subclass**

```typescript
import OpenAI, { toFile } from "openai";
import { Result, success, failure } from "../types/result.js";
import { transcriptionAudioType } from "../util/audioMime.js";
import { BaseTranscriptionClient } from "./baseTranscriptionClient.js";
import type {
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionWord,
} from "../transcription.js";

type OpenAITranscriptionResponse = {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptionSegment[];
  words?: TranscriptionWord[];
};

export class OpenAITranscriptionClient extends BaseTranscriptionClient {
  // No try/catch here: BaseTranscriptionClient.transcribe() is the single
  // redacting/logging exception boundary.
  protected async _transcribe(
    data: Uint8Array,
    mimeType: string,
  ): Promise<Result<TranscriptionResult>> {
    if (!this.config.apiKey) {
      return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
    }

    // Filename is an OpenAI upload detail, not part of the provider-neutral
    // operation contract. Derive the synthetic name from the normalized MIME.
    const filename = transcriptionAudioType(mimeType)?.filename ?? "audio.bin";

    const client = new OpenAI({ apiKey: this.config.apiKey });
    const file = await toFile(data, filename, { type: mimeType });

    const granularities: ("segment" | "word")[] = [];
    if (this.config.timestampGranularity) {
      granularities.push(this.config.timestampGranularity);
    }

    const requestBody: Record<string, unknown> = {
      file,
      model: this.config.model,
      response_format: "verbose_json",
    };
    if (this.config.language) {
      requestBody.language = this.config.language;
    }
    if (this.config.prompt) {
      requestBody.prompt = this.config.prompt;
    }
    if (granularities.length > 0) {
      requestBody.timestamp_granularities = granularities;
    }

    const res = (await client.audio.transcriptions.create(
      requestBody as unknown as Parameters<typeof client.audio.transcriptions.create>[0],
    )) as unknown as OpenAITranscriptionResponse;

    const result: TranscriptionResult = { text: res.text, raw: res };
    if (res.language) {
      result.language = res.language;
    }
    if (typeof res.duration === "number") {
      result.durationSeconds = res.duration;
    }
    if (Array.isArray(res.segments)) {
      result.segments = res.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
      }));
    }
    if (Array.isArray(res.words)) {
      result.words = res.words.map((word) => ({
        start: word.start,
        end: word.end,
        word: word.word,
      }));
    }
    return success(result);
  }
}
```

- [ ] **Step 5: Rewrite `lib/transcription.ts` as types + registry + factory + thin wrapper**

```typescript
import type { ModelDataBlob } from "./modelData.js";
import type { SmolConfig } from "./types.js";
import { Result, success, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { BlobRef } from "./util/blobRef.js";
import { redactSecret } from "./util/redact.js";
import { getLogger } from "./util/logger.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import {
  BaseTranscriptionClient,
  TranscriptionClientConfig,
} from "./transcription/baseTranscriptionClient.js";
import { OpenAITranscriptionClient } from "./transcription/openai.js";

export { DEFAULT_TRANSCRIBE_BYTES } from "./transcription/baseTranscriptionClient.js";

export type TranscribeOptions = {
  model: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  language?: string;
  prompt?: string;
  timestampGranularity?: "segment" | "word";
  maxBytes?: number;
  metadata?: Record<string, unknown>;
};

export type TranscriptionSegment = { start: number; end: number; text: string };
export type TranscriptionWord = { start: number; end: number; word: string };

export type TranscriptionResult = {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments?: TranscriptionSegment[];
  words?: TranscriptionWord[];
  usage?: TokenUsage;
  cost?: CostEstimate;
  raw?: unknown;
};

export type TranscriptionClientClass = new (
  config: TranscriptionClientConfig,
) => BaseTranscriptionClient;

// Checked before the user registry so a registered "openai" can't hijack the built-in.
const builtinClients: Record<string, TranscriptionClientClass> = Object.create(null);
builtinClients["openai"] = OpenAITranscriptionClient;

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registered: Record<string, TranscriptionClientClass> = Object.create(null);

export function registerTranscriptionProvider(
  name: string,
  cls: TranscriptionClientClass,
): void {
  registered[name] = cls;
}

/** Test-only: clear all registered custom providers so registrations don't leak across tests. */
export function _resetForTests(): void {
  for (const key of Object.keys(registered)) {
    delete registered[key];
  }
}

/**
 * Resolve provider + API key and instantiate the matching transcription client
 * for the declarative transcribe() operation. Never throws: a custom client
 * class's constructor can throw, and this internal factory's catch redacts the
 * resolved key so a constructor error cannot leak through the public wrapper.
 */
export function getTranscriptionClient(
  opts: TranscribeOptions,
): Result<BaseTranscriptionClient> {
  let apiKeyForRedaction = "";
  try {
    const provider = resolveProvider(opts.model, opts.provider, opts.modelData);

    const ClientClass = builtinClients[provider] ?? registered[provider];
    if (ClientClass === undefined) {
      return failure(
        `Provider "${provider}" has no transcription API. Register one with registerTranscriptionProvider(name, ClientClass).`,
      );
    }

    const apiKey = resolveApiKey(provider, opts) ?? "";
    apiKeyForRedaction = apiKey;
    const { apiKey: _callerKeys, ...clientOpts } = opts;
    const config: TranscriptionClientConfig = { ...clientOpts, provider, apiKey };
    return success(new ClientClass(config));
  } catch (err) {
    let msg = "getTranscriptionClient() failed";
    if (err instanceof Error) {
      msg = err.message;
    }
    const redacted = redactSecret(msg, apiKeyForRedaction);
    getLogger().error("getTranscriptionClient() failed:", redacted);
    return failure(redacted);
  }
}

export async function transcribe(
  source: BlobRef,
  opts: TranscribeOptions,
): Promise<Result<TranscriptionResult>> {
  const client = getTranscriptionClient(opts);
  if (!client.success) {
    return client;
  }
  return client.value.transcribe(source);
}
```


- [ ] **Step 6: Update `lib/index.ts` transcription exports**

```typescript
// Explicit (not `export *`) so internal factories and test helpers stay private.
export {
  transcribe,
  registerTranscriptionProvider,
  DEFAULT_TRANSCRIBE_BYTES,
} from "./transcription.js";
export type {
  TranscribeOptions,
  TranscriptionSegment,
  TranscriptionWord,
  TranscriptionResult,
  TranscriptionClientClass,
} from "./transcription.js";
export { BaseTranscriptionClient } from "./transcription/baseTranscriptionClient.js";
export type { TranscriptionClientConfig } from "./transcription/baseTranscriptionClient.js";
```

Delete the `OPENAI_TRANSCRIBE_MODELS` and provider-context type exports. Do not export `getTranscriptionClient` or `OpenAITranscriptionClient`; callers use the declarative operation, while custom providers extend `BaseTranscriptionClient` and register the class. Focused tests may import internal factory/built-in modules directly.

- [ ] **Step 7: Update `lib/transcription/openai.test.ts`**

The SDK-mocking tests keep working with mechanical changes: instead of calling `openaiTranscribe(data, mime, ctx)`, construct `new OpenAITranscriptionClient({ model: "whisper-1", provider: "openai", apiKey: "sk-test", ... })` and call `.transcribe({ kind: "bytes", data, mimeType })`. Cost/0-rate tests move their assertions to the same public path (cost now attached by the base) or migrate to `model.audioCost.test.ts` if already covered there — do not keep duplicate cost tests in both files.

- [ ] **Step 8: Run the transcription suites, then everything**

Run: `pnpm vitest run lib/transcription.test.ts lib/transcription/openai.test.ts && pnpm vitest run && pnpm typecheck`
Expected: PASS. Grep for stragglers: `grep -rn "openaiTranscribe\|OPENAI_TRANSCRIBE_MODELS\|TranscriptionProviderContext" lib` → no non-test hits.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: class-based transcription providers (BaseTranscriptionClient + factory)"
```

---

### Task 6: `BaseSpeechClient` + OpenAI subclass + factory-based `speech.ts`

Same pattern as Task 5 for TTS. Also widens `PcmAudioMetadata` (OpenAI's literal constants don't belong in a provider-neutral type).

**Files:**
- Create: `lib/speech/baseSpeechClient.ts`
- Rewrite: `lib/speech/openai.ts`
- Rewrite: `lib/speech.ts`
- Modify: `lib/util/audioMime.ts` (add `isSpeakFormat` guard)
- Modify: `lib/index.ts`
- Modify: `lib/index.test.ts` (replace `OPENAI_SPEECH_MODELS`/`MAX_TTS_CHARS` assertions with `BaseSpeechClient`/registration assertions; assert the internal factory and built-in client are not package-root API)
- Test: `lib/speech.test.ts`, `lib/speech/openai.test.ts`, `lib/index.test.ts`

**Interfaces:**
- Consumes: `calculateSpeechCost` (Task 4), `getModelForProvider`/`isTextToSpeechModel`, `resolveProvider`/`resolveApiKey`, `SPEECH_FORMAT_TO_MIME`/`SpeakFormat` from `util/audioMime.js`.
- Produces:

```typescript
// lib/speech/baseSpeechClient.ts
// format is a plain string in the shared contract: model data declares
// `formats` as string[], and a custom provider may expose e.g. "mulaw".
// The OpenAI subclass narrows to its closed SpeakFormat union at runtime.
export type SpeechClientConfig = {
  model: string;
  provider: string;          // resolved
  apiKey: string;            // resolved; "" when none found
  voice: string;
  modelData?: ModelDataBlob;
  format?: string;
  speed?: number;
  metadata?: Record<string, unknown>;
};
export abstract class BaseSpeechClient {
  constructor(config: SpeechClientConfig);
  speak(text: string): Promise<Result<SpeechResult>>;
  protected abstract _speak(text: string): Promise<Result<SpeechResult>>;
}

// lib/speech.ts
export type SpeakOptions = {
  model: string;
  voice: string;
  provider?: string;
  modelData?: ModelDataBlob;
  apiKey?: SmolConfig["apiKey"];
  format?: string;
  speed?: number;
  metadata?: Record<string, unknown>;
};
export type PcmAudioMetadata = {
  sampleRateHz: number;
  sampleFormat: string;      // e.g. "s16le"; provider-specific
  channels: number;
};
export type SpeechResult = {
  audio: Uint8Array;
  mimeType: string;
  pcm?: PcmAudioMetadata;
  cost?: CostEstimate;
  raw?: unknown;
};
export type SpeechClientClass = new (config: SpeechClientConfig) => BaseSpeechClient;
export function registerSpeechProvider(name: string, cls: SpeechClientClass): void;
export function speak(text: string, opts: SpeakOptions): Promise<Result<SpeechResult>>;
// Internal/test-only module export, deliberately omitted from lib/index.ts:
export function getSpeechClient(opts: SpeakOptions): Result<BaseSpeechClient>;
```

- **Removed from the public surface** (breaking, intended): `OPENAI_SPEECH_MODELS`, `MAX_TTS_CHARS`, `MIN_OPENAI_TTS_SPEED`, `MAX_OPENAI_TTS_SPEED`, `SpeechProvider`, `SpeechProviderOptions`, `SpeechProviderContext`, and `getSpeechClient` (limits now live in model data; callers use `speak`).

- [ ] **Step 1: Rewrite `lib/speech.test.ts` registrations to subclasses (failing first)**

Same conversion pattern as Task 5 Step 1. Validation tests change from constant-based to model-data-based expectations:
- Char-cap test: `speak("x".repeat(4097), { model: "tts-1", voice: "alloy", provider: "openai", apiKey: { openAi: "k" } })` → Failure containing `4096-character limit`.
- Speed test: `speed: 9` → Failure containing `speed must be a finite number in [0.25, 4]`.
- New test: a *custom* model under a custom provider skips validation entirely (no registry entry → `_speak` reached).
- New test: format not in `model.formats` → Failure (register a fake model via `modelData` with `formats: ["mp3"]`, request `format: "wav"`).
- New test (provider-neutral format): a custom provider with a `modelData` entry declaring `formats: ["mulaw"]` accepts `format: "mulaw"` and its `_speak` is reached — proves the shared contract no longer forces OpenAI's union.
- New test (OpenAI narrowing): `format: "mulaw"` against the built-in OpenAI client (no model entry restricting it) fails with `not a supported OpenAI speech format`.
- New prototype-key tests: `format` values `"toString"`, `"constructor"`, and `"__proto__"` are rejected by the OpenAI runtime guard.
- New malformed model-data tests: non-positive/non-integer `maxInputChars`, non-finite or reversed `speedRange`, and non-string `formats` return an invalid-model-data Failure before `_speak` runs.
- New test (throwing constructor): same shape as Task 5's — registered class constructor throws with the key in the message; `getSpeechClient` and `speak` both return redacted Failures, no throw, no key in message or log.
- Keep: custom-key test, throw/reject redaction tests, no-override-of-builtin test (assert `getSpeechClient` returns `OpenAISpeechClient` instance).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/speech.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `lib/speech/baseSpeechClient.ts`**

```typescript
import type { ModelDataBlob } from "../modelData.js";
import {
  getModelForProvider,
  isTextToSpeechModel,
  type TextToSpeechModel,
} from "../models.js";
import { calculateSpeechCost } from "../model.js";
import { Result, failure } from "../types/result.js";
import { redactSecret } from "../util/redact.js";
import { getLogger } from "../util/logger.js";
import type { SpeechResult } from "../speech.js";

export type SpeechClientConfig = {
  model: string;
  /** Resolved provider name. */
  provider: string;
  /** Resolved API key; empty string when none was found. */
  apiKey: string;
  voice: string;
  modelData?: ModelDataBlob;
  /** Output format; provider-specific vocabulary (OpenAI: mp3/opus/aac/flac/wav/pcm). */
  format?: string;
  speed?: number;
  metadata?: Record<string, unknown>;
};

/** Validate the declarative TTS constraint block once before consuming it. */
function speechConstraintError(model: TextToSpeechModel): string | null {
  const maxInputChars: unknown = model.maxInputChars;
  if (
    maxInputChars !== undefined &&
    (typeof maxInputChars !== "number" ||
      !Number.isInteger(maxInputChars) ||
      maxInputChars <= 0)
  ) {
    return `Model "${model.modelName}" has an invalid maxInputChars value.`;
  }

  const speedRange: unknown = model.speedRange;
  if (speedRange !== undefined) {
    if (typeof speedRange !== "object" || speedRange === null) {
      return `Model "${model.modelName}" has an invalid speedRange.`;
    }
    const min: unknown = (speedRange as { min?: unknown }).min;
    const max: unknown = (speedRange as { max?: unknown }).max;
    if (
      typeof min !== "number" ||
      typeof max !== "number" ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min > max
    ) {
      return `Model "${model.modelName}" has an invalid speedRange.`;
    }
  }

  const formats: unknown = model.formats;
  if (
    formats !== undefined &&
    (!Array.isArray(formats) ||
      !formats.every((format): format is string => typeof format === "string"))
  ) {
    return `Model "${model.modelName}" has invalid formats.`;
  }
  return null;
}

/**
 * Shared TTS behavior, mirroring BaseClient for text generation: the public
 * speak() template method owns model-data-driven validation (char cap, speed
 * range, format list), cost, and the single redacting/logging exception
 * boundary. Subclasses implement only _speak(): SDK call + response mapping.
 * A model with no registry entry skips validation — the provider is then the
 * authority, matching how cost is silently omitted for unknown models.
 */
export abstract class BaseSpeechClient {
  protected config: SpeechClientConfig;

  constructor(config: SpeechClientConfig) {
    this.config = config;
  }

  async speak(text: string): Promise<Result<SpeechResult>> {
    try {
      const model = getModelForProvider(this.config.provider, this.config.model, this.config.modelData);
      if (model !== undefined && !isTextToSpeechModel(model)) {
        return failure(`Model "${this.config.model}" is not a text-to-speech model.`);
      }

      if (model !== undefined) {
        const constraintError = speechConstraintError(model);
        if (constraintError !== null) {
          return failure(constraintError);
        }
        if (model.maxInputChars !== undefined && [...text].length > model.maxInputChars) {
          return failure(
            `Input exceeds the ${model.maxInputChars}-character limit for model "${this.config.model}".`,
          );
        }
        if (this.config.speed !== undefined && model.speedRange !== undefined) {
          const { min, max } = model.speedRange;
          if (!Number.isFinite(this.config.speed) || this.config.speed < min || this.config.speed > max) {
            return failure(`speed must be a finite number in [${min}, ${max}].`);
          }
        }
        if (
          this.config.format !== undefined &&
          model.formats !== undefined &&
          !model.formats.includes(this.config.format)
        ) {
          return failure(
            `Format "${this.config.format}" is not supported by model "${this.config.model}". ` +
              `Supported: ${model.formats.join(", ")}.`,
          );
        }
      }

      const result = await this._speak(text);
      if (!result.success) {
        return result;
      }
      const cost = calculateSpeechCost(model, [...text].length);
      if (cost !== undefined) {
        result.value.cost = cost;
      }
      return result;
    } catch (err) {
      let msg = "speak() failed";
      if (err instanceof Error) {
        msg = err.message;
      }
      const redacted = redactSecret(msg, this.config.apiKey);
      getLogger().error("speak() provider failed:", redacted);
      return failure(redacted);
    }
  }

  /** Provider hook: SDK call + response mapping only; validation and cost live in the base. */
  protected abstract _speak(text: string): Promise<Result<SpeechResult>>;
}
```

- [ ] **Step 4: Rewrite `lib/speech/openai.ts`**

```typescript
import OpenAI from "openai";
import type { SpeechCreateParams } from "openai/resources/audio/speech";
import { Result, success, failure } from "../types/result.js";
import {
  SPEECH_FORMAT_TO_MIME,
  isSpeakFormat,
  type SpeakFormat,
} from "../util/audioMime.js";
import { BaseSpeechClient } from "./baseSpeechClient.js";
import type { SpeechResult } from "../speech.js";

export class OpenAISpeechClient extends BaseSpeechClient {
  // No try/catch here: BaseSpeechClient.speak() is the single
  // redacting/logging exception boundary.
  protected async _speak(text: string): Promise<Result<SpeechResult>> {
    if (!this.config.apiKey) {
      return failure("No OpenAI API key provided. Set apiKey.openAi or OPENAI_API_KEY.");
    }

    // The shared contract carries format as a plain string; narrow to OpenAI's
    // closed union at runtime before indexing the MIME table.
    const requestedFormat = this.config.format ?? "mp3";
    if (!isSpeakFormat(requestedFormat)) {
      return failure(
        `Format "${requestedFormat}" is not a supported OpenAI speech format. ` +
          `Supported: ${Object.keys(SPEECH_FORMAT_TO_MIME).join(", ")}.`,
      );
    }
    const format: SpeakFormat = requestedFormat;
    const mimeType = SPEECH_FORMAT_TO_MIME[format];

    const client = new OpenAI({ apiKey: this.config.apiKey });
    const params: SpeechCreateParams = {
      model: this.config.model,
      voice: this.config.voice as SpeechCreateParams["voice"],
      input: text,
      response_format: format,
    };
    if (this.config.speed !== undefined) {
      params.speed = this.config.speed;
    }
    const res = await client.audio.speech.create(params);
    const audio = new Uint8Array(await res.arrayBuffer());

    const result: SpeechResult = { audio, mimeType };
    if (format === "pcm") {
      result.pcm = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 };
    }
    return success(result);
  }
}
```

(Note this also removes the conditional spread `...(opts.speed !== undefined ? ... : {})` from the old code — explicit `if` per the global constraint.)

`isSpeakFormat` is a new guard added to `lib/util/audioMime.ts` in this task:

```typescript
export function isSpeakFormat(value: string): value is SpeakFormat {
  return Object.hasOwn(SPEECH_FORMAT_TO_MIME, value);
}
```

- [ ] **Step 5: Rewrite `lib/speech.ts`**

Same structure as Task 5 Step 5: types (`SpeakOptions` with `format?: string`, `PcmAudioMetadata` widened to `sampleRateHz: number` / `sampleFormat: string` / `channels: number`, `SpeechResult`), `builtinClients["openai"] = OpenAISpeechClient`, null-prototype `registered`, `registerSpeechProvider`, `_resetForTests`, internal `getSpeechClient(opts)` (resolve provider → derive `const ClientClass = builtinClients[provider] ?? registered[provider]` → resolve key → strip caller `apiKey` map → instantiate), and `speak(text, opts)` as a thin declarative wrapper. `getSpeechClient` gets the **same redacting exception boundary as `getTranscriptionClient`** in Task 5 Step 5 (track `apiKeyForRedaction`, wrap everything including `new ClientClass(config)`, redact + log + return Failure in the catch) — a throwing custom constructor must not escape the public `speak()` Result contract or leak the key. Failure text for an unknown provider: `Provider "${provider}" has no speech API. Register one with registerSpeechProvider(name, ClientClass).`

- [ ] **Step 6: Update `lib/index.ts` speech exports**

Export `speak`, `registerSpeechProvider`, `BaseSpeechClient`, and types `SpeakOptions`, `PcmAudioMetadata`, `SpeechResult`, `SpeechClientClass`, `SpeechClientConfig`. Do **not** export `getSpeechClient` or `OpenAISpeechClient`; they are internal lifecycle/implementation machinery. Delete `OPENAI_SPEECH_MODELS`, `MAX_TTS_CHARS`, `MIN_OPENAI_TTS_SPEED`, `MAX_OPENAI_TTS_SPEED`, and the old provider-context types.

- [ ] **Step 7: Update `lib/speech/openai.test.ts`**

Construct `new OpenAISpeechClient({ model: "tts-1", provider: "openai", apiKey: "sk-test", voice: "alloy" })` and call `.speak(text)` against the existing SDK mocks. Cost assertions stay valid (cost now attached by the base through the same public call).

- [ ] **Step 8: Run speech suites + full suite + typecheck**

Run: `pnpm vitest run lib/speech.test.ts lib/speech/openai.test.ts && pnpm vitest run && pnpm typecheck`
Expected: PASS. Grep: `grep -rn "openaiSpeak\|OPENAI_SPEECH_MODELS\|MAX_TTS_CHARS\|SpeechProviderContext" lib` → no non-test hits.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: class-based speech providers (BaseSpeechClient + factory)"
```

---

### Task 7: Per-client attachment capabilities; shrink `util/modalities.ts`

Addresses: "one file has all the jobs… Each provider should define for itself whether it takes a format or not." The audio gate `provider !== "openai"` moves out of `modalities.ts` into client declarations, and the **audio format policy** (currently hardcoded to mp3/wav in `resolveAudioPart`) becomes part of the same per-client declaration, so a custom client that declares audio support controls which containers it accepts.

Scope boundary (deliberate, YAGNI): audio *transport* stays inline-base64 for every client — no provider today accepts chat audio by URL or file reference, so the capability object declares formats only. When a provider needs URL/providerFile audio, extend the capability object then; do not add transport plumbing now.

**Files:**
- Modify: `lib/util/modalities.ts` (becomes generic: collect needed modalities; zero provider knowledge)
- Modify: `lib/clients/baseClient.ts` (declare default capabilities, wire the check into `prepareAttachments`)
- Modify: `lib/clients/resolveAttachments.ts` (`resolveAudioPart` checks the client's declared formats instead of hardcoded `chatAudioFormat`)
- Modify: `lib/clients/openai.ts` (`SmolOpenAi` declares audio + mp3/wav)
- Modify: `lib/clients/openaiCompat.ts` (`SmolOpenAiCompat` overrides back to the default — compat endpoints don't get `input_audio`; this also covers openrouter/deepinfra/litellm which extend it)
- Modify: `lib/models.ts` (`modelSupportsInputModality` gains an optional `provider` param using `getModelForProvider`)
- Rewrite: `lib/util/modalities.test.ts` (currently imports and tests `validateModalities` directly — rewrite around `neededInputModalities` plus client-level public-path tests; do this in this task, not the final sweep)
- Modify: `lib/clients/resolveAttachments.audio.test.ts`, `lib/clients/resolveAttachments.test.ts`, `lib/files.integration.test.ts` (all direct resolver callers supply the new required `audioFormats` policy)
- Test: `lib/util/modalities.audio.test.ts`, `lib/util/modalities.test.ts`, resolver tests, client tests

**Interfaces:**
- Consumes: `getModelForProvider` (existing), `audioFormatForMime` from `util/mime.js` (Task 2).
- Produces:

```typescript
// lib/util/modalities.ts — replaces validateModalities entirely
export function neededInputModalities(messages: Message[]): string[];
/** Modalities a model must positively declare (unknown ≠ allowed). */
export const MODALITIES_REQUIRING_DECLARATION: ReadonlySet<string>;  // new Set(["audio"])

// lib/clients/baseClient.ts — single per-client declaration point
export type ClientAttachmentCapabilities = {
  /** Non-audio attachment modalities this client's serializers can render. */
  inputModalities: readonly ("image" | "pdf")[];
  /** Audio containers accepted inline. A non-empty list is the sole audio-support declaration. */
  audioFormats: readonly string[];
};
protected attachmentCapabilities(): ClientAttachmentCapabilities;
// base returns { inputModalities: ["image", "pdf"], audioFormats: [] }

// lib/clients/resolveAttachments.ts — ResolveOptions (from Task 3) gains:
type ResolveOptions = { provider: string; maxBytes: number; audioFormats: readonly string[] };

// lib/models.ts
export function modelSupportsInputModality(
  modelName: ModelName,
  modality: string,
  requestData?: ModelDataBlob,
  provider?: string,          // NEW, optional; when set, uses getModelForProvider
): boolean | undefined;
```

- [ ] **Step 1: Write failing tests**

Update `lib/util/modalities.audio.test.ts` (or add a new describe in `lib/clients/openai.audioChat.test.ts` where the public-path harness already exists):

```typescript
// Through the public path (textSync with a mocked SDK), assert:
it("rejects audio parts on anthropic with a capability error", async () => {
  // build config with an audioPart user message, provider "anthropic"
  // expect Failure containing: Audio input is not supported by the "anthropic" provider.
});
it("rejects audio parts on openai-compat providers", async () => {
  // provider "openrouter" → same capability failure (SmolOpenAiCompat override)
});
it("rejects audio on an openai model that does not declare audio input", async () => {
  // provider "openai", model "gpt-4o" → Failure containing: Model gpt-4o does not support audio input.
});
it("accepts audio on gpt-audio-1.5 via openai", async () => {
  // reaches the (mocked) SDK
});
```

And a direct unit test for the collector:

```typescript
import { neededInputModalities } from "./modalities.js";
it("collects image/pdf/audio needs from user messages", () => {
  // UserMessage with one imagePart + one audioPart → ["image", "audio"] (order-insensitive)
});
```

Plus the custom-client capability test (proves the policy is per-client, not global):

```typescript
it("honors a custom client's audio capability declaration", async () => {
  // registerProvider("acme-audio", class extends BaseClient {
  //   attachmentCapabilities() → { inputModalities: [], audioFormats: ["flac"] }
  //   ... minimal _textSync stub capturing the resolved messages ...
  // });
  // A flac audioPart (rejected by OpenAI's mp3/wav policy today) resolves
  // successfully and reaches the stub as inline base64.
  // Use modelData to register a text model under "acme-audio" declaring
  // modalities.input: ["text", "audio"], so the model-data gate passes too.
});
```

Also rewrite `lib/util/modalities.test.ts` in this task: its `validateModalities` tests (image on non-vision model, PDF handling, openai-compat unknown-model passthrough) become `neededInputModalities` unit tests plus public-path client tests asserting the same outcomes through `prepareAttachments`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/util/modalities.audio.test.ts`
Expected: FAIL (new function/messages don't exist yet).

- [ ] **Step 3: Implement**

`lib/util/modalities.ts` (full replacement — `validateModalities` is deleted):

```typescript
import { UserMessage, Message } from "../classes/message/index.js";

/** Modalities a model must positively declare in its data block — for these,
 *  "unknown" means "unsupported" (audio serialization is model-specific). */
export const MODALITIES_REQUIRING_DECLARATION: ReadonlySet<string> = new Set(["audio"]);

/** Which non-text input modalities the user messages actually use. */
export function neededInputModalities(messages: Message[]): string[] {
  const needed = new Set<string>();
  for (const msg of messages) {
    if (!(msg instanceof UserMessage)) {
      continue;
    }
    const parts = msg.getContentParts();
    if (parts === null) {
      continue;
    }
    for (const part of parts) {
      if (part.type === "image") {
        needed.add("image");
      }
      if (part.type === "file") {
        needed.add("pdf");
      }
      if (part.type === "audio") {
        needed.add("audio");
      }
    }
  }
  return [...needed];
}
```

`lib/models.ts` — add the optional provider param:

```typescript
export function modelSupportsInputModality(
  modelName: ModelName,
  modality: string,
  requestData?: ModelDataBlob,
  provider?: string,
): boolean | undefined {
  let model: ModelType | undefined;
  if (provider !== undefined) {
    model = getModelForProvider(provider, modelName, requestData);
  } else {
    model = getModel(modelName, requestData);
  }
  if (!model || model.type !== "text") {
    return undefined;
  }
  const inputs = model.modalities?.input;
  if (!inputs) {
    return undefined;
  }
  return inputs.includes(modality);
}
```

`lib/clients/baseClient.ts` — add the declaration and rework `prepareAttachments`:

Replace the `validateModalities` import with:

```typescript
import {
  neededInputModalities,
  MODALITIES_REQUIRING_DECLARATION,
} from "../util/modalities.js";
```

Extend the existing `../models.js` import with `modelSupportsInputModality`. In both `lib/clients/openai.ts` and `lib/clients/openaiCompat.ts`, import `type ClientAttachmentCapabilities` from `./baseClient.js` alongside `BaseClient`.

```typescript
export type ClientAttachmentCapabilities = {
  /** Non-audio attachment modalities this client's serializers can render. */
  inputModalities: readonly ("image" | "pdf")[];
  /** Non-empty means audio is supported; this is the sole audio declaration. */
  audioFormats: readonly string[];
};

/**
 * What this client can accept as attachments. Subclasses override to declare
 * more (or fewer). Checked against the messages, alongside the model's own
 * declared modalities, before any serialization runs.
 */
protected attachmentCapabilities(): ClientAttachmentCapabilities {
  return { inputModalities: ["image", "pdf"], audioFormats: [] };
}

function clientSupportsAttachment(
  capabilities: ClientAttachmentCapabilities,
  modality: string,
): boolean {
  if (modality === "audio") {
    return capabilities.audioFormats.length > 0;
  }
  if (modality === "image" || modality === "pdf") {
    return capabilities.inputModalities.includes(modality);
  }
  return false;
}
```

In `prepareAttachments`, replace the `validateModalities(config)` call with:

```typescript
const provider = resolveProvider(config.model, config.provider, config.modelData);
const capabilities = this.attachmentCapabilities();
for (const modality of neededInputModalities(config.messages)) {
  if (!clientSupportsAttachment(capabilities, modality)) {
    return failure(
      `${modality[0].toUpperCase()}${modality.slice(1)} input is not supported by the "${provider}" provider.`,
    );
  }
  const supported = modelSupportsInputModality(config.model, modality, config.modelData, provider);
  if (supported === false) {
    return failure(`Model ${config.model} does not support ${modality} input.`);
  }
  if (supported === undefined && MODALITIES_REQUIRING_DECLARATION.has(modality)) {
    return failure(`Model ${config.model} does not support ${modality} input.`);
  }
}
```

and pass the audio policy through to resolution:

```typescript
const resolved = await resolveMessageAttachments(config.messages, {
  provider,
  maxBytes,
  audioFormats: capabilities.audioFormats,
});
```

(The existing `resolveProvider` call lower in `prepareAttachments` moves up to serve both uses — call it once.) Note one deliberate behavior change: image/PDF errors previously said "does not support PDF/document input"; the generic message now says `does not support pdf input`. Update any test asserting the old string, or special-case the display word — prefer updating the tests to the generic message.

`lib/clients/resolveAttachments.ts` — `ResolveOptions` gains `audioFormats: readonly string[]`, and `resolveAudioPart` replaces its hardcoded `chatAudioFormat` check with the client's declared formats:

```typescript
const audioFormat = audioFormatForMime(source.mimeType);
if (audioFormat === null || !options.audioFormats.includes(audioFormat.extension)) {
  return failure(
    `Audio input for provider "${options.provider}" supports only ` +
      `${options.audioFormats.join(", ")}; got "${source.mimeType}".`,
  );
}
```

(`chatAudioFormat` in `audioMime.ts` loses this last call site — delete it and its tests; the OpenAI serializer's mp3/wav knowledge now lives in `SmolOpenAi.attachmentCapabilities()`. Check first with `grep -rn "chatAudioFormat" lib` — if a renderer still uses it to emit the `input_audio.format` field, keep it there and delete only the resolveAttachments usage.)

`lib/clients/openai.ts`:

```typescript
protected override attachmentCapabilities(): ClientAttachmentCapabilities {
  // Chat Completions input_audio accepts inline mp3/wav only.
  return { inputModalities: ["image", "pdf"], audioFormats: ["mp3", "wav"] };
}
```

`lib/clients/openaiCompat.ts` (inherits from `SmolOpenAi`, but compat gateways don't support `input_audio`):

```typescript
// Compat endpoints speak the Chat Completions wire format but do not get
// OpenAI's input_audio handling — declare no audio support.
protected override attachmentCapabilities(): ClientAttachmentCapabilities {
  return { inputModalities: ["image", "pdf"], audioFormats: [] };
}
```

Check `SmolOpenAiResponses`: it extends `BaseClient` directly, so it gets the base capabilities (no audio) — correct, `openai-responses` was rejected for audio in v1. `SmolGoogle`/`SmolAnthropic`/`SmolOllama` likewise inherit the default.

Update every direct resolver call in this task: existing successful OpenAI audio cases pass `audioFormats: ["mp3", "wav"]`; the custom FLAC case passes `audioFormats: ["flac"]`; non-audio calls in `resolveAttachments.test.ts` and `files.integration.test.ts` pass `audioFormats: []`. This keeps the required resolver contract explicit and prevents `undefined.includes(...)` failures.

- [ ] **Step 4: Run tests + fix message assertions**

Run: `pnpm vitest run lib/util/modalities.audio.test.ts && pnpm vitest run`
Expected: the new tests pass; fix any existing tests that assert the old error strings (`Audio input is only supported on the "openai" provider in v1`, `does not support PDF/document input`) to the new messages.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add -A
git commit -m "refactor: per-client input modality declarations replace centralized validateModalities"
```

---

### Task 8: Let `EmbedConfig` carry custom-provider API keys

Parity fix: d286d54 gave `SmolConfig.apiKey` and `resolveApiKey` an arbitrary-provider path, but `EmbedConfig.apiKey` is still a closed map, so a custom embed provider's key can't be passed without a type error.

**Files:**
- Modify: `lib/embed.ts`
- Test: `lib/embed.test.ts` (or wherever embed tests live — check with `ls lib/embed*`)

**Interfaces:**
- Produces: `EmbedConfig.apiKey` and `EmbedConfig.baseUrl` each gain `[provider: string]: string | undefined;` alongside the named fields.

- [ ] **Step 1: Write the failing test**

```typescript
it("accepts and resolves a custom provider's apiKey by registered name", async () => {
  let seen: EmbedConfig | undefined;
  registerEmbeddingProvider("acme", async (_inputs, config) => {
    seen = config;
    return { success: true, value: { embeddings: [[1]], model: config.model } };
  });
  const r = await embed("hi", { model: "acme-embed", provider: "acme", apiKey: { acme: "k-123" } });
  expect(r.success).toBe(true);
  expect(seen?.apiKey?.acme).toBe("k-123");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/embed.test.ts`
Expected: FAIL at typecheck of the test (`acme` not assignable) — vitest surfaces it, or `pnpm typecheck` does.

- [ ] **Step 3: Implement**

In `EmbedConfig`, add to the `apiKey` object type:

```typescript
    /** Arbitrary provider names, for keys targeting a custom-registered provider. */
    [provider: string]: string | undefined;
```

and the same line to `baseUrl`.

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run lib/embed.test.ts && pnpm typecheck
git add lib/embed.ts lib/embed.test.ts
git commit -m "fix: allow custom-provider keys in EmbedConfig, matching SmolConfig"
```

---

### Task 9: Docs, export audit, full verification, PR update

**Files:**
- Modify: `README.md` (transcription/speech sections: registration is now class-based; remove references to deleted constants)
- Modify: `../../docs/dev/audio.md` (repo root — note the path: commands in this plan run from `packages/smoltalk/`, and the dev notes live at the repository root, not inside the package)
- Verify: `lib/index.ts` (no stale exports)

- [ ] **Step 1: Update README**

In the transcription section (~line 529) and speech section (~line 554): replace `registerTranscriptionProvider(name, impl)` object examples with subclass examples:

```typescript
import { BaseTranscriptionClient, registerTranscriptionProvider } from "smoltalk";

class AcmeTranscription extends BaseTranscriptionClient {
  protected async _transcribe(data, mimeType) {
    // call your API with this.config.apiKey; return success({ text })
  }
}
registerTranscriptionProvider("acme", AcmeTranscription);
```

Same treatment for `registerSpeechProvider`. Remove/replace any mention of `MAX_TTS_CHARS`, `OPENAI_SPEECH_MODELS`, `OPENAI_TRANSCRIBE_MODELS`, `getTranscriptionClient`, `getSpeechClient`, and transcription `filename`. Explain that callers use the declarative `transcribe`/`speak` operations; base classes and registration are the extension surface; limits come from model data; MIME aliases come only from `AUDIO_FORMATS`; and custom limits ride in via `registerModelData`/`config.modelData`.

Then update `../../docs/dev/audio.md`: don't just grep-and-patch symbol names — **rewrite its architecture and extension sections** around the declarative boundaries: public operations express intent; internal factories own lifecycle; base template methods own runtime constraint validation/loading/cost/error handling; provider subclasses own SDK mapping; model records declare constraints; and `attachmentCapabilities()` declares non-audio modalities plus audio formats without duplicate audio flags.

Also rewrite its **MIME contracts** and **Registry / seed data** sections. They must say that `util/mime.ts`/`AUDIO_FORMATS` is the only alias source, model records contain canonical MIME values, and `tests/seed-model-data.test.ts` reads the committed `data/model-data.json` and compares every new STT/TTS constraint to the baked registry. Remove the old claim that the seed test does not inspect the committed catalog. Sweep both files for every removed symbol afterwards: `grep -n "OPENAI_TRANSCRIBE_MODELS\|OPENAI_SPEECH_MODELS\|MAX_TTS_CHARS\|ProviderContext\|normalizeImageRef\|validateModalities\|openaiTranscribe\|openaiSpeak\|getTranscriptionClient\|getSpeechClient" README.md ../../docs/dev/audio.md`.

- [ ] **Step 2: Full verification**

Run: `pnpm build && pnpm typecheck && pnpm test`
Expected: all green. Also run the workspace root's `pnpm typecheck` to confirm `smoltalk-llama-cpp`/`smoltalk-webllm` (peer-dependent plugins) still compile against the changed exports.

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "docs: update audio docs for class-based providers"
git push
```

- [ ] **Step 4: Reply to the open PR threads**

List thread comment IDs: `gh api repos/egonSchiele/smoltalk/pulls/36/comments --jq '.[] | {id, path, body: .body[0:80]}'`
Reply in-thread (not top-level) for each open comment, stating factually what changed and the commit hash:
- `anthropic.ts:278` + `model.ts:61`: explain these are part of the provider-aware pricing fix requested in the `openai.ts` thread (provider injected by `getClient`, `Provider` → `string` because resolved providers can be custom-registered names).
- `resolveAttachments.ts:71`: per-part resolvers, commit hash.
- `transcription/openai.ts:21` + `:29`: class-based `BaseTranscriptionClient`/`BaseSpeechClient` pattern implemented, commit hash.
- `imageRef.ts:37` + `imageRef.test.ts:252`: mime.ts single-sourcing + blobRef rename, commit hash.
- `modalities.ts:2`: non-contradictory per-client `attachmentCapabilities()` declarations, commit hash.
- `speech.ts:90` + `transcription.ts:58`: constraints moved to model registry, commit hash.
- `CHANGELOG.md`: reverted.

```bash
gh api repos/egonSchiele/smoltalk/pulls/36/comments/{comment_id}/replies -f body="..."
```

---

## Self-Review Notes

- **Coverage:** every open review comment maps to a task (CHANGELOG→1, imageRef audio/duplication→2, resolveAttachments length→3, hardcoded speech/transcription→4+5+6, ignored patterns→5+6, class pattern→5+6, modalities→7, anthropic/model provider questions→9 thread replies). EmbedConfig (Task 8) is the one item beyond the comments, included as agreed.
- **Type consistency:** `TranscriptionClientConfig`/`SpeechClientConfig` field names match between internal factories and subclasses; public options omit lifecycle and OpenAI upload details; `calculateTranscriptionCost(model, durationSeconds)` / `calculateSpeechCost(model, charCount)` signatures match Task 4 and their Task 5/6 call sites; `normalizeBlob`/`BlobRef` names match between Tasks 2 and 3; `audioFormats` is required at every resolver call.
- **Declarative-boundary check:** model records contain canonical constraints only; base clients validate and enforce them once; MIME aliases live only in `AUDIO_FORMATS`; capability declarations cannot represent duplicate/contradictory audio support; package-root callers see operations rather than factories; provider subclasses see resolved config and implement only SDK mapping.
- **Known judgment calls (flag to reviewer, don't silently decide differently):** (a) registered providers cannot shadow built-ins; (b) unknown model + explicit provider skips model-data validation and lets the provider reject; (c) generic modality error strings replace bespoke v1 wording; (d) shared speech `format`/PCM metadata are provider-neutral strings; (e) chat-audio transport remains inline-only until a real provider requires another transport.
