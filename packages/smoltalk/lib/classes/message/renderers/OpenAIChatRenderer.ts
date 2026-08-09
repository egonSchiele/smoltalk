import type { PartRenderer } from "./PartRenderer.js";
import type { TextPart, ImagePart, FilePart, AudioPart } from "../contentParts.js";
import { refToBase64, toDataUri, openAiImageUrl, attachmentFilename } from "../../../util/attachments.js";
import { chatAudioFormat } from "../../../util/audioMime.js";
import type { BlobRef } from "../../../util/imageRef.js";

/**
 * `AudioPart` whose source has already been resolved to base64. `resolveMessageAttachments`
 * (via `BaseClient.prepareAttachments`) is the only producer of prepared audio; this renderer
 * requires it as a precondition and never resolves bytes/path/url itself.
 */
type PreparedAudioPart = AudioPart & {
  source: Extract<BlobRef, { kind: "base64" }>;
};

function requirePreparedAudioPart(part: AudioPart): PreparedAudioPart {
  if (part.source.kind !== "base64") {
    throw new Error("internal: audio source must be prepared as base64 before rendering");
  }
  return part as PreparedAudioPart;
}

/** Renders parts for the OpenAI Chat Completions API. */
export class OpenAIChatRenderer implements PartRenderer<any> {
  text(part: TextPart) {
    return { type: "text", text: part.text };
  }

  image(part: ImagePart) {
    if (part.source.kind === "providerFile") {
      throw new Error(
        "OpenAI Chat Completions cannot reference an image by file id; use the openai-responses provider or inline the image.",
      );
    }
    return { type: "image_url", image_url: { url: openAiImageUrl(part.source) } };
  }

  file(part: FilePart) {
    if (part.source.kind === "providerFile") {
      return { type: "file", file: { file_id: part.source.id } };
    }
    const { base64, mimeType } = refToBase64(part.source);
    return { type: "file", file: { file_data: toDataUri(base64, mimeType), filename: attachmentFilename(part.filename) } };
  }

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
}
