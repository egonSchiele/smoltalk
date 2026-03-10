import { z } from "zod";
import { SmolPromptConfig, Result, PromptResult } from "../types.js";
import { ModelName, ProviderSchema } from "../models.js";

export interface Strategy {
  text(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  _text(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  textSync(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>>;
  textStream(
    config: SmolPromptConfig,
  ): Promise<Result<AsyncIterable<PromptResult>>>;
  toJSON(): StrategyJSON;
  toString(): string;
  toShortString(): string;
}

export const FallbackReasonSchema = z.enum([
  "error",
  "timeout",
  "structuredOutputFailure",
]);

export const FallbackStrategyConfigSchema = z.lazy(() =>
  z.partialRecord(FallbackReasonSchema, z.array(StrategyJSONSchema)),
);

export type FallbackReason = z.infer<typeof FallbackReasonSchema>;
export type FallbackStrategyConfig = z.infer<
  typeof FallbackStrategyConfigSchema
>;

export type StrategyJSON =
  | string // model name
  | ModelNameAndProvider
  | IDStrategyJSON
  | RaceStrategyJSON
  | FallbackStrategyJSON;

export const IDStrategyJSONSchema = z.object({
  type: z.literal("id"),
  params: z.object({ model: z.string(), provider: z.string().optional() }),
});

export type IDStrategyJSON = z.infer<typeof IDStrategyJSONSchema>;

export const RaceStrategyJSONSchema: z.ZodType<RaceStrategyJSON> = z.lazy(() =>
  z.object({
    type: z.literal("race"),
    params: z.object({ strategies: z.array(StrategyJSONSchema) }),
  }),
);

export type RaceStrategyJSON = {
  type: "race";
  params: { strategies: StrategyJSON[] };
};

export const FallbackStrategyJSONSchema: z.ZodType<FallbackStrategyJSON> =
  z.lazy(() =>
    z.object({
      type: z.literal("fallback"),
      params: z.object({
        primaryStrategy: StrategyJSONSchema,
        config: FallbackStrategyConfigSchema,
      }),
    }),
  );

export type FallbackStrategyJSON = {
  type: "fallback";
  params: {
    primaryStrategy: StrategyJSON;
    config: FallbackStrategyConfig;
  };
};

export type ModelNameAndProvider = {
  model: string;
  provider: string;
};

export const ModelNameAndProviderSchema = z.object({
  model: z.string(),
  provider: z.string(),
});

export const ModelNameSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9._:-]+$/,
    "Model name must only contain letters, numbers, dots, underscores, hyphens, and colons",
  );

export const OptimizationSchema = z.enum([
  "speed",
  "reasoning",
  "cost",
  "large-context",
]);

export type Optimization = z.infer<typeof OptimizationSchema>;

export const ModelConfigSchema = z.object({
  optimizeFor: z.array(OptimizationSchema),
  providers: z.array(ProviderSchema),
  limit: z
    .object({
      cost: z.number().optional(),
    })
    .optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const StrategyJSONSchema: z.ZodType<StrategyJSON> = z.lazy(() =>
  z.union([
    ModelNameSchema,
    ModelNameAndProviderSchema,
    IDStrategyJSONSchema,
    RaceStrategyJSONSchema,
    FallbackStrategyJSONSchema,
  ]),
);

// Helper to detect if a value is a StrategyJSON object (not a plain string)
export function isStrategy(value: unknown): value is StrategyJSON {
  const result = StrategyJSONSchema.safeParse(value);
  return result.success;
}
