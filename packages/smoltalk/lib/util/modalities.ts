import { UserMessage } from "../classes/message/index.js";
import { modelSupportsInputModality } from "../models.js";
import { PromptResult, Result, SmolConfig, failure } from "../types.js";

export function validateModalities(config: SmolConfig): Result<PromptResult> | null {
  let needsImage = false;
  let needsPdf = false;

  for (const msg of config.messages) {
    if (!(msg instanceof UserMessage)) {
      continue;
    }
    const parts = msg.getContentParts();
    if (parts === null) {
      continue;
    }
    for (const part of parts) {
      if (part.type === "image") {
        needsImage = true;
      }
      if (part.type === "file") {
        needsPdf = true;
      }
    }
  }

  if (needsImage && modelSupportsInputModality(config.model, "image", config.modelData) === false) {
    return failure(`Model ${config.model} does not support image input.`);
  }
  if (needsPdf && modelSupportsInputModality(config.model, "pdf", config.modelData) === false) {
    return failure(`Model ${config.model} does not support PDF/document input.`);
  }
  return null;
}
