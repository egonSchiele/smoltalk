import { z } from "zod";
export const providers = [
  "ollama",
  "llama-cpp",
  "openai",
  "openai-responses",
  "anthropic",
  "google",
  "replicate",
  "modal",
] as const;
export const ProviderSchema = z.enum(providers);
export type Provider = z.infer<typeof ProviderSchema>;

export type BaseModel = {
  modelName: string;
  provider: string;
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
  maxInputTokens: number;
  maxOutputTokens: number;
  outputTokensPerSecond?: number;
  reasoning?: {
    /** Available effort/thinking levels (provider-specific). Omit for budget-based thinking (Anthropic, Gemini 2.5). */
    levels?: readonly string[];
    /** Default reasoning level */
    defaultLevel?: string;
    /** Whether reasoning/thinking can be fully disabled */
    canDisable?: boolean;
    /** Whether the response includes visible thinking content (thinking blocks/parts) */
    outputsThinking?: boolean;
    /** Whether cryptographic thinking signatures are returned for round-tripping */
    outputsSignatures?: boolean;
  };
};

export type EmbeddingsModel = {
  type: "embeddings";
  modelName: string;

  // costs per 1M tokens, in dollars
  tokenCost?: number;
};

export type ModelType =
  | SpeechToTextModel
  | TextModel
  | EmbeddingsModel
  | ImageModel;

