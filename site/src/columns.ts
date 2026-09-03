import type { ReactNode } from "react";
import type { SortValue } from "./sort";
import {
  formatBytes,
  formatCost,
  formatCostPerMillion,
  formatRate,
  formatTokens,
  formatTokensExact,
  MISSING,
} from "./format";
import type {
  EmbeddingsModel,
  ImageModel,
  SpeechToTextModel,
  TextModel,
  TextToSpeechModel,
} from "./types";

export type Column<T> = {
  key: string;
  label: string;
  /** Column header tooltip, for units that don't fit in the label. */
  help?: string;
  align?: "left" | "right";
  sortValue: (row: T) => SortValue;
  render: (row: T) => ReactNode;
  /** Cell tooltip — used to expose exact values behind rounded display. */
  title?: (row: T) => string | undefined;
};

const modelNameColumn = <T extends { modelName: string }>(): Column<T> => ({
  key: "modelName",
  label: "Model",
  sortValue: (row) => row.modelName,
  render: (row) => row.modelName,
});

const providerColumn = <T extends { provider: string }>(): Column<T> => ({
  key: "provider",
  label: "Provider",
  sortValue: (row) => row.provider,
  render: (row) => row.provider,
});

export const textColumns: Column<TextModel>[] = [
  modelNameColumn(),
  providerColumn(),
  {
    key: "maxInputTokens",
    label: "Context",
    help: "Maximum input tokens",
    align: "right",
    sortValue: (row) => row.maxInputTokens,
    render: (row) => formatTokens(row.maxInputTokens),
    title: (row) => formatTokensExact(row.maxInputTokens),
  },
  {
    key: "maxOutputTokens",
    label: "Max out",
    help: "Maximum output tokens",
    align: "right",
    sortValue: (row) => row.maxOutputTokens,
    render: (row) => formatTokens(row.maxOutputTokens),
    title: (row) => formatTokensExact(row.maxOutputTokens),
  },
  {
    key: "inputTokenCost",
    label: "Input",
    help: "USD per 1M input tokens",
    align: "right",
    sortValue: (row) => row.inputTokenCost,
    render: (row) => formatCost(row.inputTokenCost),
  },
  {
    key: "cachedInputTokenCost",
    label: "Cached in",
    help: "USD per 1M cached input tokens",
    align: "right",
    sortValue: (row) => row.cachedInputTokenCost,
    render: (row) => formatCost(row.cachedInputTokenCost),
  },
  {
    key: "outputTokenCost",
    label: "Output",
    help: "USD per 1M output tokens",
    align: "right",
    sortValue: (row) => row.outputTokenCost,
    render: (row) => formatCost(row.outputTokenCost),
  },
  {
    key: "outputTokensPerSecond",
    label: "tok/s",
    help: "Measured output tokens per second",
    align: "right",
    sortValue: (row) => row.outputTokensPerSecond,
    render: (row) => formatRate(row.outputTokensPerSecond),
  },
  {
    key: "reasoning",
    label: "Reasoning",
    help: "Effort levels, where the model exposes them",
    sortValue: (row) => (row.reasoning ? 1 : 0),
    render: (row) => {
      if (!row.reasoning) {
        return MISSING;
      }
      return row.reasoning.levels?.join(" / ") ?? "yes";
    },
  },
  {
    key: "modalities",
    label: "Input types",
    sortValue: (row) => row.modalities?.input.join(","),
    render: (row) => row.modalities?.input.join(", ") ?? MISSING,
  },
  {
    key: "knowledge",
    label: "Cutoff",
    help: "Knowledge cutoff",
    sortValue: (row) => row.knowledge,
    render: (row) => row.knowledge ?? MISSING,
  },
];

export const imageColumns: Column<ImageModel>[] = [
  modelNameColumn(),
  providerColumn(),
  {
    key: "costPerImage",
    label: "Per image",
    help: "USD per generated image",
    align: "right",
    sortValue: (row) => row.costPerImage,
    render: (row) => formatCost(row.costPerImage),
  },
  {
    key: "outputImageTokenCost",
    label: "Image out",
    help: "USD per 1M image-output tokens, where billed by token",
    align: "right",
    sortValue: (row) => row.outputImageTokenCost,
    render: (row) => formatCost(row.outputImageTokenCost),
  },
  {
    key: "description",
    label: "Notes",
    sortValue: (row) => row.description,
    render: (row) => row.description ?? MISSING,
  },
];

export const embeddingsColumns: Column<EmbeddingsModel>[] = [
  modelNameColumn(),
  providerColumn(),
  {
    key: "tokenCost",
    label: "Per 1M tokens",
    help: "USD per 1M tokens",
    align: "right",
    sortValue: (row) => row.tokenCost,
    render: (row) => formatCost(row.tokenCost),
  },
];

export const speechToTextColumns: Column<SpeechToTextModel>[] = [
  modelNameColumn(),
  providerColumn(),
  {
    key: "perMinuteCost",
    label: "Per minute",
    help: "USD per minute of audio",
    align: "right",
    sortValue: (row) => row.perMinuteCost,
    render: (row) => formatCost(row.perMinuteCost),
  },
  {
    key: "minimumBillableSeconds",
    label: "Min billed",
    help: "Provider's minimum billable duration",
    align: "right",
    sortValue: (row) => row.minimumBillableSeconds,
    render: (row) =>
      row.minimumBillableSeconds === undefined
        ? MISSING
        : `${row.minimumBillableSeconds}s`,
  },
  {
    key: "maxBytes",
    label: "Max upload",
    align: "right",
    sortValue: (row) => row.maxBytes,
    render: (row) => formatBytes(row.maxBytes),
  },
];

export const textToSpeechColumns: Column<TextToSpeechModel>[] = [
  modelNameColumn(),
  providerColumn(),
  {
    key: "perCharacterCost",
    label: "Per 1M chars",
    help: "USD per 1M input characters",
    align: "right",
    sortValue: (row) => row.perCharacterCost,
    render: (row) => formatCostPerMillion(row.perCharacterCost),
  },
  {
    key: "inputTokenCost",
    label: "Input",
    help: "USD per 1M text-input tokens, where billed by token",
    align: "right",
    sortValue: (row) => row.inputTokenCost,
    render: (row) => formatCost(row.inputTokenCost),
  },
  {
    key: "outputAudioTokenCost",
    label: "Audio out",
    help: "USD per 1M audio-output tokens",
    align: "right",
    sortValue: (row) => row.outputAudioTokenCost,
    render: (row) => formatCost(row.outputAudioTokenCost),
  },
  {
    key: "maxInputChars",
    label: "Max chars",
    align: "right",
    sortValue: (row) => row.maxInputChars,
    render: (row) => formatTokens(row.maxInputChars),
  },
];
