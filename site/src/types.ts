/**
 * Model types come straight from the smoltalk registry. This is a type-only
 * import — it is erased at compile time, so the browser bundle never pulls in
 * smoltalk (which reaches for node:fs) while the site's types stay exactly as
 * accurate as the package's.
 */
import type {
  EmbeddingsModel,
  ImageModel,
  SpeechToTextModel,
  TextModel,
  TextToSpeechModel,
} from "../../packages/smoltalk/lib/models";

import raw from "./data/models.json";

export type {
  EmbeddingsModel,
  ImageModel,
  SpeechToTextModel,
  TextModel,
  TextToSpeechModel,
};

export type ModelData = {
  generatedAt: string;
  smoltalkVersion: string;
  text: TextModel[];
  image: ImageModel[];
  embeddings: EmbeddingsModel[];
  speechToText: SpeechToTextModel[];
  textToSpeech: TextToSpeechModel[];
};

/**
 * The generated JSON is structurally the registry, but TypeScript infers it as
 * a wide literal shape (every optional field present-or-absent per entry), so
 * it is asserted rather than checked. The generator is the guarantee here: it
 * imports the typed arrays directly and only serializes them.
 */
export const modelData = raw as unknown as ModelData;
