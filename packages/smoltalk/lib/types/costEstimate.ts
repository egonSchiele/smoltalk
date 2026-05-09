import { z } from "zod";
export type CostEstimate = {
  inputCost: number;
  outputCost: number;
  cachedInputCost?: number;
  totalCost: number;
  currency: string;
};

export const CostEstimateSchema = z.object({
  inputCost: z.number(),
  outputCost: z.number(),
  cachedInputCost: z.number().optional(),
  totalCost: z.number(),
  currency: z.string(),
});

export function addCosts(_a?: CostEstimate, _b?: CostEstimate): CostEstimate {
  let a = _a;
  let b = _b;
  if (a && !b) return a;
  if (b && !a) return b;
  if (!a && !b)
    return { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };
  a = _a as CostEstimate;
  b = _b as CostEstimate;
  if (a.currency !== b.currency) {
    throw new Error(
      `Cannot add costs with different currencies: ${a.currency} and ${b.currency}`,
    );
  }
  return {
    inputCost: a.inputCost + b.inputCost,
    outputCost: a.outputCost + b.outputCost,
    cachedInputCost: (a.cachedInputCost || 0) + (b.cachedInputCost || 0),
    totalCost: a.totalCost + b.totalCost,
    currency: a.currency,
  };
}
