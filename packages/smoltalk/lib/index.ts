export * from "./client.js";
export * from "./types.js";
export * from "./models.js";
export * from "./modelData.js";
export * from "./modelRefresh.js";
export * from "./model.js";
export * from "./smolError.js";
export * from "./util/util.js";
export * from "./util/tool.js";
export * from "./classes/message/index.js";
export * from "./functions.js";
// Explicit (not `export *`) so the test-only `_setImportForTests` stays off the public surface.
export { loadLlamaCpp } from "./clients/llamaCppLoader.js";
export type { LlamaCppModule } from "./clients/llamaCppLoader.js";
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
// Explicit (not `export *`) so internal factories and test helpers stay private.
export {
  speak,
  registerSpeechProvider,
} from "./speech.js";
export type {
  SpeakOptions,
  PcmAudioMetadata,
  SpeechResult,
  SpeechClientClass,
} from "./speech.js";
export { BaseSpeechClient } from "./speech/baseSpeechClient.js";
export type { SpeechClientConfig } from "./speech/baseSpeechClient.js";