export const speechToTextModels = [
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
      "GPT-4o mini ('o' for 'omni') is a fast, affordable small model for focused tasks. It accepts both text and image inputs, and produces text outputs (including Structured Outputs). It is ideal for fine-tuning, and model outputs from a larger model like GPT-4o can be distilled to GPT-4o-mini to produce similar results at lower cost and latency. Knowledge cutoff: July 2025.",
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
      "GPT-4o ('o' for 'omni') is our versatile, high-intelligence flagship model. It accepts both text and image inputs, and produces text outputs (including Structured Outputs). Knowledge cutoff: April 2024.",
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
      "o3 is a reasoning model that sets a new standard for math, science, coding, visual reasoning tasks, and technical writing. Part of the o-series of reasoning models. Knowledge cutoff: June 2024.",
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 2,
    cachedInputTokenCost: 0.5,
    outputTokenCost: 8,
    outputTokensPerSecond: 94,
    reasoning: {
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "o3-mini",
    description:
      "o3-mini is our most recent small reasoning model, providing high intelligence at the same cost and latency targets of o1-mini. o3-mini also supports key developer features, like Structured Outputs, function calling, Batch API, and more. Like other models in the o-series, it is designed to excel at science, math, and coding tasks. Knowledge cutoff: June 2024.",
    maxInputTokens: 500000,
    maxOutputTokens: 100000,
    inputTokenCost: 1.1,
    cachedInputTokenCost: 0.55,
    outputTokenCost: 4.4,
    outputTokensPerSecond: 214,
    reasoning: {
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "o4-mini",
    description:
      "Latest small o-series model optimized for fast, effective reasoning with exceptional performance in coding and visual tasks. Knowledge cutoff: June 2024.",
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 0.6,
    cachedInputTokenCost: 0.3,
    outputTokenCost: 2.4,
    outputTokensPerSecond: 135,
    reasoning: {
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "o3-pro",
    description:
      "o3-pro uses more compute for complex reasoning tasks. Available via Responses API only. Requests may take several minutes. Knowledge cutoff: June 2024.",
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
    inputTokenCost: 20,
    outputTokenCost: 80,
    reasoning: {
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
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
    reasoning: {
      levels: ["low", "medium", "high"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
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
      "GPT-4.1 excels at instruction following and tool calling with 1M token context window. Knowledge cutoff: June 2024.",
    maxInputTokens: 1047576,
    maxOutputTokens: 32768,
    inputTokenCost: 2.0,
    cachedInputTokenCost: 0.5,
    outputTokenCost: 8,
    outputTokensPerSecond: 105,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-4.1-mini",
    description:
      "GPT-4.1 mini excels at instruction following and tool calling with 1M token context window and low latency. Knowledge cutoff: June 2024.",
    maxInputTokens: 1047576,
    maxOutputTokens: 32768,
    inputTokenCost: 0.4,
    cachedInputTokenCost: 0.1,
    outputTokenCost: 1.6,
    outputTokensPerSecond: 78,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-4.1-nano",
    description:
      "GPT-4.1 nano is the fastest and most affordable GPT-4.1 variant with 1M token context window. Knowledge cutoff: June 2024.",
    maxInputTokens: 1047576,
    maxOutputTokens: 32768,
    inputTokenCost: 0.1,
    cachedInputTokenCost: 0.025,
    outputTokenCost: 0.4,
    outputTokensPerSecond: 142,
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5",
    description:
      "GPT-5 is a frontier reasoning model with 400K context window. Supports reasoning tokens. Knowledge cutoff: September 2024.",
    maxInputTokens: 400000,
    maxOutputTokens: 128000,
    inputTokenCost: 1.25,
    cachedInputTokenCost: 0.125,
    outputTokenCost: 10,
    outputTokensPerSecond: 72,
    reasoning: {
      levels: ["minimal", "low", "medium", "high"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5-mini",
    description:
      "GPT-5 mini is a faster, more cost-efficient version of GPT-5 with 400K context window. Knowledge cutoff: May 2024.",
    maxInputTokens: 400000,
    maxOutputTokens: 128000,
    inputTokenCost: 0.25,
    cachedInputTokenCost: 0.025,
    outputTokenCost: 2,
    outputTokensPerSecond: 69,
    reasoning: {
      levels: ["minimal", "low", "medium", "high"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5-nano",
    description:
      "GPT-5 nano is the fastest and most affordable GPT-5 variant with 400K context window. Knowledge cutoff: May 2024.",
    maxInputTokens: 400000,
    maxOutputTokens: 128000,
    inputTokenCost: 0.05,
    cachedInputTokenCost: 0.005,
    outputTokenCost: 0.4,
    outputTokensPerSecond: 140,
    reasoning: {
      levels: ["minimal", "low", "medium", "high"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5.1",
    description:
      "GPT-5.1 is the flagship model for coding and agentic tasks with configurable reasoning effort. 400K context window. Knowledge cutoff: September 2024.",
    maxInputTokens: 400000,
    maxOutputTokens: 128000,
    inputTokenCost: 1.25,
    cachedInputTokenCost: 0.125,
    outputTokenCost: 10,
    reasoning: {
      levels: ["none", "low", "medium", "high"],
      defaultLevel: "none",
      canDisable: true,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5.2",
    description:
      "GPT-5.2 is the flagship model for coding and agentic tasks across industries. 400K context window. Knowledge cutoff: August 2025.",
    maxInputTokens: 400000,
    maxOutputTokens: 128000,
    inputTokenCost: 1.75,
    cachedInputTokenCost: 0.175,
    outputTokenCost: 14,
    outputTokensPerSecond: 61,
    reasoning: {
      levels: ["none", "low", "medium", "high"],
      defaultLevel: "none",
      canDisable: true,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5.2-pro",
    description:
      "GPT-5.2 Pro uses more compute for complex reasoning tasks. 400K context window. Knowledge cutoff: August 2025.",
    maxInputTokens: 400000,
    maxOutputTokens: 128000,
    inputTokenCost: 21,
    outputTokenCost: 168,
    reasoning: {
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5.4",
    description:
      "GPT-5.4 is the most capable and efficient frontier model for complex professional work. 1M context window, state-of-the-art coding and tool use. Standard pricing for ≤272K tokens, 2x input/1.5x output for >272K. Knowledge cutoff: August 2025.",
    maxInputTokens: 1_050_000,
    maxOutputTokens: 128000,
    inputTokenCost: 2.5,
    cachedInputTokenCost: 0.25,
    outputTokenCost: 15,
    reasoning: {
      levels: ["none", "low", "medium", "high", "xhigh"],
      defaultLevel: "none",
      canDisable: true,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gpt-5.4-pro",
    description:
      "GPT-5.4 Pro uses more compute for complex reasoning tasks. 1M context window. Standard pricing for ≤272K tokens. Knowledge cutoff: August 2025.",
    maxInputTokens: 1_050_000,
    maxOutputTokens: 128000,
    inputTokenCost: 30,
    outputTokenCost: 180,
    reasoning: {
      levels: ["medium", "high", "xhigh"],
      defaultLevel: "medium",
      canDisable: false,
      outputsThinking: false,
      outputsSignatures: false,
    },
    provider: "openai",
  },
  {
    type: "text",
    modelName: "gemini-3.1-pro-preview",
    description:
      "Latest Gemini 3.1 Pro with 1M context window and 64K output. Standard pricing for ≤200k tokens ($2.00 input/$12.00 output), higher rates for >200k tokens ($4.00 input/$18.00 output). Released Feb 2026.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65536,
    inputTokenCost: 2.0,
    outputTokenCost: 12.0,
    outputTokensPerSecond: 112,
    reasoning: {
      levels: ["low", "medium", "high"],
      defaultLevel: "high",
      canDisable: false,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-3-pro-preview",
    description:
      "DEPRECATED: Shut down March 9, 2026. Use gemini-3.1-pro-preview instead.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65536,
    inputTokenCost: 2.0,
    outputTokenCost: 12.0,
    disabled: true,
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
    outputTokensPerSecond: 146,
    reasoning: {
      levels: ["minimal", "low", "medium", "high"],
      defaultLevel: "high",
      canDisable: false,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-3.1-flash-lite-preview",
    description:
      "Most cost-effective Gemini 3.1 model with thinking support and 1M context window. 2.5x faster TTFA and 45% faster output than 2.5 Flash. Released March 2026.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65536,
    inputTokenCost: 0.25,
    outputTokenCost: 1.5,
    outputTokensPerSecond: 379,
    reasoning: {
      levels: ["minimal", "low", "medium", "high"],
      defaultLevel: "minimal",
      canDisable: false,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.5-pro",
    description:
      "High-performance Gemini 2.5 model with 2M context window. Adaptive thinking for complex reasoning and coding. Standard pricing for ≤200k tokens ($1.25 input/$10.00 output), higher rates for >200k tokens ($2.50 input/$15.00 output). Batch API: 50% discount.",
    maxInputTokens: 2_097_152,
    maxOutputTokens: 65536,
    inputTokenCost: 1.25,
    outputTokenCost: 10.0,
    outputTokensPerSecond: 134,
    reasoning: {
      canDisable: false,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.5-flash",
    description:
      "Balanced Gemini 2.5 model with excellent performance-to-cost ratio. Lightning-fast with controllable thinking budgets. 1M context window. Context caching available for up to 75% cost reduction.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65536,
    inputTokenCost: 0.3,
    outputTokenCost: 2.5,
    outputTokensPerSecond: 245,
    reasoning: {
      canDisable: true,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-2.5-flash-lite",
    description:
      "Most cost-effective Gemini 2.5 option for high-throughput applications. 1M context window.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65536,
    inputTokenCost: 0.1,
    outputTokenCost: 0.4,
    outputTokensPerSecond: 400,
    reasoning: {
      canDisable: true,
      outputsThinking: true,
      outputsSignatures: false,
    },
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
      "Cost effective offering to support high throughput. DEPRECATED: Will be shut down on March 31, 2026. Use gemini-2.5-flash-lite instead.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.075,
    outputTokenCost: 0.3,
    disabled: true,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-1.5-flash",
    description: "RETIRED: No longer available. Use gemini-2.5-flash instead.",
    maxInputTokens: 1_048_576,
    maxOutputTokens: 8192,
    inputTokenCost: 0.01875,
    outputTokenCost: 0.075,
    outputTokensPerSecond: 178,
    costUnit: "characters",
    disabled: true,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-1.5-pro",
    description: "RETIRED: No longer available. Use gemini-2.5-pro instead.",
    maxInputTokens: 2_097_152,
    maxOutputTokens: 8192,
    inputTokenCost: 0.3125,
    outputTokenCost: 1.25,
    outputTokensPerSecond: 59,
    costUnit: "characters",
    disabled: true,
    provider: "google",
  },
  {
    type: "text",
    modelName: "gemini-1.0-pro",
    description: "RETIRED: No longer available. Use gemini-2.5-flash instead.",
    maxInputTokens: 32_760,
    maxOutputTokens: 8192,
    inputTokenCost: 0.125,
    outputTokenCost: 0.375,
    costUnit: "characters",
    disabled: true,
    provider: "google",
  },
  {
    type: "text",
    modelName: "claude-opus-4-6",
    description:
      "The most intelligent Claude model for building agents and coding. 200K context window (1M in beta), 128K max output.",
    maxInputTokens: 200_000,
    maxOutputTokens: 131_072,
    inputTokenCost: 5,
    cachedInputTokenCost: 0.5,
    outputTokenCost: 25,
    outputTokensPerSecond: 53,
    reasoning: {
      canDisable: true,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "anthropic",
  },
  {
    type: "text",
    modelName: "claude-sonnet-4-6",
    description:
      "The best combination of speed and intelligence. 200K context window (1M in beta), 64K max output.",
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    inputTokenCost: 3,
    cachedInputTokenCost: 0.3,
    outputTokenCost: 15,
    reasoning: {
      canDisable: true,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "anthropic",
  },
  {
    type: "text",
    modelName: "claude-haiku-4-5-20251001",
    description:
      "The fastest Claude model with near-frontier intelligence. 200K context window, 64K max output.",
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    inputTokenCost: 1,
    cachedInputTokenCost: 0.1,
    outputTokenCost: 5,
    outputTokensPerSecond: 97,
    reasoning: {
      canDisable: true,
      outputsThinking: true,
      outputsSignatures: true,
    },
    provider: "anthropic",
  },
  {
    type: "text",
    modelName: "claude-3-7-sonnet-latest",
    description:
      "Claude 3.7 Sonnet — legacy model. Use claude-sonnet-4-6 instead.",
    maxInputTokens: 200_000,
    maxOutputTokens: 8192,
    inputTokenCost: 3,
    outputTokenCost: 15,
    outputTokensPerSecond: 78,
    reasoning: {
      canDisable: true,
      outputsThinking: true,
      outputsSignatures: true,
    },
    disabled: true,
    provider: "anthropic",
  },
  {
    type: "text",
    modelName: "claude-3-5-haiku-latest",
    description:
      "Claude 3.5 Haiku — legacy model. Use claude-haiku-4-5-20251001 instead.",
    maxInputTokens: 200_000,
    maxOutputTokens: 8192,
    inputTokenCost: 0.8,
    outputTokenCost: 4,
    outputTokensPerSecond: 66,
    disabled: true,
    provider: "anthropic",
  },
] as const;

export const imageModels = [
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
export type ModelName = string; // TextModelName | ImageModelName | SpeechToTextModelName;

export const registeredTextModels: TextModel[] = [];

export function registerTextModel(
  model: Omit<TextModel, "type"> & { type?: "text" },
) {
  registeredTextModels.push({ ...model, type: "text" });
}

export function getModel(modelName: ModelName) {
  const allModels = [
    ...textModels,
    ...imageModels,
    ...speechToTextModels,
    ...registeredTextModels,
  ];
  return allModels.find((model) => model.modelName === modelName);
}

export function isImageModel(model: ModelType): model is ImageModel {
  return model.type === "image";
}

export function isTextModel(model: ModelType): model is TextModel {
  return model.type === "text";
}

export function isSpeechToTextModel(
  model: ModelType,
): model is SpeechToTextModel {
  return model.type === "speech-to-text";
}
export function isEmbeddingsModel(model: ModelType): model is EmbeddingsModel {
  return model.type === "embeddings";
}
