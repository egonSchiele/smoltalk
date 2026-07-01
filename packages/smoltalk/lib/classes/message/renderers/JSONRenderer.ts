import type { PartRenderer } from "./PartRenderer.js";
import type { TextPart, ImagePart, FilePart, UserContentPart, AttachmentSource } from "../contentParts.js";
import { refToBase64 } from "../../../util/attachments.js";

/** In-memory `bytes` don't survive JSON, so materialize them as base64; other sources pass through. */
function bytesToBase64(source: AttachmentSource): AttachmentSource {
  if (source.kind === "bytes") {
    const { base64, mimeType } = refToBase64(source);
    return { kind: "base64", base64, mimeType };
  }
  return source;
}

/** Renders parts back to a JSON-safe UserContentPart (for toJSON serialization). */
export class JSONRenderer implements PartRenderer<UserContentPart> {
  text(part: TextPart): UserContentPart {
    return part;
  }

  image(part: ImagePart): UserContentPart {
    return { type: "image", source: bytesToBase64(part.source) };
  }

  file(part: FilePart): UserContentPart {
    return { type: "file", source: bytesToBase64(part.source), filename: part.filename };
  }
}
