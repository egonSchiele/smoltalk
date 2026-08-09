# Audio: STT, TTS & Audio-in-Chat (developer notes)

Development details for the audio features in `packages/smoltalk`: speech-to-text
(`transcribe`), text-to-speech (`speak`), and audio-in-chat (`AudioPart`). This is
the "how it fits together" companion to the user-facing section in
`packages/smoltalk/README.md` and the design spec in
`docs/superpowers/specs/2026-08-08-audio-stt-tts-design.md`.

## Scope

STT (`transcribe`) and TTS (`speak`) now cover three providers:

- **OpenAI** — dedicated `/audio/transcriptions` and `/audio/speech` endpoints.
- **Groq** — the same OpenAI-compatible endpoints at a different base URL
  (Whisper `large-v3`/`-turbo` for STT; `canopylabs/orpheus-*` for TTS).
- **Google Gemini** — native multimodal `generateContent` (no dedicated audio
  endpoints): STT sends inline audio + an instruction; TTS requests an `AUDIO`
  response modality and returns raw PCM (optionally WAV-wrapped).

Anthropic, OpenRouter, and Ollama have no audio endpoints and still return a
`Failure`. Deferred to follow-ups: streaming STT/TTS, the token-priced GPT
dedicated audio endpoint models (`gpt-4o-transcribe`, `gpt-4o-mini-tts`, …),
Gemini transcription timestamps and multi-speaker TTS, the Gemini Files API for
large audio (inline-only today), assistant audio *output*, speech translation,
an SSRF guard for URL sources, and voice discovery.

## Provider shapes

Two architectural shapes sit behind the one declarative `transcribe()`/`speak()`
surface:

- **OpenAI-compatible (Groq + generic).** `OpenAITranscriptionClient`/
  `OpenAISpeechClient` expose two protected hooks: `makeClient()` (base URL) and
  `defaultFormat()` (the format used when the call omits one).
  `GroqTranscriptionClient`/`GroqSpeechClient` override only these — Groq points at
  `https://api.groq.com/openai/v1` and defaults TTS output to `wav`. For any other
  OpenAI-shaped endpoint, `OpenAiCompatTranscriptionClient`/`OpenAiCompatSpeechClient`
  (registered under `"openai-compat"`) resolve the base URL from
  `config.baseUrl.openAiCompat` / `OPENAI_COMPAT_BASE_URL` (and the key from
  `config.apiKey.openAiCompat` / `OPENAI_COMPAT_API_KEY`) via the shared
  `resolveBaseUrl`/`resolveApiKey`, mirroring the chat `SmolOpenAiCompat` client;
  a missing base URL fails clearly through the base's redacting boundary. To carry
  the base URL, `TranscribeOptions`/`SpeakOptions` (and the client configs) gained
  an optional `baseUrl` map. Everything else (request shaping, response mapping) is
  inherited, so no transport detail leaks into the caller-facing API.
