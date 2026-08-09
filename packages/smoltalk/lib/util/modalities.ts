import { UserMessage, Message } from "../classes/message/index.js";

/** Modalities a model must positively declare in its data block — for these,
 *  "unknown" means "unsupported" (audio serialization is model-specific). */
export const MODALITIES_REQUIRING_DECLARATION: ReadonlySet<string> = new Set(["audio"]);

/** Which non-text input modalities the user messages actually use. */
export function neededInputModalities(messages: Message[]): string[] {
  const needed = new Set<string>();
  for (const msg of messages) {
    if (!(msg instanceof UserMessage)) {
      continue;
    }
    const parts = msg.getContentParts();
    if (parts === null) {
      continue;
    }
    for (const part of parts) {
      if (part.type === "image") {
        needed.add("image");
      }
      if (part.type === "file") {
        needed.add("pdf");
      }
      if (part.type === "audio") {
        needed.add("audio");
      }
    }
  }
  return [...needed];
}
