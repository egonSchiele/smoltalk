import { z } from "zod";
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  inputAudioTokens?: number;
  outputAudioTokens?: number;
  totalTokens?: number;
};

export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number().optional(),
  cacheCreationInputTokens: z.number().optional(),
  inputAudioTokens: z.number().optional(),
  outputAudioTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

export function addTokenUsage(_a?: TokenUsage, _b?: TokenUsage): TokenUsage {
  let a = _a;
  let b = _b;
  if (a && !b) return a;
  if (b && !a) return b;
  if (!a && !b) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  a = _a as TokenUsage;
  b = _b as TokenUsage;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: (a.cachedInputTokens || 0) + (b.cachedInputTokens || 0),
    cacheCreationInputTokens:
      (a.cacheCreationInputTokens || 0) + (b.cacheCreationInputTokens || 0),
    inputAudioTokens: (a.inputAudioTokens || 0) + (b.inputAudioTokens || 0),
    outputAudioTokens: (a.outputAudioTokens || 0) + (b.outputAudioTokens || 0),
    totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
  };
}
