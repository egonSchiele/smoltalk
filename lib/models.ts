import { SmolError } from "./smolError.js";

export type ModelSource =
  | "local"
  | "debug"
  | "local-ollama"
  | "openai"
  | "anthropic"
  | "google"
  | "replicate"
  | "modal";

export type BaseModel = {
  modelName: string;
  source: ModelSource;
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
  { type: "speech-to-text", modelName: "whisper-local", source: "local" },
  {
    type: "speech-to-text",
    modelName: "whisper-web",
    perMinuteCost: 0.006,
    source: "openai",
  },
  // not a speech to text model?
  /* {
    type: "speech-to-text",
    modelName: "gpt-4o-audio-preview",
    description:
      "This is a preview release of the GPT-4o Audio models. These models accept audio inputs and outputs, and can be used in the Chat Completions REST API. Learn more. The knowledge cutoff for GPT-4o Audio models is October, 2023.",
    inputTokenCost: 2.5,
    outputTokenCost: 10,
    source: "openai",
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
    source: "openai",
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
    source: "openai",
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
    source: "openai",
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
    source: "openai",
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
    source: "openai",
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
    source: "openai",
  },
  {
    type: "text",
    modelName: "gemini-2.0-flash",
    description:
      "Workhorse model for all daily tasks. Strong overall performance and supports real-time streaming Live API",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.15,
    outputTokenCost: 0.6,
    source: "google",
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
    source: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.0-flash-lite",
    description: "Our cost effective offering to support high throughput.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.075,
    outputTokenCost: 0.3,
    source: "google",
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
    costUnit: "characters",
    source: "google",
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
    costUnit: "characters",
    source: "google",
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
    source: "google",
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
    source: "anthropic",
  },
  {
    type: "text",
    modelName: "claude-3-5-haiku-latest",
    description: "Our fastest model",
    maxInputTokens: 200_000,
    maxOutputTokens: 8192,
    inputTokenCost: 0.8,
    outputTokenCost: 4,
    source: "anthropic",
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
    source: "local-ollama",
    maxInputTokens: 128000,
    maxOutputTokens: 128000,
  },
  {
    type: "text",
    modelName: "mistral-adapters-chunk50-iters100",
    description:
      "Fine tuned Mistral 7B model fed on my stories, chunked into parts of 50 chars each, 100 iterations.",
    source: "local",
    // https://huggingface.co/mistralai/Mistral-7B-v0.1/discussions/104
    maxInputTokens: 8192,
    maxOutputTokens: 8192,
  },
  {
    type: "text",
    modelName: "llama-7b",
    source: "replicate",
    maxInputTokens: 256,
    maxOutputTokens: 256,
  },
  {
    type: "text",
    modelName: "console.log text",
    source: "debug",
    description:
      "Fake model that just echoes the prompt to the console for debugging",
    maxInputTokens: 8192,
    maxOutputTokens: 8192,
  },
] as const;

export const imageModels = [
  {
    type: "image",
    modelName: "google/imagen-3",
    source: "replicate",
    costPerImage: 0.05,
  },
  {
    type: "image",
    modelName: "minimax/image-01",
    source: "replicate",
    costPerImage: 0.01,
    outputType: "Array",
  },
  {
    type: "image",
    modelName: "flux-modal",
    source: "modal",
    costPerImage: 0.03,
  },
  {
    type: "image",
    modelName: "gpt-image-1",
    source: "openai",
    // varies: https://platform.openai.com/docs/models/gpt-image-1
    costPerImage: 0.25,
  },
  {
    type: "image",
    modelName: "gemini-2.5-flash-image-preview",
    source: "google",
    description: "aka nano-banana",
    costPerImage: 0.04,
  },
  {
    type: "image",
    modelName: "console.log image",
    source: "debug",
    description:
      "Fake model that just echoes the prompt to the console for debugging",
    costPerImage: 0,
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
