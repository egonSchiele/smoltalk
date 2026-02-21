import { SmolError } from "./smolError.js";
import { round } from "./util.js";

export type Provider =
  | "local"
  | "ollama"
  | "openai"
  | "openai-responses"
  | "anthropic"
  | "google"
  | "replicate"
  | "modal";

export type BaseModel = {
  modelName: string;
  provider: Provider;
  description?: string;
  // costs per 1M tokens, in dollars
  inputTokenCost?: number;
  cachedInputTokenCost?: number;
  outputTokenCost?: number;
  disabled?: boolean;
  costUnit?: "tokens" | "characters" | "minutes";
};

export type SpeechToTextModel = BaseModel & {
  type: "speech-to-text";
  perMinuteCost?: number;
};

export type ImageModel = BaseModel & {
  type: "image";
  costPerImage?: number;
  outputType?: "FileOutput" | "Array";
};

export type TextModel = BaseModel & {
  type: "text";
  modelName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  outputTokensPerSecond?: number;
};

export type EmbeddingsModel = {
  type: "embeddings";
  modelName: string;

  // costs per 1M tokens, in dollars
  tokenCost?: number;
};

export type Model =
  | SpeechToTextModel
  | TextModel
  | EmbeddingsModel
  | ImageModel;

export const speechToTextModels = [
  { type: "speech-to-text", modelName: "whisper-local", provider: "local" },
  {
    type: "speech-to-text",
    modelName: "whisper-web",
    perMinuteCost: 0.006,
    provider: "openai",
  },
  // not a speech to text model?
  /* {
    type: "speech-to-text",
    modelName: "gpt-4o-audio-preview",
    description:
      "This is a preview release of the GPT-4o Audio models. These models accept audio inputs and outputs, and can be used in the Chat Completions REST API. Learn more. The knowledge cutoff for GPT-4o Audio models is October, 2023.",
    inputTokenCost: 2.5,
    outputTokenCost: 10,
    provider: "openai",
  }, */
] as const;

