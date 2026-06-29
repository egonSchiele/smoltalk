import type { ModelDataBlob } from "./modelData.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { ImageRef } from "./util/imageRef.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { openaiImage } from "./image/openai.js";
import { googleImage } from "./image/google.js";

export { ImageRef };

export type ImageInput =
  | string
  | {
      prompt: string;
      images?: ImageRef[];
      mask?: ImageRef;
    };

export type ImageConfig = {
  model: string;
  provider?: string;

  // Common knobs (passed when supported, ignored otherwise)
  n?: number;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  outputFormat?: "png" | "jpeg" | "webp";
  background?: "transparent" | "opaque" | "auto";

  // API keys
  openAiApiKey?: string;
  googleApiKey?: string;

  // Provider-specific escape hatch
  metadata?: Record<string, unknown>;

  // Refreshed model data to layer over the baked-in registry.
  modelData?: ModelDataBlob;
};

export type GeneratedImage = {
  data: Uint8Array;
  mimeType: string;
  revisedPrompt?: string;
};

export type ImageGenResult = {
  images: GeneratedImage[];
  model: string;
  tokenUsage?: TokenUsage;
  costEstimate?: CostEstimate;
};

export type ImageProvider = (
  input: ImageInput,
  config: ImageConfig,
) => Promise<Result<ImageGenResult>>;

const registeredImageProviders: Record<string, ImageProvider> = {};

export function registerImageProvider(name: string, fn: ImageProvider): void {
  registeredImageProviders[name] = fn;
}

export async function image(
  input: ImageInput,
  config: ImageConfig,
): Promise<Result<ImageGenResult>> {
  let provider: string;
  try {
    provider = resolveProvider(config.model, config.provider, config.modelData);
  } catch (err) {
    return failure(
      err instanceof Error ? err.message : "Failed to resolve provider",
    );
  }

  const apiKey = resolveApiKey(provider, config);

  // `mask` is only meaningful for OpenAI inpainting. Reject up front so
  // other providers don't silently drop it.
  const hasMask = typeof input !== "string" && !!input.mask;
  if (hasMask && provider !== "openai" && provider !== "openai-responses") {
    return failure(
      `\`mask\` is only supported by the OpenAI image edit endpoint; provider "${provider}" cannot use it.`,
    );
  }

  switch (provider) {
    case "openai":
    case "openai-responses": {
      if (!apiKey) {
        return failure(
          "No OpenAI API key provided. Set openAiApiKey in config or the OPENAI_API_KEY environment variable.",
        );
      }
      return openaiImage(input, config, apiKey);
    }
    case "google": {
      if (!apiKey) {
        return failure(
          "No Google API key provided. Set googleApiKey in config or the GEMINI_API_KEY environment variable.",
        );
      }
      return googleImage(input, config, apiKey);
    }
    default: {
      const custom = registeredImageProviders[provider];
      if (custom) {
        return custom(input, config);
      }
      return failure(
        `Provider "${provider}" does not support image generation. Register one with registerImageProvider(name, fn).`,
      );
    }
  }
}
