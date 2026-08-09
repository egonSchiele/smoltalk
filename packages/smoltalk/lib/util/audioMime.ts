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
  "video/mp4": "mp4",
};

export type TranscriptionAudioType = {
  extension: string;
  filename: string;
};

// Strips parameters (e.g. ";codecs=opus") and normalizes case, so MediaRecorder-
// style MIME strings like "audio/webm;codecs=opus" or "AUDIO/MPEG" still match.
function canonicalizeMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function transcriptionAudioType(mime: string): TranscriptionAudioType | null {
  const canonical = canonicalizeMime(mime);
  const extension = TRANSCRIBE_MIME_TO_EXT[canonical];
  if (extension === undefined) {
    return null;
  }
  return { extension, filename: `audio.${extension}` };
}

export function chatAudioFormat(mime: string): "mp3" | "wav" | null {
  const canonical = canonicalizeMime(mime);
  if (canonical === "audio/mpeg" || canonical === "audio/mp3") {
    return "mp3";
  }
  if (canonical === "audio/wav" || canonical === "audio/x-wav") {
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
