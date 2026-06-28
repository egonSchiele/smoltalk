import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  textModels,
  imageModels,
  speechToTextModels,
  embeddingsModels,
  hostedTools,
} from "../lib/models.js";
import type { ModelDataBlob } from "../lib/modelData.js";
import type { ModelType } from "../lib/models.js";

export function buildSeedBlob(generatedAt: string): ModelDataBlob {
  const models: ModelType[] = [
    ...(textModels as unknown as ModelType[]),
    ...(imageModels as unknown as ModelType[]),
    ...(speechToTextModels as unknown as ModelType[]),
    ...(embeddingsModels as unknown as ModelType[]),
  ];
  return {
    schemaVersion: 1,
    generatedAt,
    models,
    hostedTools,
  };
}

function main(): void {
  const blob = buildSeedBlob(new Date().toISOString());
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "..", "data", "model-data.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(blob, null, 2) + "\n");
  console.log(`Wrote ${blob.models.length} models + ${blob.hostedTools.length} hosted tools to ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
