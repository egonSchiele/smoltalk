/**
 * Emits src/data/models.json from the smoltalk registry.
 *
 * Reads `lib/models.ts` from source rather than the built package so the site
 * can be generated without building smoltalk first. Runs as predev/prebuild,
 * so the site's data is never staler than its last build.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  textModels,
  imageModels,
  embeddingsModels,
  speechToTextModels,
  textToSpeechModels,
} from "../../packages/smoltalk/lib/models.js";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, "..", "src", "data", "models.json");
const packageJsonPath = join(
  here,
  "..",
  "..",
  "packages",
  "smoltalk",
  "package.json",
);

async function smoltalkVersion(): Promise<string> {
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw).version as string;
}

async function main() {
  const payload = {
    generatedAt: new Date().toISOString(),
    smoltalkVersion: await smoltalkVersion(),
    text: textModels,
    image: imageModels,
    embeddings: embeddingsModels,
    speechToText: speechToTextModels,
    textToSpeech: textToSpeechModels,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const counts = [
    `${payload.text.length} text`,
    `${payload.image.length} image`,
    `${payload.embeddings.length} embeddings`,
    `${payload.speechToText.length} speech-to-text`,
    `${payload.textToSpeech.length} text-to-speech`,
  ].join(", ");
  console.log(`Wrote ${counts} from smoltalk ${payload.smoltalkVersion}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
