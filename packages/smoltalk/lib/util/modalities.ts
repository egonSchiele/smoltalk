import { UserMessage } from "../classes/message/index.js";
import { getModelForProvider, modelSupportsInputModality } from "../models.js";
import { PromptResult, Result, SmolConfig, failure } from "../types.js";
import { resolveProvider } from "./provider.js";

export function validateModalities(config: SmolConfig): Result<PromptResult> | null {
  let needsImage = false;
  let needsPdf = false;
  let needsAudio = false;

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
      if (part.type === "audio") {
        needsAudio = true;
      }
    }
  }

  if (needsImage && modelSupportsInputModality(config.model, "image", config.modelData) === false) {
    return failure(`Model ${config.model} does not support image input.`);
  }
  if (needsPdf && modelSupportsInputModality(config.model, "pdf", config.modelData) === false) {
    return failure(`Model ${config.model} does not support PDF/document input.`);
  }

  if (needsAudio) {
    let provider: string;
    try {
      provider = resolveProvider(config.model, config.provider, config.modelData);
    } catch (err) {
      const detail = err instanceof Error ? err.message : `Model ${config.model} is not recognized`;
      return failure(`${detail}; audio input requires an OpenAI audio chat model.`);
    }
    if (provider !== "openai") {
      return failure(`Audio input is only supported on the "openai" provider in v1 (got "${provider}").`);
    }
    const model = getModelForProvider(provider, config.model, config.modelData);
    const inputs = model && model.type === "text" ? model.modalities?.input : undefined;
    if (!inputs || !inputs.includes("audio")) {
      return failure(`Model ${config.model} does not support audio input.`);
    }
  }

  return null;
}
