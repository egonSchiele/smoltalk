# Audio: STT, TTS & Audio-in-Chat (developer notes)

Development details for the audio features in `packages/smoltalk`: speech-to-text
(`transcribe`), text-to-speech (`speak`), and audio-in-chat (`AudioPart`). This is
the "how it fits together" companion to the user-facing section in
`packages/smoltalk/README.md` and the design spec in
`docs/superpowers/specs/2026-08-08-audio-stt-tts-design.md`.

## Scope (v1)

OpenAI-only. Every other provider returns a `Failure` for audio. Deferred to
follow-ups: streaming STT/TTS, the token-priced GPT dedicated audio endpoint
models (`gpt-4o-transcribe`, `gpt-4o-mini-tts`, …), Gemini/OpenRouter/local
providers, assistant audio *output*, speech translation, an SSRF guard for URL
sources, and voice discovery.

## Why STT/TTS live outside `SmolClient`

Chat flows through `SmolClient` → `text/textSync/textStream` → `PromptResult` /
`StreamChunk`, and `getClient()` deliberately rejects non-text models. STT and TTS
are not chat turns — they have no messages, tool calls, or streaming-chunk shape.
So they follow the **capability-function pattern** already used by
`lib/embed.ts` and `lib/files.ts`: a top-level function backed by a small provider
registry, taking `model: string` + optional `modelData`. `SmolClient` /
`getClient()` are untouched. Audio-*in-chat* is the exception — it rides the
existing text pipeline (see below).

## Files

```
lib/transcription.ts          transcribe() + TranscriptionProvider registry
lib/transcription/openai.ts   openaiTranscribe() — whisper-1
lib/speech.ts                 speak() + SpeechProvider registry
lib/speech/openai.ts          openaiSpeak() — tts-1 / tts-1-hd
lib/util/audioMime.ts         MIME↔extension maps + format derivation
lib/classes/message/contentParts.ts   AudioPart type + schema
lib/classes/message/index.ts          audioPart() helper
lib/classes/message/renderers/*       audio() on every PartRenderer
lib/clients/resolveAttachments.ts     audio → inline base64 (+ mp3/wav gate)
lib/util/modalities.ts                audio input-modality gate
lib/types/tokenUsage.ts + lib/model.ts + lib/clients/openai.ts   audio-token cost
lib/models.ts                 whisper-1, tts-1/-hd, gpt-audio-1.5, getModelForProvider
```

## `transcribe()` — speech-to-text

`transcribe(source: BlobRef, opts): Promise<Result<TranscriptionResult>>`.

- Input is a `BlobRef` (`bytes | base64 | path | url`) loaded via the shared
  `loadBlob` in `lib/util/imageRef.ts` — same size cap and SSRF caveat as file
  uploads.
- v1 built-in model allowlist is a literal set: `OPENAI_TRANSCRIBE_MODELS =
  { "whisper-1" }`. This is checked **independently of the registry**, so injected
  `modelData` cannot smuggle in a token-priced OpenAI STT model that v1 defers.
- The OpenAI adapter requests `response_format: "verbose_json"` (needed for both
  `duration` → cost and timestamps) and forwards `timestamp_granularities` when
  `timestampGranularity` is set. `"segment"` fills `segments`; `"word"` fills
  `words` (separate arrays, not one projected onto the other).
- Cost: `whisper-1` is per-minute → `inputCost = (durationSeconds/60) *
  perMinuteCost`. Gated on `perMinuteCost !== undefined` (a `0` rate reports a
  present zero cost, not omitted).

## `speak()` — text-to-speech

`speak(text: string, opts): Promise<Result<SpeechResult>>`.

- v1 allowlist `OPENAI_SPEECH_MODELS = { "tts-1", "tts-1-hd" }`, same registry-
  independent check.
- OpenAI-specific preflight (speed ∈ `[0.25, 4.0]`, 4096 **code-point** cap via
  `MAX_TTS_CHARS`) runs **only on the OpenAI branch, after provider resolution** —
  custom providers are never subjected to OpenAI's limits.
- `format` → exact MIME via `SPEECH_FORMAT_TO_MIME`. `pcm` maps to
  `application/octet-stream` (not `audio/L16`, whose RFC definition is big-endian
  while OpenAI returns signed-16-bit little-endian); the real contract is carried
  in `SpeechResult.pcm = { sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 }`.
