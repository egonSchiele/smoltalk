import type { PartRenderer } from "./PartRenderer.js";
import type { TextPart, ImagePart, FilePart } from "../contentParts.js";
import { refToBase64, toDataUri, openAiImageUrl, attachmentFilename } from "../../../util/attachments.js";

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
}
