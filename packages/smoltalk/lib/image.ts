import type { ModelDataBlob } from "./modelData.js";
import { Result, failure } from "./types/result.js";
import { TokenUsage } from "./types/tokenUsage.js";
import { CostEstimate } from "./types/costEstimate.js";
import { ImageRef } from "./util/imageRef.js";
import { resolveProvider, resolveApiKey } from "./util/provider.js";
import { openaiImage } from "./image/openai.js";
import { googleImage } from "./image/google.js";
import { openaiCompatImage } from "./image/openaiCompat.js";

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

  /** API keys, nested by provider. Falls back to env vars
   *  (OPENAI_API_KEY / GEMINI_API_KEY / LITELLM_API_KEY / OPENAI_COMPAT_API_KEY). */
  apiKey?: {
    openAi?: string;
    google?: string;
    liteLlm?: string;
    openAiCompat?: string;
  };

  /** Custom base URLs, nested by provider. */
  baseUrl?: {
    liteLlm?: string;
    openAiCompat?: string;
  };

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

// Null-prototype so provider names like "toString"/"__proto__" can't collide
// with Object.prototype or pollute the registry.
const registeredImageProviders: Record<string, ImageProvider> =
  Object.create(null);

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
          "No OpenAI API key provided. Set config.apiKey.openAi or the OPENAI_API_KEY environment variable.",
        );
      }
      return openaiImage(input, config, apiKey);
    }
    case "google": {
      if (!apiKey) {
        return failure(
          "No Google API key provided. Set config.apiKey.google or the GEMINI_API_KEY environment variable.",
        );
      }
      return googleImage(input, config, apiKey);
    }
    case "openrouter":
      return failure(
        "openrouter does not expose an OpenAI-compatible images endpoint; use openai-compat or litellm instead.",
      );
    case "deepinfra":
      return failure(
        "deepinfra exposes per-model image endpoints rather than the OpenAI `/images/generations` shape; use openai-compat with a specific backend or litellm instead.",
      );
    case "litellm": {
      if (!apiKey) {
        return failure(
          "No LiteLLM API key provided. Set config.apiKey.liteLlm or the LITELLM_API_KEY environment variable.",
        );
      }
      const baseURL =
        config.baseUrl?.liteLlm || process.env.LITELLM_BASE_URL;
      if (!baseURL) {
        return failure(
          "No LiteLLM base URL provided. Set config.baseUrl.liteLlm or the LITELLM_BASE_URL environment variable.",
        );
      }
      return openaiCompatImage(input, config, apiKey, baseURL);
    }
    case "openai-compat": {
      if (!apiKey) {
        return failure(
          "No openai-compat API key provided. Set config.apiKey.openAiCompat or the OPENAI_COMPAT_API_KEY environment variable.",
        );
      }
      const baseURL =
        config.baseUrl?.openAiCompat || process.env.OPENAI_COMPAT_BASE_URL;
      if (!baseURL) {
        return failure(
          "No openai-compat base URL provided. Set config.baseUrl.openAiCompat or the OPENAI_COMPAT_BASE_URL environment variable.",
        );
      }
      return openaiCompatImage(input, config, apiKey, baseURL);
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