- **Gemini native multimodal.** `GoogleTranscriptionClient._transcribe` sends
  `{ inlineData, text: instruction }` and reads `res.text`; `opts.language` is
  folded into the instruction, and `timestampGranularity` is rejected (Gemini
  can't do it). It enforces Gemini's **20 MB total-request** limit by checking
  the encoded request size before dispatch — a transport-envelope concern kept
  inside the client, distinct from the model record's conservative raw
  `maxBytes`. `GoogleSpeechClient._speak` requests `responseModalities:
  ["AUDIO"]` + a `speechConfig` voice, returns raw PCM (24 kHz s16le mono) by
  default, wraps it via `pcmToWav` when `format: "wav"`, and rejects `speed`
  (Gemini has no numeric speed control) and non-PCM/WAV formats.

The B1 STT guard accepts a model that is either a dedicated `speech-to-text`
model **or** a multimodal text model whose `modalities.input` includes `"audio"`
— reusing the existing `modelSupportsInputModality` query rather than a new
predicate, so Gemini's `gemini-2.5-flash` is a valid transcription target.
Unknown models still flow through (provider is authority).

Cost: OpenAI/Groq price per-minute (STT) / per-character (TTS) via
`calculateTranscriptionCost`/`calculateSpeechCost`. Gemini is token-billed, so
the base clients fall back to the shared `Model.calculateCost()` four-bucket
engine when the result carries `usage` and per-minute/per-char pricing returns
nothing. Audio-token rates (`inputAudioTokenCost`/`outputAudioTokenCost`) live on
`BaseModel`, and `Model.calculateCost()` prices any text or text-to-speech model
carrying token rates (image/embeddings keep their own paths). Gemini usage is
normalized once by the shared `normalizeGoogleAudioUsage` helper
(`lib/googleAudioUsage.ts`), which splits the audio-modality token bucket out of
prompt (STT) or candidate (TTS) tokens.

## Architecture: declarative operations over class-based providers

STT and TTS mirror text generation's architecture exactly, one layer per
responsibility:

- **Public operations** — `transcribe(source, opts)` and `speak(text, opts)`
  express intent. They are thin wrappers, always return `Result<T>`, and are
  the only package-root call surface.
- **Internal factories** — `getTranscriptionClient()` / `getSpeechClient()`
  (module exports of `lib/transcription.ts` / `lib/speech.ts`, deliberately
  *not* re-exported from `lib/index.ts`) own lifecycle: resolve the provider,
  resolve the API key, pick the client class (built-ins first, then the
  registry), strip the caller's `apiKey` map, and construct the client. The
  factory itself is a redacting exception boundary — a throwing custom
  constructor becomes a `Failure` with the resolved key scrubbed.
- **Base template methods** — `BaseTranscriptionClient.transcribe()` and
  `BaseSpeechClient.speak()` own everything shared: blob loading, runtime
  validation of the model's declarative constraint block, cost attachment, and
  the single redacting/logging exception boundary around the provider call.
- **Provider subclasses** — `OpenAITranscriptionClient._transcribe()` /
  `OpenAISpeechClient._speak()` are only the SDK call + response mapping. They
  do not try/catch (the base is the boundary) and do not compute cost.
- **Model records** — constraints are data in `lib/models.ts`, not code:
  `SpeechToTextModel` declares `supportedMimeTypes` (canonical values only)
  and `maxBytes`; `TextToSpeechModel` declares `maxInputChars`, `speedRange`,
  and `formats`. The base clients validate the block's shape before consuming
  it (malformed model data → `Failure`, not a crash) and then enforce it.
  A model with no registry entry skips validation — the provider is then the
  authority, matching how cost is silently omitted for unknown models.

Chat (`SmolClient` → `text/textSync/textStream`) is untouched; `getClient()`
still rejects non-text models. Audio-*in-chat* rides the existing text
pipeline (see below).

## Files

```
lib/transcription.ts                      transcribe() + registry + internal factory
lib/transcription/baseTranscriptionClient.ts  BaseTranscriptionClient template method
lib/transcription/openai.ts               OpenAITranscriptionClient — whisper-1
lib/speech.ts                             speak() + registry + internal factory
lib/speech/baseSpeechClient.ts            BaseSpeechClient template method
lib/speech/openai.ts                      OpenAISpeechClient — tts-1 / tts-1-hd
lib/util/mime.ts                          AUDIO_FORMATS — the single ext↔MIME source
lib/util/audioMime.ts                     format derivations over AUDIO_FORMATS
lib/util/blobRef.ts                       BlobRef + loadBlob/normalizeBlob (ex-imageRef)
lib/classes/message/contentParts.ts       AudioPart type + schema
lib/classes/message/index.ts              audioPart() helper
lib/classes/message/renderers/*           audio() on every PartRenderer
lib/clients/resolveAttachments.ts         per-part resolvers; audio → inline base64
lib/clients/baseClient.ts                 attachmentCapabilities() + modality gate
lib/util/modalities.ts                    neededInputModalities() collector
lib/types/tokenUsage.ts + lib/model.ts + lib/clients/openai.ts   audio-token cost
lib/models.ts                             whisper-1, tts-1/-hd, gpt-audio-1.5 + constraints
```

## `transcribe()` — speech-to-text

`transcribe(source: BlobRef, opts): Promise<Result<TranscriptionResult>>`.

- Input is a `BlobRef` (`bytes | base64 | path | url`) loaded via the shared
  `loadBlob` in `lib/util/blobRef.ts` — same SSRF caveat as file uploads.
- **Size cap:** the effective limit is the *minimum* of the caller's
  `opts.maxBytes` (a safety limit, validated as a positive finite number) and
  the model's declared `maxBytes` (the provider's hard cap — a caller can
  tighten it but never bypass it), defaulting to `DEFAULT_TRANSCRIBE_BYTES`
  (25 MB) when neither is present.
