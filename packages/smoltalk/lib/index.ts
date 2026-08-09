export * from "./client.js";
export * from "./types.js";
export * from "./models.js";
export * from "./modelData.js";
export * from "./model.js";
export * from "./smolError.js";
export * from "./util/util.js";
export * from "./util/tool.js";
export * from "./classes/message/index.js";
export * from "./functions.js";
export * from "./classes/ToolCall.js";
export * from "./embed.js";
export * from "./image.js";
// Explicit (not `export *`) so the test-only `_resetForTests` stays off the public surface.
export { uploadFile, deleteFile, registerFileProvider, DEFAULT_UPLOAD_BYTES } from "./files.js";
export type { UploadFileOptions, FileProviderContext, FileProvider } from "./files.js";
export { normalizeBlob, loadBlob } from "./util/blobRef.js";
export type { BlobRef } from "./util/blobRef.js";
export { getLogger, EgonLog } from "./util/logger.js";
export type { LogLevel } from "./util/logger.js";
export { redactAttachments } from "./util/redact.js";
// Explicit (not `export *`) so the test-only `_resetForTests` stays off the public surface.
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
// Explicit (not `export *`) so the test-only `_resetForTests` stays off the public surface.
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
