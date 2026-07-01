import type { PartRenderer } from "./PartRenderer.js";
import type { TextPart, ImagePart, FilePart } from "../contentParts.js";
import { refToBase64, toDataUri, openAiImageUrl, attachmentFilename } from "../../../util/attachments.js";

/** Renders parts for the OpenAI Responses API. */
export class OpenAIResponsesRenderer implements PartRenderer<any> {
  text(part: TextPart) {
    return { type: "input_text", text: part.text };
  }

  image(part: ImagePart) {
    if (part.source.kind === "providerFile") {
      return { type: "input_image", file_id: part.source.id };
    }
    return { type: "input_image", image_url: openAiImageUrl(part.source), detail: "auto" };
  }

  file(part: FilePart) {
    if (part.source.kind === "providerFile") {
      return { type: "input_file", file_id: part.source.id };
    }
    if (part.source.kind === "url") {
      return { type: "input_file", file_url: part.source.url };
    }
    const { base64, mimeType } = refToBase64(part.source);
    return { type: "input_file", file_data: toDataUri(base64, mimeType), filename: attachmentFilename(part.filename) };
  }
}