- **MIME allowlist:** model records carry *canonical* MIME values only
  (`audio/mpeg`, `audio/wav`, …). The base normalizes the incoming MIME
  through `AUDIO_FORMATS` aliases (`audio/mp3`, `audio/x-wav`, `video/mp4`,
  `;codecs=` parameters, case) before checking, so aliases live in exactly one
  place.
- There is no code-level model allowlist anymore: the registry entry (baked-in
  or injected via `registerModelData`/`config.modelData`) *is* the allowlist,
  keyed `provider:modelName` via `getModelForProvider`.
- The OpenAI subclass requests `response_format: "verbose_json"` (needed for
  both `duration` → cost and timestamps) and forwards
  `timestamp_granularities` when `timestampGranularity` is set. `"segment"`
  fills `segments`; `"word"` fills `words`. The multipart filename is derived
  from the normalized MIME — it is an OpenAI upload detail, not part of the
  public options.
- Cost: computed by the base via `calculateTranscriptionCost(model,
  durationSeconds)` (`lib/model.ts`) — `inputCost = (durationSeconds/60) *
  perMinuteCost`, gated on `!== undefined` (a `0` rate reports a present zero
  cost, not omitted).

## `speak()` — text-to-speech

`speak(text: string, opts): Promise<Result<SpeechResult>>`.

- All limits come from the model record and are enforced by the base:
  `maxInputChars` (Unicode **code points**, `[...text].length`), `speedRange`,
  and `formats`. Custom providers with unregistered models are never subjected
  to another provider's limits.
- `format` is a plain `string` in the shared contract (a custom provider can
  expose e.g. `"mulaw"`). The OpenAI subclass narrows to its closed
  `SpeakFormat` union at runtime via `isSpeakFormat()` — an `Object.hasOwn`
  guard, so prototype keys like `"toString"`/`"__proto__"` can't pass — before
  indexing `SPEECH_FORMAT_TO_MIME`.
- `pcm` maps to `application/octet-stream` (not `audio/L16`, whose RFC
  definition is big-endian while OpenAI returns signed-16-bit little-endian);
  the real contract is carried in `SpeechResult.pcm` (for OpenAI:
  `{ sampleRateHz: 24000, sampleFormat: "s16le", channels: 1 }`). The type is
  provider-neutral (`number`/`string` fields), not OpenAI literals.
- Cost: `calculateSpeechCost(model, codePoints)` in `lib/model.ts`, same
  `!== undefined` gating as transcription.

## Audio-in-chat: the `AudioPart` pipeline

`audioPart(source, { filename? })` adds audio to a user message. `AudioPart.source`
is a `BlobRef` (**no `providerFile`** — Chat `input_audio` has no `file_id`/URL
form), which also makes it structurally impossible for an audio part to reach the
provider-file/URL passthrough branches in attachment resolution.

End-to-end, an audio part passes through these stages before hitting the wire:

