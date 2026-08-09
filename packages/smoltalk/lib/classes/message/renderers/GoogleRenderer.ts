import type { PartRenderer } from "./PartRenderer.js";
import type { TextPart, ImagePart, FilePart, AudioPart, AttachmentSource } from "../contentParts.js";
import { refToBase64 } from "../../../util/attachments.js";

/** Renders parts for the Google Gemini API. */
export class GoogleRenderer implements PartRenderer<any> {
  text(part: TextPart) {
    return { text: part.text };
  }

  image(part: ImagePart) {
    return this.sourcePart(part.source);
  }

  file(part: FilePart) {
    return this.sourcePart(part.source);
  }

  audio(_part: AudioPart): any {
    throw new Error("Audio input is not supported for this provider in v1.");
  }

  private sourcePart(source: AttachmentSource) {
    if (source.kind === "providerFile") {
      // `fileData` needs both a uri and a mimeType; a ref missing either (e.g. a
      // hand-deserialized one) would otherwise emit `{ fileUri: undefined }` and
      // fail with a confusing provider error, so reject it clearly here.
      if (!source.uri || !source.mimeType) {
        throw new Error(
          "Google file reference is missing uri/mimeType; re-upload it via uploadFile({ provider: \"google\" }).",
        );
      }
      return { fileData: { fileUri: source.uri, mimeType: source.mimeType } };
    }
    const { base64, mimeType } = refToBase64(source);
    return { inlineData: { mimeType, data: base64 } };
  }
}
