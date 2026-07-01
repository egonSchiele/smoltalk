import type { PartRenderer } from "./PartRenderer.js";
import type { TextPart, ImagePart, FilePart } from "../contentParts.js";
import { anthropicSource } from "../../../util/attachments.js";

/** Renders parts for the Anthropic Messages API. */
export class AnthropicRenderer implements PartRenderer<any> {
  text(part: TextPart) {
    return { type: "text", text: part.text };
  }

  image(part: ImagePart) {
    if (part.source.kind === "providerFile") {
      return { type: "image", source: { type: "file", file_id: part.source.id } };
    }
    return { type: "image", source: anthropicSource(part.source) };
  }

  file(part: FilePart) {
    if (part.source.kind === "providerFile") {
      return { type: "document", source: { type: "file", file_id: part.source.id } };
    }
    return { type: "document", source: anthropicSource(part.source) };
  }
}