1. **Client capability gate** — each `BaseClient` subclass declares
   `attachmentCapabilities(): { inputModalities, audioFormats }`. Audio support
   is *solely* a non-empty `audioFormats` list (no separate boolean to
   contradict it). `SmolOpenAi` declares `["mp3", "wav"]`; `SmolOpenAiCompat`
   (and thus openrouter/deepinfra/litellm) overrides back to none; every other
   client inherits the audio-less base default. `prepareAttachments` collects
   the needed modalities from the messages (`neededInputModalities`, a
   provider-agnostic collector in `lib/util/modalities.ts`) and rejects any
   the client doesn't declare.
2. **Model modality gate** — still inside `prepareAttachments`:
   `modelSupportsInputModality(model, modality, modelData, provider)` (now
   provider-aware via `getModelForProvider`) must not be `false`, and for
   audio (listed in `MODALITIES_REQUIRING_DECLARATION`) it must be positively
   `true` — an unknown/unannotated model fails closed. Only `gpt-audio-1.5`
   qualifies in v1.
3. **Attachment resolution** — `resolveMessageAttachments()`
   (`lib/clients/resolveAttachments.ts`, split into per-part resolvers)
   normalizes the source to inline base64 (`normalizeBlob` with
   `allowedMimePrefixes: ["audio/"]` + the byte cap) and checks the container
   against the *client's declared* `audioFormats` (threaded through
   `ResolveOptions`) so the failure surfaces as a `Result`, not a thrown
   renderer error. A custom client that declares `["flac"]` accepts FLAC here.
4. **Rendering** — `OpenAIChatRenderer.audio()` emits
   `{ type: "input_audio", input_audio: { data: <base64>, format: "mp3"|"wav" } }`
   (via `chatAudioFormat`, which survives for this wire-format derivation).

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

## Exception boundaries & secret redaction

There are exactly two redacting boundaries per capability, and nothing else
catches:

- **The base template method** (`BaseTranscriptionClient.transcribe()` /
  `BaseSpeechClient.speak()`) wraps loading, validation, and the `await`ed
  `_transcribe`/`_speak` call. On a caught throw it logs
  `redactSecret(message, this.config.apiKey)` and returns the same redacted
  text as a `Failure`. Subclasses deliberately do **not** try/catch.
- **The internal factory** (`getTranscriptionClient` / `getSpeechClient`)
  wraps provider resolution, class lookup, key resolution, and
  `new ClientClass(config)` — a throwing custom *constructor* also becomes a
  redacted `Failure` rather than escaping the public `Result` contract.

Two correctness points that are easy to get wrong:

- **`await` the provider call inside the try.** Returning the promise
  unawaited lets a rejection escape the boundary.
- **Redact with the *resolved* provider's key.** The config's `apiKey` is
  resolved from the resolved provider before construction, so a
  custom/inferred provider's secret can't slip past `redactSecret`.

Expected preflight failures (wrong capability, unsupported MIME, missing key,
over-limit input, malformed constraint blocks) return a `Failure` directly and
are **not** logged.

## Extension points (custom providers)

`registerTranscriptionProvider(name, ClientClass)` and
`registerSpeechProvider(name, ClientClass)` register **classes** extending
`BaseTranscriptionClient` / `BaseSpeechClient` — same shape as
`registerProvider(name, ClientClass)` for text. Built-ins win; the registry is
the fallback for unknown provider names. A subclass sees its fully resolved
`this.config` (`provider`, `apiKey`, model, options — with the caller's
`apiKey` *map* stripped) and implements only the SDK mapping hook.

Custom-provider keys go through the same `resolveApiKey`: `SmolConfig.apiKey`
(and `EmbedConfig.apiKey`) carry an index signature
(`[provider: string]?: string`) alongside the named aliases, and
`resolveApiKey`'s default branch returns `apiKey?.[provider]`, so
`registerSpeechProvider("acme", …)` receives `apiKey.acme`. Built-in provider
aliases (e.g. `openAi` → `openai`) and their env fallbacks are unchanged.

Custom model constraints ride in as data: register the model under your
provider name via `registerModelData` (global) or `config.modelData`
(per-call) with whatever `maxBytes`/`supportedMimeTypes`/`maxInputChars`/
`speedRange`/`formats` apply, and the base clients enforce them.

