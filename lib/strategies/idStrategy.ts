import { text } from "../functions.js";
import { Model } from "../model.js";
import { SmolPromptConfig } from "../types.js";
import { BaseStrategy } from "./baseStrategy.js";
import { StrategyJSON } from "./types.js";

export class IDStrategy extends BaseStrategy {
  public model: Model;
  constructor(model: Model) {
    super();
    this.model = model;
  }

  toString() {
    return `IDStrategy(model: ${this.model.getResolvedModel()})`;
  }

  toShortString() {
    return `id(${this.model.getResolvedModel()})`;
  }

  async _text(_config: SmolPromptConfig) {
    const config = {
      ..._config,
      model: this.model.getResolvedModel(),
    };
    return text({ ...config, stream: false });
  }

  toJSON(): StrategyJSON {
    return { type: "id", params: { model: this.model.getResolvedModel() } };
  }
}