- Cost: per-character where "character" = Unicode code points (`[...text].length`),
  gated on `perCharacterCost !== undefined`.

## Audio-in-chat: the `AudioPart` pipeline

`audioPart(source, { filename? })` adds audio to a user message. `AudioPart.source`
is a `BlobRef` (**no `providerFile`** — Chat `input_audio` has no `file_id`/URL
form), which also makes it structurally impossible for an audio part to reach the
provider-file/URL passthrough branches in attachment resolution.

End-to-end, an audio part passes through these stages before hitting the wire:

1. **Modality gate** — `validateModalities()` (`lib/util/modalities.ts`), run inside
   `BaseClient.prepareAttachments` before both sync and stream serialize. The audio
   arm is **positive and provider-aware**: it resolves the effective provider,
   requires `provider === "openai"` (rejecting `openai-responses`, Google,
   Anthropic, Ollama, and custom providers), then requires the
   `getModelForProvider(provider, model, modelData)`-keyed model to list `"audio"`
   in `modalities.input`. The check is `!== true`, so an unknown/unannotated model
   fails closed. Only `gpt-audio-1.5` qualifies in v1.
2. **Attachment resolution** — `resolveMessageAttachments()`
   (`lib/clients/resolveAttachments.ts`) normalizes the source to inline base64
   (`normalizeImageRef` with `allowedMimePrefixes: ["audio/"]` + the byte cap) and
   rejects non-mp3/wav here (`chatAudioFormat(mime) === null` → `Failure`) so the
   failure surfaces as a `Result`, not a thrown renderer error.
3. **Rendering** — `OpenAIChatRenderer.audio()` emits
   `{ type: "input_audio", input_audio: { data: <base64>, format: "mp3"|"wav" } }`.

Because the failing gates run during preparation, `textSync()` returns a `Failure`
and `textStream()` emits an `error` chunk — never an uncaught throw.

### Renderer totality

Adding an arm to the `UserContentPart` union means every renderer must handle it or
TypeScript's exhaustiveness breaks. `renderParts` dispatches `type === "audio"` to
`PartRenderer.audio()`. `OpenAIChatRenderer` produces `input_audio`; `JSONRenderer`
base64-round-trips (so messages survive `toJSON`/`fromJSON`); `OpenAIResponses`,
`Google`, and `Anthropic` renderers implement a **defensive throwing** `audio()`
(unreachable in normal flow because the gates reject first); `UserMessage`'s
hand-written Ollama loop throws for audio. This is why the content-part type and all
renderer implementations landed in **one atomic commit** — a partial commit would
not typecheck.

## Audio-token cost accounting

Audio tokens are far more expensive than text (for `gpt-audio-1.5`, ~$32 vs
~$2.50 per 1M input). The pre-existing cost path priced everything at text rates and
ignored the `*AudioTokenCost` fields, so this had to be built out:

- `TokenUsage` gains `inputAudioTokens?` / `outputAudioTokens?` (type, Zod schema,
  and `addTokenUsage`).
- `lib/clients/openai.ts` `calculateUsageAndCost()` — the single method both the
  sync and stream paths call — parses `prompt_tokens_details.audio_tokens` and
  `completion_tokens_details.audio_tokens`, subtracting them (and cached tokens)
  from the text buckets so the four buckets are disjoint.
- `Model.calculateCost()` prices four disjoint buckets (text in/out at
  `inputTokenCost`/`outputTokenCost`, audio in/out at
  `inputAudioTokenCost`/`outputAudioTokenCost`). If an audio rate is missing but
  audio tokens are present, they fall back to the text rate rather than being
  dropped, so the total stays honest.

## Provider-aware model lookup

`getModelForProvider(provider, modelName, modelData?)` (`lib/models.ts`) matches on
**both** provider and name, unlike the name-only `getModel`. This prevents an
explicit provider override from inheriting a same-named model's pricing/modality
data from a different provider.

`Model.calculateCost` uses it whenever `this.provider` is set. To make that provider
available, `getClient()` injects the **resolved** provider into `clientConfig`, and
every client constructs its `Model` from `config.provider`. This matters for
*inferred* OpenAI-compatible providers: if `modelData` declares a model under
`litellm` and the caller omits `provider`, `getClient()` returns `SmolLiteLlm`, and
the `Model` must be keyed `litellm:<name>` (not `openai:<name>`) or streaming — which
has no provider cost header — would silently return no cost.

