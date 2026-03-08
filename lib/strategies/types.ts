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
]);

export const FallbackStrategyConfigSchema = z.object({
  fallbackOn: z.array(FallbackReasonSchema),
});

export type FallbackReason = z.infer<typeof FallbackReasonSchema>;
export type FallbackStrategyConfig = z.infer<
  typeof FallbackStrategyConfigSchema
>;

export type StrategyJSON =
  | string
  | { type: "id"; params: { model: string } }
  | { type: "race"; params: { strategies: StrategyJSON[] } }
  | {
      type: "fallback";
      params: { strategies: StrategyJSON[]; config: FallbackStrategyConfig };
    };

export const IDStrategyJSONSchema = z.object({
  type: z.literal("id"),
  params: z.object({ model: z.string() }),
});

export type IDStrategyJSON = z.infer<typeof IDStrategyJSONSchema>;

export const RaceStrategyJSONSchema = z.lazy(() =>
  z.object({
    type: z.literal("race"),
    params: z.object({ strategies: z.array(StrategyJSONSchema) }),
  }),
);

export type RaceStrategyJSON = z.infer<typeof RaceStrategyJSONSchema>;

export const FallbackStrategyJSONSchema = z.lazy(() =>
  z.object({
    type: z.literal("fallback"),
    params: z.object({
      strategies: z.array(StrategyJSONSchema),
      config: FallbackStrategyConfigSchema,
    }),
  }),
);

export type FallbackStrategyJSON = z.infer<typeof FallbackStrategyJSONSchema>;

export const StrategyJSONSchema: z.ZodType<StrategyJSON> = z.lazy(() =>
  z.union([
    z.string(),
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
