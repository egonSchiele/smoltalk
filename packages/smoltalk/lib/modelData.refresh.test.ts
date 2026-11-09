import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getAllModels, type ModelType } from "./models.js";

type Entry = { type: string; provider: string; modelName: string };

/** Refreshed entries whose provider and name match a baked entry of another
 *  type. mergeModelData keys by type, provider, and name, so such an entry
 *  would be added as a second row instead of updating the baked one. */
function typeConflicts(baked: Entry[], refreshed: Entry[]): string[] {
  const bakedTypes: Record<string, string[]> = {};
  for (const m of baked) {
    const key = `${m.provider}:${m.modelName}`;
    if (bakedTypes[key] === undefined) {
      bakedTypes[key] = [];
    }
    bakedTypes[key].push(m.type);
  }
  const conflicts: string[] = [];
  for (const m of refreshed) {
    const types = bakedTypes[`${m.provider}:${m.modelName}`];
    if (types !== undefined && !types.includes(m.type)) {
      conflicts.push(`${m.type} ${m.provider}:${m.modelName} (baked as ${types.join(", ")})`);
    }
  }
  return conflicts;
}

describe("data/model-data.json", () => {
  it("has no entry that shares a provider and name with a baked entry of another type", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const blob = JSON.parse(readFileSync(join(here, "..", "data", "model-data.json"), "utf8"));
    const baked = getAllModels() as ModelType[];
    expect(typeConflicts(baked, blob.models)).toEqual([]);
  });

  it("reports such an entry", () => {
    const baked = [{ type: "speech-to-text", provider: "openai", modelName: "whisper-1" }];
    const refreshed = [{ type: "text", provider: "openai", modelName: "whisper-1" }];
    expect(typeConflicts(baked, refreshed)).toEqual([
      "text openai:whisper-1 (baked as speech-to-text)",
    ]);
  });
});
