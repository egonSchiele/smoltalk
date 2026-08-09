import type { TextPart, ImagePart, FilePart, AudioPart, UserContentPart } from "../contentParts.js";

/**
 * A per-provider renderer for user-content parts. Each provider implements one
 * of these (one class per file, in this directory) so the message class stays
 * thin: the serializer picks a renderer and walks the parts with {@link renderParts}.
 * `text`/`image`/`file`/`audio` return that provider's native representation of a part.
 */
export interface PartRenderer<T> {
  text(part: TextPart): T;
  image(part: ImagePart): T;
  file(part: FilePart): T;
  audio(part: AudioPart): T;
}

/** Walk content parts, dispatching each to the renderer's matching method. */
export function renderParts<T>(parts: UserContentPart[], renderer: PartRenderer<T>): T[] {
  const out: T[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      out.push(renderer.text(part));
    } else if (part.type === "image") {
      out.push(renderer.image(part));
    } else if (part.type === "audio") {
      out.push(renderer.audio(part));
    } else {
      out.push(renderer.file(part));
    }
  }
  return out;
}