## Exception boundary & secret redaction

`transcribe()` and `speak()` are the **single** redacting + logging boundary. The
OpenAI adapters (`openaiTranscribe`, `openaiSpeak`) deliberately do **not**
try/catch SDK errors — the public function wraps provider resolution, input loading,
and the `await`ed provider dispatch in one try/catch. On a caught throw it calls
`getLogger().error(...)` with a `redactSecret(message, apiKey)`-scrubbed message and
returns the same redacted text as a `Failure`.

Two correctness points that are easy to get wrong:

- **`await` the dispatched provider call inside the try.** Returning the promise
  unawaited lets a rejection escape the boundary.
- **Redact with the *resolved* provider's key**, not `opts.provider ?? "openai"`.
  Resolve the provider first, then compute the redaction key from it — otherwise a
  custom/inferred provider's secret can slip past `redactSecret` and leak into the
  log and the `Failure`.

Expected preflight failures (unsupported model/MIME, missing key, over-limit input)
return a `Failure` directly and are **not** logged.

## Extension points (custom providers)

`registerTranscriptionProvider(name, impl)` and `registerSpeechProvider(name, impl)`
add providers keyed by name; built-ins win, custom registrations are the fallback
for unknown provider names. A provider receives a context carrying the resolved API
key (with the caller `apiKey` stripped from the options) plus the request options.

Custom-provider keys go through the same `resolveApiKey`: `SmolConfig.apiKey` carries
an index signature (`[provider: string]?: string`) alongside the named aliases, and
`resolveApiKey`'s default branch returns `apiKey?.[provider]`, so
`registerSpeechProvider("acme", …)` receives `apiKey.acme`. Built-in provider aliases
(e.g. `openAi` → `openai`) and their env fallbacks are unchanged.

## MIME contracts

Three distinct surfaces, all in `lib/util/audioMime.ts`:

- **Transcription upload** (`transcriptionAudioType(mime) → { extension, filename }
  | null`): FLAC, MP3, MP4 (incl. `video/mp4`), M4A, OGG, WAV, WebM. Returns the
  canonical extension/filename for the multipart upload; `null` for unsupported.
- **Chat `input_audio`** (`chatAudioFormat(mime) → "mp3" | "wav" | null`): only
  those two, per the OpenAI Chat contract.
- **Speech output** (`SPEECH_FORMAT_TO_MIME`): the six `speak()` formats → exact
  output MIME.

All lookups **canonicalize** first — `split(";")[0].trim().toLowerCase()` — so
parameterized values like `audio/webm;codecs=opus` (MediaRecorder) and
`audio/wav; codecs=1` resolve correctly.

## Registry / seed data

`data/model-data.json` is generated from `lib/models.ts` by
`scripts/seed-model-data.ts` (it spreads the model arrays; it fetches nothing) and
is published for `refreshModels()` to consume. It is derived data — regenerate it
with the seed script after changing the model catalog rather than editing it by
hand. `tests/seed-model-data.test.ts` validates `buildSeedBlob()` output, not the
committed file.

## Testing patterns

- **Provider adapters** (`lib/transcription/openai.test.ts`,
  `lib/speech/openai.test.ts`) use `vi.mock("openai")` — the adapters instantiate
  the SDK directly, so a module mock is the clean seam. Assert the exact request
  shape (`toFile` filename/type, `response_format`, `timestamp_granularities`,
  voice/format/speed) and that preflight rejections never call the SDK.
- **Audio-in-chat end-to-end** (`lib/clients/openai.audioChat.test.ts`) drives the
  **public** `textSync()` / consumed `textStream()` with a full `vi.mock("openai")`
  that reproduces the client's real SDK usage — sync `.withResponse()` returning
  `{ data, response }`, and the stream as an async iterable with usage on the final
  chunk. Getting the mock shape wrong makes the test pass without exercising the
  real serialization/usage code, so mirror `lib/clients/openai.ts` exactly.
- **Cost math** injects rates via `satisfies ModelDataBlob` fixtures and asserts
  exact numbers (not `> 0`), including 0-rate and mixed text+audio cases.
- Cost tests confirm sync/stream parity by asserting the `done` chunk's
  `result.usage`/`.cost` deep-equal the `textSync` result (both flow through the one
  `calculateUsageAndCost`).
