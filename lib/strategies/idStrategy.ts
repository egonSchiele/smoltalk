import { getClient } from "../client.js";
import { splitConfig } from "../functions.js";
import { Model } from "../model.js";
import { ModelName, Provider } from "../models.js";
import { ModelLike, PromptResult, Result, SmolPromptConfig } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { IDStrategyJSON, StrategyJSON } from "./types.js";

export class IDStrategy extends BaseStrategy {
  public model: Model;
  public provider: string | undefined;
  constructor(model: ModelLike, provider?: string) {
    super();
    this.model = Model.create(model);
    this.provider = provider;
  }

  toString() {
    const params = [`model: ${this.model.getResolvedModel()}`];
    if (this.provider) params.push(`provider: ${this.provider}`);
    return `IDStrategy(${params.join(", ")})`;
  }

  toShortString() {
    const params = [`model: ${this.model.getResolvedModel()}`];
    if (this.provider) params.push(`provider: ${this.provider}`);
    return `id(${params.join(", ")})`;
  }

  async _text(config: SmolPromptConfig) {
    return this._textSync(config);
  }

  async _textSync(config: SmolPromptConfig): Promise<Result<PromptResult>> {
    const configOverrides = {
      model: this.model.getResolvedModel(),
      provider: config.provider || (this.provider as Provider | undefined),
    };
    const { smolConfig, promptConfig } = splitConfig({
      ...config,
      ...configOverrides,
    });
    const client = getClient({
      ...smolConfig,
      ...configOverrides,
    });
    return client.textSync(promptConfig);
  }

  toJSON(): StrategyJSON {
    return {
      type: "id",
      params: { model: this.model.getResolvedModel(), provider: this.provider },
    };
  }

  static fromJSON(json: IDStrategyJSON): IDStrategy {
    return new IDStrategy(json.params.model as ModelName, json.params.provider);
  }
}