export const textModels = [
  {
    type: "text",
    modelName: "gpt-4o-mini",
    description:
      "GPT-4o mini (“o” for “omni”) is a fast, affordable small model for focused tasks. It accepts both text and image inputs, and produces text outputs (including Structured Outputs). It is ideal for fine-tuning, and model outputs from a larger model like GPT-4o can be distilled to GPT-4o-mini to produce similar results at lower cost and latency. The knowledge cutoff for GPT-4o-mini models is October, 2023.",
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    inputTokenCost: 0.15,
    cachedInputTokenCost: 0.075,
    outputTokenCost: 0.6,
    outputTokensPerSecond: 65,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-4o",
    description:
      "GPT-4o (“o” for “omni”) is our versatile, high-intelligence flagship model. It accepts both text and image inputs, and produces text outputs (including Structured Outputs). The knowledge cutoff for GPT-4o-mini models is October, 2023.",
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    inputTokenCost: 2.5,
    cachedInputTokenCost: 1.25,
    outputTokenCost: 10,
    outputTokensPerSecond: 143,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "o3",
    description:
      "o3 is a reasoning model that sets a new standard for math, science, coding, visual reasoning tasks, and technical writing. Part of the o-series of reasoning models. The knowledge cutoff for o3 models is October, 2023.",
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 2,
    cachedInputTokenCost: 0.5,
    outputTokenCost: 8,
    outputTokensPerSecond: 94,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "o3-mini",
    description:
      "o3-mini is our most recent small reasoning model, providing high intelligence at the same cost and latency targets of o1-mini. o3-mini also supports key developer features, like Structured Outputs, function calling, Batch API, and more. Like other models in the o-series, it is designed to excel at science, math, and coding tasks.The knowledge cutoff for o3-mini models is October, 2023.",
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 1.1,
    cachedInputTokenCost: 0.55,
    outputTokenCost: 4.4,
    outputTokensPerSecond: 214,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "o4-mini",
    description:
      "Latest small o-series model optimized for fast, effective reasoning with exceptional performance in coding and visual tasks. Knowledge cutoff: June 2024.",
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 1.1,
    cachedInputTokenCost: 0.55,
    outputTokenCost: 4.4,
    outputTokensPerSecond: 135,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "o1",
    description:
      "o1 is a reasoning model designed to excel at complex reasoning tasks including science, math, and coding. The knowledge cutoff for o1 models is October, 2023.",
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 15,
    cachedInputTokenCost: 7.5,
    outputTokenCost: 60,
    outputTokensPerSecond: 100,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-4-turbo",
    description:
      "GPT-4 is an older version of a high-intelligence GPT model, usable in Chat Completions. Learn more in the text generation guide. The knowledge cutoff for the latest GPT-4 Turbo version is December, 2023.",
    maxInputTokens: 128000,
    maxOutputTokens: 4096,
    inputTokenCost: 10,
    outputTokenCost: 30,
    disabled: true,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-4",
    description:
      "GPT-4 is an older version of a high-intelligence GPT model, usable in Chat Completions. Learn more in the text generation guide. The knowledge cutoff for the latest GPT-4 Turbo version is December, 2023.",
    maxInputTokens: 8192,
    maxOutputTokens: 8192,
    inputTokenCost: 30,
    outputTokenCost: 60,
    disabled: true,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-3.5-turbo",
    description:
      "GPT-3.5 Turbo models can understand and generate natural language or code and have been optimized for chat using the Chat Completions API but work well for non-chat tasks as well. gpt-4o-mini should be used in place of gpt-3.5-turbo, as it is cheaper, more capable, multimodal, and just as fast.",
    maxInputTokens: 16385,
    maxOutputTokens: 4096,
    inputTokenCost: 0.5,
    outputTokenCost: 1.5,
    disabled: true,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-4.1",
    description:
      "GPT-4.1 supports up to 1 million tokens of context, representing a significant increase in context window capacity. Ideal for processing large documents and extended conversations.",
    maxInputTokens: 1047576,
    maxOutputTokens: 32768,
    inputTokenCost: 2.5,
    cachedInputTokenCost: 1.25,
    outputTokenCost: 10,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gemini-3-pro-preview",
    description:
      "Strongest Gemini 3 model quality with 1M context window and 64K output. Standard pricing for ≤200k tokens ($2.00 input/$12.00 output), higher rates for >200k tokens ($4.00 input/$18.00 output). Released Nov 2025, currently in preview.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65536,
    inputTokenCost: 2.0,
    outputTokenCost: 12.0,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-3-flash-preview",
    description:
      "Latest Gemini 3 flash model with 1M context window and 64K output. Outperforms 2.5 Pro while being 3x faster. Optimized for agentic workflows and coding. Includes context caching for 90% cost reductions.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65536,
    inputTokenCost: 0.5,
    outputTokenCost: 3.0,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.5-pro",
    description:
      "High-performance Gemini 2.5 model with 2M context window. Adaptive thinking for complex reasoning and coding. Standard pricing for ≤200k tokens ($1.25 input/$10.00 output), higher rates for >200k tokens ($2.50 input/higher output). Batch API: 50% discount.",
    maxInputTokens: 2_097_152,
    maxOutputTokens: 8192,
    inputTokenCost: 1.25,
    outputTokenCost: 10.0,
    outputTokensPerSecond: 175,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.5-flash",
    description:
      "Balanced Gemini 2.5 model with excellent performance-to-cost ratio. Lightning-fast with controllable thinking budgets. 1M context window. Context caching available for up to 75% cost reduction.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.3,
    outputTokenCost: 2.5,
    outputTokensPerSecond: 225,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.5-flash-lite",
    description:
      "Most cost-effective Gemini 2.5 option for high-throughput applications. 1M context window.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.1,
    outputTokenCost: 0.4,
    outputTokensPerSecond: 400,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.0-flash",
    description:
      "Workhorse model for all daily tasks. Strong overall performance and supports real-time streaming Live API. 1M context window. DEPRECATED: Will be shut down on March 31, 2026.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.1,
    outputTokenCost: 0.4,
    outputTokensPerSecond: 213,
    disabled: true,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.0-pro-exp-02-05",
    description:
      "Strongest model quality, especially for code & world knowledge; 2M long context. In private beta.",
    maxInputTokens: 2_097_152,
    maxOutputTokens: 8192,
    inputTokenCost: 0.5,
    outputTokenCost: 1.5,
    disabled: true,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.0-flash-lite",
    description:
      "Cost effective offering to support high throughput. Note: May be deprecated in favor of 2.5-flash-lite.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.075,
    outputTokenCost: 0.3,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-1.5-flash",
    description:
      "Provides speed and efficiency for high-volume, quality, cost-effective apps. Note: prices ~double after the first 128k tokens.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.01875,
    outputTokenCost: 0.075,
    outputTokensPerSecond: 178,
    costUnit: "characters",
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-1.5-pro",
    description:
      "Supports text or chat prompts for a text or code response. Supports long-context understanding up to the maximum input token limit. Also does video?",
    maxInputTokens: 2_097_152,
    maxOutputTokens: 8192,
    inputTokenCost: 0.3125,
    outputTokenCost: 1.25,
    outputTokensPerSecond: 59,
    costUnit: "characters",
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-1.0-pro",
    description:
      "The best performing model for a wide range of text-only tasks.",
    maxInputTokens: 32_760,
    maxOutputTokens: 8192,
    inputTokenCost: 0.125,
    outputTokenCost: 0.375,
    costUnit: "characters",
    provider: "google",
  },
  {
    type: "text",
    modelName: "claude-3-7-sonnet-latest",
    description:
      "Our most intelligent model to date and the first hybrid reasoning model on the market. Claude 3.7 Sonnet shows particularly strong improvements in coding and front-end web development.",
    maxInputTokens: 200_000,
    maxOutputTokens: 8192,
    inputTokenCost: 3,
    outputTokenCost: 15,
    outputTokensPerSecond: 78,
    provider: "anthropic",
  },
  {
    type: "text",
    modelName: "claude-3-5-haiku-latest",
    description: "Our fastest model",
    maxInputTokens: 200_000,
    maxOutputTokens: 8192,
    inputTokenCost: 0.8,
    outputTokenCost: 4,
    outputTokensPerSecond: 66,
    provider: "anthropic",
  },
  /*  {
    type: "text",
    modelName: "llama.cpp",
    maxInputTokens: 4000,
    maxOutputTokens: 4000,
  }, */
  /*  {
    type: "text",
    modelName: "claude-3-opus-20240229",
    maxInputTokens: 4096,
    maxOutputTokens: 4096,
  },
  {
    type: "text",
    modelName: "claude-3-sonnet-20240229",
    maxInputTokens: 4096,
    maxOutputTokens: 4096,
  },
  {
    type: "text",
    modelName: "gemini-pro",
    maxInputTokens: 4096,
    maxOutputTokens: 4096,
  },
  {
    type: "text",
    modelName: "gemini-pro-vision",
    maxInputTokens: 4096,
    maxOutputTokens: 4096,
  }, */
  {
    type: "text",
    modelName: "deepseek-r1:8b",
    description: "Runs via ollama",
    provider: "ollama",
    maxInputTokens: 128000,
    maxOutputTokens: 128000,
  },
  {
    type: "text",
    modelName: "mistral:latest",
    description: "Runs via ollama",
    provider: "ollama",
    maxInputTokens: 128000,
    maxOutputTokens: 128000,
  },
  {
    type: "text",
    modelName: "mistral-adapters-chunk50-iters100",
    description:
      "Fine tuned Mistral 7B model, chunked into parts of 50 chars each, 100 iterations.",
    provider: "local",
    // https://huggingface.co/mistralai/Mistral-7B-v0.1/discussions/104
    maxInputTokens: 8192,
    maxOutputTokens: 8192,
  },
  {
    type: "text",
    modelName: "llama-7b",
    provider: "replicate",
    maxInputTokens: 256,
    maxOutputTokens: 256,
  },
] as const;

