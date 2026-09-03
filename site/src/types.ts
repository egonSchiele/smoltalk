/**
 * The registry, straight from the package.
 *
 * `smoltalk/models` is a Node-free entry point — the catalog and its merge
 * helpers, without the provider SDKs or the refresh fetcher — so it bundles
 * for the browser directly. There is no generated copy of this data.
 */
import {
  getAllModels,
  isEmbeddingsModel,
  isImageModel,
  isSpeechToTextModel,
  isTextModel,
  isTextToSpeechModel,
} from "smoltalk/models";

import type {
  EmbeddingsModel,
  ImageModel,
  SpeechToTextModel,
  TextModel,
  TextToSpeechModel,
} from "smoltalk/models";

export type {
  EmbeddingsModel,
  ImageModel,
  SpeechToTextModel,
  TextModel,
  TextToSpeechModel,
};

const all = getAllModels();

export const modelData = {
  /** Injected at build time from the smoltalk package version. */
  smoltalkVersion: __SMOLTALK_VERSION__,
  generatedAt: __BUILD_DATE__,
  text: all.filter(isTextModel),
  image: all.filter(isImageModel),
  embeddings: all.filter(isEmbeddingsModel),
  speechToText: all.filter(isSpeechToTextModel),
  textToSpeech: all.filter(isTextToSpeechModel),
};
