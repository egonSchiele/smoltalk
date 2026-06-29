// Maintainer codegen: refresh the baked-in `textModels` array in lib/models.ts
// from models.dev. models.dev wins on the commodity fields it provides
// (pricing, context limits, dates, modalities, capability flags); smoltalk-only
// fields (description, reasoning, outputTokensPerSecond, disabled, costUnit) are
// preserved. A small curated set of new models is appended with hand-set
// provider/reasoning/description (models.dev supplies only the numbers).
//
// Run: pnpm tsx scripts/update-baked-models.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { textModels } from "../lib/models.js";
import { deepMergeEntry } from "../lib/modelData.js";
import { SMOLTALK_PROVIDERS, translateModelsDevEntry } from "./refresh-from-modelsdev.js";
import type { TextModel } from "../lib/models.js";

const MODELS_DEV_URL = "https://models.dev/api.json";

// Curated new models. models.dev supplies cost/limit/metadata via translate;
// these overlays set the smoltalk-specific provider/reasoning/description that
// models.dev cannot. Reasoning configs mirror the closest existing sibling and
// should be verified by a maintainer.
const NEW_MODELS: Record<string, Partial<TextModel>> = {
  "claude-haiku-4-5": {
    provider: "anthropic",
    description:
      "Undated alias for claude-haiku-4-5-20251001. The fastest Claude model with near-frontier intelligence.",
    reasoning: { thinkingStyle: "budget", canDisable: true, outputsThinking: true, outputsSignatures: true },
  },
  "claude-opus-4-5": {
    provider: "anthropic",
    description: "Claude Opus 4.5 — earlier Opus generation. Prefer claude-opus-4-8.",
    reasoning: { thinkingStyle: "budget", canDisable: true, outputsThinking: true, outputsSignatures: true },
  },
  "claude-sonnet-4-5": {
    provider: "anthropic",
    description: "Claude Sonnet 4.5 — earlier Sonnet generation. Prefer claude-sonnet-4-6.",
    reasoning: { thinkingStyle: "budget", canDisable: true, outputsThinking: true, outputsSignatures: true },
  },
  "gpt-5-pro": {
    provider: "openai-responses",
    description: "GPT-5 Pro uses more compute for complex reasoning tasks. Available via the Responses API.",
    reasoning: { canDisable: false, outputsThinking: false, outputsSignatures: false },
  },
};

async function buildDevByName(): Promise<Map<string, any>> {
  const res = await fetch(MODELS_DEV_URL);
  if (!res.ok) throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
  const api: any = await res.json();
  const byName = new Map<string, any>();
  for (const pid of Object.keys(SMOLTALK_PROVIDERS)) {
    const pd = api[pid];
    if (!pd?.models) continue;
    for (const id of Object.keys(pd.models)) {
      const t: any = translateModelsDevEntry(SMOLTALK_PROVIDERS[pid], pd.models[id]);
      if (t && !byName.has(t.modelName)) byName.set(t.modelName, t);
    }
  }
  return byName;
}

const NUMERIC = ["inputTokenCost", "outputTokenCost", "cachedInputTokenCost", "cacheCreationInputTokenCost", "maxInputTokens", "maxOutputTokens"];

const KEY_ORDER = [
  "type", "modelName", "description", "maxInputTokens", "maxOutputTokens",
  "inputTokenCost", "cachedInputTokenCost", "cacheCreationInputTokenCost", "outputTokenCost",
  "outputTokensPerSecond", "inputAudioTokenCost", "outputAudioTokenCost", "longContext",
  "reasoning", "modalities", "knowledge", "releaseDate", "lastUpdated", "family",
  "openWeights", "structuredOutput", "temperatureSupported", "costUnit", "disabled", "provider",
];

function serialize(value: any, indent: string): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => serialize(v, indent)).join(", ") + "]";
  }
  const inner = indent + "  ";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  const ordered = [
    ...KEY_ORDER.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !KEY_ORDER.includes(k)),
  ];
  const lines = ordered.map((k) => `${inner}${k}: ${serialize(value[k], inner)},`);
  return "{\n" + lines.join("\n") + "\n" + indent + "}";
}

async function main(): Promise<void> {
  const devByName = await buildDevByName();
  const priceChanges: string[] = [];
  const out: TextModel[] = [];

  for (const base of textModels as unknown as TextModel[]) {
    const dev = devByName.get(base.modelName);
    if (!dev) {
      out.push(base);
      continue;
    }
    for (const f of NUMERIC) {
      if (dev[f] !== undefined && dev[f] !== (base as any)[f]) {
        priceChanges.push(`  ${base.modelName}.${f}: ${(base as any)[f]} -> ${dev[f]}`);
      }
    }
    // provider is smoltalk's routing decision (e.g. gpt-5 is `openai-responses`,
    // not models.dev's `openai`) — never let the overlay change it.
    const merged = deepMergeEntry(base, dev) as TextModel;
    merged.provider = base.provider;
    out.push(merged);
  }

  const added: string[] = [];
  for (const name of Object.keys(NEW_MODELS)) {
    const dev = devByName.get(name);
    if (!dev) {
      console.warn(`Curated new model ${name} not found in models.dev — skipping`);
      continue;
    }
    out.push(deepMergeEntry(dev, NEW_MODELS[name]) as TextModel);
    added.push(name);
  }

  const literal =
    "export const textModels = [\n" +
    out.map((m) => "  " + serialize(m, "  ") + ",").join("\n") +
    "\n] as const;";

  const here = dirname(fileURLToPath(import.meta.url));
  const modelsPath = join(here, "..", "lib", "models.ts");
  const src = readFileSync(modelsPath, "utf8");
  const start = src.indexOf("export const textModels = [");
  if (start === -1) throw new Error("could not find textModels array");
  const endMarker = "] as const;";
  const end = src.indexOf(endMarker, start) + endMarker.length;
  const next = src.slice(0, start) + literal + src.slice(end);
  writeFileSync(modelsPath, next);

  console.log(`Updated ${out.length} text models (${textModels.length} existing + ${added.length} added).`);
  console.log(`\nNumeric changes (${priceChanges.length}):\n${priceChanges.join("\n")}`);
  console.log(`\nNew models added: ${added.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
