import {
  ModelName,
  getModel,
  getModelForProvider,
  isSpeechToTextModel,
  isTextModel,
  isTextToSpeechModel,
  ModelNameSchema,
  ModelType,
} from "./models.js";
import { SmolError } from "./smolError.js";
import { ModelLike } from "./types.js";
import type { ModelDataBlob } from "./modelData.js";
import type { CostEstimate } from "./types/costEstimate.js";
import { round } from "./util/util.js";

const TOKEN_COST_UNIT = 1_000_000;

export class Model {
  private model: ModelName;
  private provider?: string;
  private modelData?: ModelDataBlob;

  constructor(model: ModelName, provider?: string, modelData?: ModelDataBlob) {
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

  getProvider(): string | undefined {
    return this.provider;
  }

  private lookupProvider(): string | undefined {
    const modelInfo = getModel(this.model, this.modelData);
    return modelInfo ? modelInfo.provider : undefined;
  }

  calculateCost(usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    inputAudioTokens?: number;
    outputAudioTokens?: number;
  }): {
    inputCost: number;
    outputCost: number;
    cachedInputCost?: number;
    cacheCreationInputCost?: number;
    totalCost: number;
    currency: string;
  } | null {
    let model: ModelType | undefined;
    if (this.provider !== undefined) {
      model = getModelForProvider(this.provider, this.model, this.modelData);
    } else {
      model = getModel(this.model, this.modelData);
    }
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
      (usage.inputTokens * (model.inputTokenCost || 0)) / TOKEN_COST_UNIT,
      6,
    );
    const outputCost = round(
      (usage.outputTokens * (model.outputTokenCost || 0)) / TOKEN_COST_UNIT,
      6,
    );

    const audioInTokens = usage.inputAudioTokens ?? 0;
    const audioOutTokens = usage.outputAudioTokens ?? 0;
    // Fall back to the text rate if no audio rate is defined so the total stays honest.
    const audioInRate = model.inputAudioTokenCost ?? model.inputTokenCost ?? 0;
    const audioOutRate = model.outputAudioTokenCost ?? model.outputTokenCost ?? 0;
    const audioInCost = round((audioInTokens * audioInRate) / TOKEN_COST_UNIT, 6);
    const audioOutCost = round((audioOutTokens * audioOutRate) / TOKEN_COST_UNIT, 6);

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

    const finalInputCost = round(inputCost + foldedInputDollars + audioInCost, 6);
    const finalOutputCost = round(outputCost + audioOutCost, 6);
    const totalCost = round(
      finalInputCost +
        finalOutputCost +
        (cachedInputCost || 0) +
        (cacheCreationInputCost || 0),
      6,
    );

    return {
      inputCost: finalInputCost,
      outputCost: finalOutputCost,
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

  static create(model: ModelLike, provider?: string, modelData?: ModelDataBlob): Model {
    if (model instanceof Model) {
      return model;
    }
    return new Model(model, provider, modelData);
  }
}

/**
 * Per-minute STT pricing from a registry entry. Returns undefined (cost
 * omitted, no error) when the model, rate, or duration is unknown — a rate of
 * 0 still yields a present zero cost.
 */
export function calculateTranscriptionCost(
  model: ModelType | undefined,
  durationSeconds: number | undefined,
): CostEstimate | undefined {
  if (model === undefined || !isSpeechToTextModel(model)) {
    return undefined;
  }
  if (model.perMinuteCost === undefined || durationSeconds === undefined || durationSeconds === null) {
    return undefined;
  }
  const inputCost = round((durationSeconds / 60) * model.perMinuteCost, 6);
  return { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
}

/** Per-code-point TTS pricing from a registry entry; same omission semantics. */
export function calculateSpeechCost(
  model: ModelType | undefined,
  charCount: number,
): CostEstimate | undefined {
  if (model === undefined || !isTextToSpeechModel(model)) {
    return undefined;
  }
  if (model.perCharacterCost === undefined) {
    return undefined;
  }
  const inputCost = round(charCount * model.perCharacterCost, 6);
  return { inputCost, outputCost: 0, totalCost: inputCost, currency: "USD" };
}
