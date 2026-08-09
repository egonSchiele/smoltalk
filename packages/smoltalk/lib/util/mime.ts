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
