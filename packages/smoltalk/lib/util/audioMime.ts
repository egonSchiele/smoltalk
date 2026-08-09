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