For audio-in-chat, a custom *text* client declares its own audio policy by
overriding `BaseClient.attachmentCapabilities()` — the returned `audioFormats`
both enables audio and states which containers resolve.

## MIME contracts

`lib/util/mime.ts` is the single source of ext↔MIME truth: `AUDIO_FORMATS`
maps each container to its primary extension, canonical MIME, alias MIMEs
(`audio/mp3`, `audio/x-wav`, `video/mp4`, …), and alias extensions. Everything
else derives from it:

- `EXT_TO_MIME` (path-based inference in `blobRef.ts`) is built from
  `AUDIO_FORMATS` plus the image/PDF entries — the forward and inverse maps
  cannot drift.
- `audioFormatForMime(mime)` canonicalizes (`split(";")[0].trim().toLowerCase()`,
  so `audio/webm;codecs=opus` and `AUDIO/WAV; codecs=1` resolve) and matches
  canonical + alias MIMEs. STT MIME validation and chat-audio format checks
  both normalize through it; model records and capability declarations carry
  canonical values only, never aliases.
- `lib/util/audioMime.ts` layers the audio-specific derivations on top:
  `transcriptionAudioType` (upload filename), `chatAudioFormat` (the
  `input_audio.format` wire field), `SPEECH_FORMAT_TO_MIME` + `isSpeakFormat`
  (OpenAI TTS output formats).

## Registry / seed data

`data/model-data.json` is generated from `lib/models.ts` by
`scripts/seed-model-data.ts` (it spreads the model arrays; it fetches nothing)
and is published for `refreshModels()` to consume. It is derived data —
regenerate it with `pnpm seed-data` after changing the model catalog rather
than editing it by hand. `tests/seed-model-data.test.ts` validates both
`buildSeedBlob()` output **and the committed file**: it reads
`data/model-data.json` and compares every STT/TTS constraint field against the
baked registry, so a stale generated file fails CI instead of silently
disagreeing with the built-ins.

## Testing patterns

- **Provider subclasses** (`lib/transcription/openai.test.ts`,
  `lib/speech/openai.test.ts`) use `vi.mock("openai")` — the subclasses
  instantiate the SDK directly, so a module mock is the clean seam. Tests
  construct the client (`new OpenAITranscriptionClient({...})`) and call the
  public template method; assert the exact request shape (`toFile`
  filename/type, `response_format`, `timestamp_granularities`,
  voice/format/speed) and that preflight rejections never call the SDK.
- **Dispatch/boundary tests** (`lib/transcription.test.ts`, `lib/speech.test.ts`)
  register fake subclasses and drive the public `transcribe()`/`speak()`:
  built-in non-shadowing, resolved-key delivery, throwing constructors and
  provider hooks (one redacted log, no key leakage), maxBytes cap resolution
  (caller-below/caller-above/model-only/global-registry), alias-MIME
  normalization, and malformed constraint blocks.
- **Audio-in-chat end-to-end** (`lib/clients/openai.audioChat.test.ts`) drives the
  **public** `textSync()` / consumed `textStream()` with a full `vi.mock("openai")`
  that reproduces the client's real SDK usage — sync `.withResponse()` returning
  `{ data, response }`, and the stream as an async iterable with usage on the final
  chunk. Getting the mock shape wrong makes the test pass without exercising the
  real serialization/usage code, so mirror `lib/clients/openai.ts` exactly.
- **Capability-gate tests** (`lib/util/modalities*.test.ts`) construct real
  clients via `getClient()` and call `prepareAttachments` directly — no SDK
  mock needed — including a custom `BaseClient` subclass proving a non-OpenAI
  audio policy (FLAC) is honored.
- **Cost math** injects rates via `satisfies ModelDataBlob` fixtures and asserts
  exact numbers (not `> 0`), including 0-rate and mixed text+audio cases.
- Cost tests confirm sync/stream parity by asserting the `done` chunk's
  `result.usage`/`.cost` deep-equal the `textSync` result (both flow through the one
  `calculateUsageAndCost`).
