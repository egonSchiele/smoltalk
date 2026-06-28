import { ModelName, getModel, isTextModel, ModelNameSchema, Provider } from "./models.js";
import { SmolError } from "./smolError.js";
import { ModelLike } from "./types.js";
import type { ModelDataBlob } from "./modelData.js";
import { round } from "./util/util.js";

export class Model {
  private model: ModelName;
  private provider?: Provider;
  private modelData?: ModelDataBlob;

  constructor(model: ModelName, provider?: Provider, modelData?: ModelDataBlob) {
    if (!ModelNameSchema.safeParse(model).success) {
      throw new SmolError(
        `Model ${JSON.stringify(model)} is not recognized. Please specify a known model name.`,
      );
    }
    this.model = model;
    this.modelData = modelData;
    this.provider = provider || this.lookupProvider();
  }

  getModel(): ModelName {
    return this.model;
  }

  getProvider(): Provider | undefined {
    return this.provider;
  }

  private lookupProvider(): Provider | undefined {
    const modelInfo = getModel(this.model, this.modelData);
    return modelInfo ? (modelInfo.provider as Provider) : undefined;
  }

  calculateCost(usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
  }): {
    inputCost: number;
    outputCost: number;
    cachedInputCost?: number;
    cacheCreationInputCost?: number;
    totalCost: number;
    currency: string;
  } | null {
    const model = getModel(this.model, this.modelData);
    if (!model || !isTextModel(model)) {
      return null;
    }

    const cachedTokens = usage.cachedInputTokens ?? 0;
    const cacheCreationTokens = usage.cacheCreationInputTokens ?? 0;

    // Disjoint buckets. If a discount price isn't defined for this model,
    // the tokens were still billed by the provider — charge them at the
    // full input rate so totalCost stays honest.
    const cachedRate = model.cachedInputTokenCost ?? model.inputTokenCost ?? 0;
    const cacheCreationRate =
      model.cacheCreationInputTokenCost ?? model.inputTokenCost ?? 0;

    const inputCost = round(
      (usage.inputTokens * (model.inputTokenCost || 0)) / 1_000_000,
      6,
    );
    const outputCost = round(
      (usage.outputTokens * (model.outputTokenCost || 0)) / 1_000_000,
      6,
    );

    // Only expose cachedInputCost / cacheCreationInputCost when the model
    // actually has a distinct discount price. Otherwise, fold those dollars
    // into inputCost so the user isn't misled by a $0 cached field.
    let cachedInputCost: number | undefined;
    let cacheCreationInputCost: number | undefined;
    let foldedInputDollars = 0;

    if (cachedTokens > 0) {
      const dollars = (cachedTokens * cachedRate) / 1_000_000;
      if (model.cachedInputTokenCost != null) {
        cachedInputCost = round(dollars, 6);
      } else {
        foldedInputDollars += dollars;
      }
    }

    if (cacheCreationTokens > 0) {
      const dollars = (cacheCreationTokens * cacheCreationRate) / 1_000_000;
      if (model.cacheCreationInputTokenCost != null) {
        cacheCreationInputCost = round(dollars, 6);
      } else {
        foldedInputDollars += dollars;
      }
    }

    const finalInputCost = round(inputCost + foldedInputDollars, 6);
    const totalCost = round(
      finalInputCost +
        outputCost +
        (cachedInputCost || 0) +
        (cacheCreationInputCost || 0),
      6,
    );

    return {
      inputCost: finalInputCost,
      outputCost,
      cachedInputCost,
      cacheCreationInputCost,
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

  static create(model: ModelLike, provider?: Provider, modelData?: ModelDataBlob): Model {
    if (model instanceof Model) {
      return model;
    }
    return new Model(model, provider, modelData);
  }
}