export const imageModels = [
  {
    type: "image",
    modelName: "google/imagen-3",
    provider: "replicate",
    costPerImage: 0.05,
  },
  {
    type: "image",
    modelName: "minimax/image-01",
    provider: "replicate",
    costPerImage: 0.01,
    outputType: "Array",
  },
  {
    type: "image",
    modelName: "flux-modal",
    provider: "modal",
    costPerImage: 0.03,
  },
  {
    type: "image",
    modelName: "gpt-image-1",
    provider: "openai",
    // varies: https://platform.openai.com/docs/models/gpt-image-1
    costPerImage: 0.25,
  },
  {
    type: "image",
    modelName: "gemini-2.5-flash-image-preview",
    provider: "google",
    description: "aka nano-banana",
    costPerImage: 0.04,
  },
  {
    type: "image",
    modelName: "gemini-3-pro-image-preview",
    provider: "google",
    description:
      "High-fidelity image generation with reasoning-enhanced composition. Supports legible text rendering, complex multi-turn editing, and character consistency using up to 14 reference inputs.",
    costPerImage: 0.05,
  },
] as const;

export const embeddingsModels = [
  { type: "embeddings", modelName: "text-embedding-3-small", tokenCost: 0.02 },
];

export type TextModelName = (typeof textModels)[number]["modelName"];
export type ImageModelName = (typeof imageModels)[number]["modelName"];
export type SpeechToTextModelName =
  (typeof speechToTextModels)[number]["modelName"];
export type EmbeddingsModelName =
  (typeof embeddingsModels)[number]["modelName"];
export type ModelName = TextModelName | ImageModelName | SpeechToTextModelName;

