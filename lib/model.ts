import { ModelName, getModel, isTextModel, ModelNameSchema, Provider } from "./models.js";
import { SmolError } from "./smolError.js";
import { ModelLike } from "./types.js";
import { round } from "./util/util.js";

export class Model {
  private model: ModelName;
  private resolvedModel: ModelName;
  private provider?: Provider;
  constructor(model: ModelName, provider?: Provider) {
    this.model = model;
    this.resolvedModel = this.resolveModel();
    this.provider = provider || this.setProvider();
  }

  getModel() {
    return this.model;
  }

  getResolvedModel() {
    return this.resolvedModel;
  }

  getProvider(): Provider | undefined {
    if (this.provider) {
      return this.provider;
    }
    return undefined;
  }

  setProvider(): Provider | undefined {
    const resolved = this.getResolvedModel();
    const modelInfo = getModel(resolved);
    if (modelInfo) {
      return modelInfo.provider as Provider;
    }
    return undefined;
  }

  resolveModel(): ModelName {
    if (ModelNameSchema.safeParse(this.model).success) {
      return this.model as ModelName;
    }

    throw new SmolError(
      `Model ${JSON.stringify(this.model)} is not recognized. Please specify a known model name.`,
    );
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

  toString() {
    return `Model(${JSON.stringify(this.model)})`;
  }

  toJSON(): ModelName {
    return this.getResolvedModel();
  }

  static create(model: ModelLike, provider?: Provider): Model {
    if (model instanceof Model) {
      return model;
    }
    return new Model(model, provider);
  }
}
