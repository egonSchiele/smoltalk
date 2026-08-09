import { audioFormatForMime, canonicalizeMime } from "./mime.js";

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

// Object.hasOwn (not `in`) so prototype keys like "toString"/"__proto__"
// never pass the guard.
export function isSpeakFormat(value: string): value is SpeakFormat {
  return Object.hasOwn(SPEECH_FORMAT_TO_MIME, value);
}

/**
 * Translate a canonical/alias audio MIME to the wire value Google expects.
 * Google documents MP3 as `audio/mp3`, whereas this repo canonicalizes it to
 * `audio/mpeg`; everything else passes through canonicalized.
 */
export function googleAudioWireMime(mimeType: string): string {
  const format = audioFormatForMime(mimeType);
  const canonical = format?.mimeType ?? canonicalizeMime(mimeType);
  return canonical === "audio/mpeg" ? "audio/mp3" : canonical;
}

export type PcmWavOptions = {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
};

/**
 * Wrap raw signed-integer little-endian PCM in a 44-byte RIFF/WAVE header so it
 * becomes a directly-playable .wav. Pure function, no dependency. Used for
 * Gemini TTS output, which is only ever raw PCM.
 */
export function pcmToWav(pcm: Uint8Array, opts: PcmWavOptions): Uint8Array {
  const { sampleRateHz, channels, bitsPerSample } = opts;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRateHz * blockAlign;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