export function getModel(modelName: ModelName) {
  const allModels = [...textModels, ...imageModels, ...speechToTextModels];
  return allModels.find((model) => model.modelName === modelName);
}

export function isImageModel(model: Model): model is ImageModel {
  return model.type === "image";
}

export function isTextModel(model: Model): model is TextModel {
  return model.type === "text";
}

export function isSpeechToTextModel(model: Model): model is SpeechToTextModel {
  return model.type === "speech-to-text";
}
export function isEmbeddingsModel(model: Model): model is EmbeddingsModel {
  return model.type === "embeddings";
}

export type Optimization = "speed" | "accuracy" | "cost" | "large-context";

export type ModelConfig = {
  optimizeFor: Optimization[];
  providers: Provider[];
};

export function isModelConfig(
  model: ModelName | ModelConfig,
): model is ModelConfig {
  return typeof model === "object" && "optimizeFor" in model;
}

const WEIGHTS: Record<number, number[]> = {
  1: [1],
  2: [0.6, 0.4],
  3: [0.5, 0.3, 0.2],
  4: [0.4, 0.3, 0.2, 0.1],
};

function getRawMetric(
  model: (typeof textModels)[number],
  optimization: Optimization,
): number {
  const m = model as TextModel;
  switch (optimization) {
    case "cost":
      return (m.inputTokenCost ?? 0) + (m.outputTokenCost ?? 0);
    case "speed":
      return m.outputTokensPerSecond ?? 0;
    case "accuracy":
      return (m.inputTokenCost ?? 0) + (m.outputTokenCost ?? 0);
    case "large-context":
      return m.maxInputTokens;
  }
}

function isLowerBetter(optimization: Optimization): boolean {
  return optimization === "cost";
}

export function pickModel(
  config: ModelConfig,
  models: readonly (typeof textModels)[number][] = textModels,
): TextModelName {
  const candidates = models.filter(
    (m) =>
      config.providers.includes(m.provider as Provider) &&
      !("disabled" in m && m.disabled),
  );

  if (candidates.length === 0) {
    throw new SmolError(
      "No models available for providers: " +
        config.providers.join(", ") +
        ". Check that the providers have non-disabled models.",
    );
  }

  if (candidates.length === 1) {
    return candidates[0].modelName as TextModelName;
  }

  const optimizations = config.optimizeFor;
  const weights = WEIGHTS[optimizations.length] ?? WEIGHTS[4]!;

  const scores = new Map<string, number>();
  for (const c of candidates) {
    scores.set(c.modelName, 0);
  }

  for (let i = 0; i < optimizations.length; i++) {
    const opt = optimizations[i];
    const weight = weights[i];
    const rawValues = candidates.map((c) => getRawMetric(c, opt));
    const min = Math.min(...rawValues);
    const max = Math.max(...rawValues);
    const range = max - min;

    for (let j = 0; j < candidates.length; j++) {
      const raw = rawValues[j];
      let normalized: number;
      if (range === 0) {
        normalized = 0;
      } else if (isLowerBetter(opt)) {
        normalized = (raw - min) / range;
      } else {
        normalized = (max - raw) / range;
      }
      scores.set(
        candidates[j].modelName,
        scores.get(candidates[j].modelName)! + weight * normalized,
      );
    }
  }

  let bestModel = candidates[0];
  let bestScore = scores.get(candidates[0].modelName)!;
  for (let i = 1; i < candidates.length; i++) {
    const score = scores.get(candidates[i].modelName)!;
    if (score < bestScore) {
      bestScore = score;
      bestModel = candidates[i];
    }
  }

  return bestModel.modelName as TextModelName;
}

export function calculateCost(
  modelName: ModelName,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  },
): {
  inputCost: number;
  outputCost: number;
  cachedInputCost?: number;
  totalCost: number;
  currency: string;
} | null {
  const model = getModel(modelName);
  if (!model || !isTextModel(model)) {
    return null;
  }

  const inputCost = round(
    (usage.inputTokens * (model.inputTokenCost || 0)) / 1_000_000,
    2,
  );
  const outputCost = round(
    (usage.outputTokens * (model.outputTokenCost || 0)) / 1_000_000,
    2,
  );
  const cachedInputCost =
    usage.cachedInputTokens && model.cachedInputTokenCost
      ? round(
          (usage.cachedInputTokens * model.cachedInputTokenCost) / 1_000_000,
          2,
        )
      : undefined;

  const totalCost = round(
    inputCost + outputCost + (cachedInputCost || 0),
    2,
  );

  return {
    inputCost,
    outputCost,
    cachedInputCost,
    totalCost,
    currency: "USD",
  };
}
