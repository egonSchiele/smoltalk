import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSeedBlob } from "./seed-model-data.js";
import { mergeModelData } from "../lib/modelData.js";
import type { ModelDataBlob } from "../lib/modelData.js";
import type { ModelType, TextModel } from "../lib/models.js";

const MODELS_DEV_URL = "https://models.dev/api.json";

// models.dev provider id → smoltalk provider name.
export const SMOLTALK_PROVIDERS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  ollama: "ollama",
};

function isTextLike(entry: any): boolean {
  if (!entry.limit) {
    return false;
  }
  if (typeof entry.limit.context !== "number") {
    return false;
  }
  let output: string[] = [];
  if (entry.modalities && Array.isArray(entry.modalities.output)) {
    output = entry.modalities.output;
  }
  if (output.length > 0 && !output.includes("text")) {
    return false;
  }
  return true;
}

export function translateModelsDevEntry(
  provider: string,
  entry: any,
): ModelType | null {
  if (!isTextLike(entry)) {
    return null;
  }
  const cost = entry.cost || {};
  const model: TextModel = {
    type: "text",
    modelName: entry.id,
    provider,
    maxInputTokens: entry.limit.context,
    maxOutputTokens: entry.limit.output,
  };

  if (typeof cost.input === "number") {
    model.inputTokenCost = cost.input;
  }
  if (typeof cost.output === "number") {
    model.outputTokenCost = cost.output;
  }
  if (typeof cost.cache_read === "number") {
    model.cachedInputTokenCost = cost.cache_read;
  }
  if (typeof cost.cache_write === "number") {
    model.cacheCreationInputTokenCost = cost.cache_write;
  }
  if (typeof cost.input_audio === "number") {
    model.inputAudioTokenCost = cost.input_audio;
  }
  if (typeof cost.output_audio === "number") {
    model.outputAudioTokenCost = cost.output_audio;
  }
  if (cost.context_over_200k) {
    model.longContext = {
      thresholdTokens: 200000,
      inputTokenCost: cost.context_over_200k.input,
      outputTokenCost: cost.context_over_200k.output,
      cachedInputTokenCost: cost.context_over_200k.cache_read,
    };
  }
  if (typeof entry.knowledge === "string") {
    model.knowledge = entry.knowledge;
  }
  if (typeof entry.release_date === "string") {
    model.releaseDate = entry.release_date;
  }
  if (typeof entry.last_updated === "string") {
    model.lastUpdated = entry.last_updated;
  }
  if (typeof entry.family === "string") {
    model.family = entry.family;
  }
  if (typeof entry.open_weights === "boolean") {
    model.openWeights = entry.open_weights;
  }
  if (typeof entry.structured_output === "boolean") {
    model.structuredOutput = entry.structured_output;
  }
  if (typeof entry.temperature === "boolean") {
    model.temperatureSupported = entry.temperature;
  }
  if (entry.modalities) {
    model.modalities = {
      input: entry.modalities.input || [],
      output: entry.modalities.output || [],
    };
  }
  return model;
}

export function buildRefreshedBlob(apiJson: any, generatedAt: string): ModelDataBlob {
  const baseline = buildSeedBlob(generatedAt);
  const translated: ModelType[] = [];
  for (const providerId of Object.keys(SMOLTALK_PROVIDERS)) {
    const providerData = apiJson[providerId];
    if (!providerData || !providerData.models) {
      continue;
    }
    const smoltalkProvider = SMOLTALK_PROVIDERS[providerId];
    for (const modelId of Object.keys(providerData.models)) {
      const entry = providerData.models[modelId];
      const model = translateModelsDevEntry(smoltalkProvider, entry);
      if (model) {
        translated.push(model);
      }
    }
  }
  // baseline ◁ models.dev: models.dev wins per-field; baseline-only fields preserved.
  const models = mergeModelData(baseline.models, translated);
  return {
    schemaVersion: 1,
    generatedAt,
    models,
    hostedTools: baseline.hostedTools,
  };
}

async function main(): Promise<void> {
  const res = await fetch(MODELS_DEV_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch models.dev: HTTP ${res.status}`);
  }
  const apiJson = await res.json();
  const blob = buildRefreshedBlob(apiJson, new Date().toISOString());
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "..", "data", "model-data.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(blob, null, 2) + "\n");
  console.log(`Refreshed ${blob.models.length} models into ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
