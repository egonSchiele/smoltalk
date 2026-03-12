import { z } from "zod";
import { SmolPromptConfig, Result, PromptResult } from "../types.js";
import { ModelName } from "../models.js";

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
  "contentPolicyViolation",
  "contextWindowExceeded",
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
  | FallbackStrategyJSON
  | RandomStrategyJSON
  | FastestStrategyJSON
  | TimeoutStrategyJSON;

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

export const RandomStrategyJSONSchema: z.ZodType<RandomStrategyJSON> = z.lazy(
  () =>
    z.object({
      type: z.literal("random"),
      params: z.object({ strategies: z.array(StrategyJSONSchema) }),
    }),
);

export type RandomStrategyJSON = {
  type: "random";
  params: { strategies: StrategyJSON[] };
};

export const FastestStrategyJSONSchema: z.ZodType<FastestStrategyJSON> = z.lazy(
  () =>
    z.object({
      type: z.literal("fastest"),
      params: z.object({
        models: z.array(z.union([ModelNameAndProviderSchema, z.string()])),
      }),
    }),
);

export type FastestStrategyJSON = {
  type: "fastest";
  params: { models: (ModelNameAndProvider | string)[] };
};

export type ModelNameAndProvider = {
  model: string;
  provider: string;
};

export const TimeoutStrategyJSONSchema: z.ZodType<TimeoutStrategyJSON> = z.lazy(
  () =>
    z.object({
      type: z.literal("timeout"),
      params: z.object({
        strategy: StrategyJSONSchema,
        timeoutMs: z.number(),
      }),
    }),
);

export type TimeoutStrategyJSON = {
  type: "timeout";
  params: { strategy: StrategyJSON; timeoutMs: number };
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

export const StrategyJSONSchema: z.ZodType<StrategyJSON> = z.lazy(() =>
  z.union([
    ModelNameSchema,
    ModelNameAndProviderSchema,
    IDStrategyJSONSchema,
    RaceStrategyJSONSchema,
    FallbackStrategyJSONSchema,
    RandomStrategyJSONSchema,
    FastestStrategyJSONSchema,
    TimeoutStrategyJSONSchema,
  ]),
);

// Helper to detect if a value is a StrategyJSON object (not a plain string)
export function isStrategy(value: unknown): value is StrategyJSON {
  const result = StrategyJSONSchema.safeParse(value);
  return result.success;
}
