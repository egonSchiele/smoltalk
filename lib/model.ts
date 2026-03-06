import {
  ModelName,
  getModel,
  isTextModel,
  Provider,
  TextModel,
  TextModelName,
  textModels,
} from "./models.js";
import { SmolError } from "./smolError.js";
import { ModelLike } from "./types.js";
import { round } from "./util.js";

export type Optimization = "speed" | "reasoning" | "cost" | "large-context";

export type ModelConfig = {
  optimizeFor: Optimization[];
  providers: Provider[];
  limit?: {
    cost?: number;
  };
};

const WEIGHTS: Record<number, number[]> = {
  1: [1],
  2: [0.6, 0.4],
  3: [0.5, 0.3, 0.2],
  4: [0.4, 0.3, 0.2, 0.1],
};

export class Model {
  private model: ModelName | ModelConfig;
  private resolvedModel: ModelName;
  constructor(model: ModelName | ModelConfig) {
    this.model = model;
    this.resolvedModel = this.resolveModel();
  }

  getModel() {
    return this.model;
  }

  getResolvedModel() {
    return this.resolvedModel;
  }
  isModelConfig(model: ModelName | ModelConfig): model is ModelConfig {
    return typeof model === "object" && "optimizeFor" in model;
  }

  resolveModel(models: readonly TextModel[] = textModels): ModelName {
    if (!this.isModelConfig(this.model)) {
      const modelName = this.model as ModelName;
      const model = getModel(modelName);
      if (!model) {
        throw new SmolError(
          `Model ${modelName} is not recognized. Please specify a known model or a valid ModelConfig.`,
        );
      }
      return modelName as ModelName;
    }
    const model = this.model as ModelConfig;
    let candidates = models.filter(
      (m) =>
        model.providers.includes(m.provider as Provider) &&
        !("disabled" in m && m.disabled),
    );

    if (model.limit?.cost !== undefined) {
      candidates = candidates.filter((m) => {
        const cost = (m.inputTokenCost ?? 0) + (m.outputTokenCost ?? 0);
        return cost <= model.limit!.cost!;
      });
    }

    if (candidates.length === 0) {
      throw new SmolError(
        "No models available for providers: " +
          model.providers.join(", ") +
          ". Check that the providers have non-disabled models.",
      );
    }

    if (candidates.length === 1) {
      return candidates[0].modelName as ModelName;
    }

    const optimizations = model.optimizeFor;
    const weights = WEIGHTS[optimizations.length] ?? WEIGHTS[4]!;

    const scores = new Map<string, number>();
    for (const c of candidates) {
      scores.set(c.modelName, 0);
    }

    for (let i = 0; i < optimizations.length; i++) {
      const opt = optimizations[i];
      const weight = weights[i];
      const rawValues = candidates.map((c) => this.getRawMetric(c, opt));
      const min = Math.min(...rawValues);
      const max = Math.max(...rawValues);
      const range = max - min;

      for (let j = 0; j < candidates.length; j++) {
        const raw = rawValues[j];
        let normalized: number;
        if (range === 0) {
          normalized = 0;
        } else if (this.isLowerBetter(opt)) {
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

  private getRawMetric(model: TextModel, optimization: Optimization): number {
    const m = model as TextModel;
    switch (optimization) {
      case "cost":
        return (m.inputTokenCost ?? 0) + (m.outputTokenCost ?? 0);
      case "speed":
        return m.outputTokensPerSecond ?? 0;
      case "reasoning":
        return (m.inputTokenCost ?? 0) + (m.outputTokenCost ?? 0);
      case "large-context":
        return m.maxInputTokens;
    }
  }

  private isLowerBetter(optimization: Optimization): boolean {
    return optimization === "cost";
  }

  calculateCost(usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  }): {
    inputCost: number;
    outputCost: number;
    cachedInputCost?: number;
    totalCost: number;
    currency: string;
  } | null {
    const model = getModel(this.getResolvedModel());
    if (!model || !isTextModel(model)) {
      return null;
    }

    const inputCost = round(
      (usage.inputTokens * (model.inputTokenCost || 0)) / 1_000_000,
      6,
    );
    const outputCost = round(
      (usage.outputTokens * (model.outputTokenCost || 0)) / 1_000_000,
      6,
    );
    const cachedInputCost =
      usage.cachedInputTokens && model.cachedInputTokenCost
        ? round(
            (usage.cachedInputTokens * model.cachedInputTokenCost) / 1_000_000,
            6,
          )
        : undefined;

    const totalCost = round(inputCost + outputCost + (cachedInputCost || 0), 6);

    return {
      inputCost,
      outputCost,
      cachedInputCost,
      totalCost,
      currency: "USD",
    };
  }

  static create(model: ModelLike): Model {
    if (model instanceof Model) {
      return model;
    }
    return new Model(model);
  }
}
