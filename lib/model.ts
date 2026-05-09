import { ModelName, getModel, isTextModel, ModelNameSchema, Provider } from "./models.js";
import { SmolError } from "./smolError.js";
import { ModelLike } from "./types.js";
import { round } from "./util/util.js";

export class Model {
  private model: ModelName;
  private provider?: Provider;

  constructor(model: ModelName, provider?: Provider) {
    if (!ModelNameSchema.safeParse(model).success) {
      throw new SmolError(
        `Model ${JSON.stringify(model)} is not recognized. Please specify a known model name.`,
      );
    }
    this.model = model;
    this.provider = provider || this.lookupProvider();
  }

  getModel(): ModelName {
    return this.model;
  }

  getProvider(): Provider | undefined {
    return this.provider;
  }

  private lookupProvider(): Provider | undefined {
    const modelInfo = getModel(this.model);
    return modelInfo ? (modelInfo.provider as Provider) : undefined;
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
    const model = getModel(this.model);
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

  toString() {
    return `Model(${JSON.stringify(this.model)})`;
  }

  toJSON(): ModelName {
    return this.model;
  }

  static create(model: ModelLike, provider?: Provider): Model {
    if (model instanceof Model) {
      return model;
    }
    return new Model(model, provider);
  }
}
