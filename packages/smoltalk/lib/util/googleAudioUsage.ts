import type { GenerateContentResponseUsageMetadata, ModalityTokenCount } from "@google/genai";
import type { TokenUsage } from "../types/tokenUsage.js";

export type GoogleAudioDirection = "input" | "output";

function modalityTokens(
  details: ModalityTokenCount[] | undefined,
  modality: string,
): number {
  return (details ?? [])
    // `modality` is a MediaModality enum; compare by its string value.
    .filter((detail) => String(detail.modality) === modality)
    .reduce((sum, detail) => sum + (detail.tokenCount ?? 0), 0);
}

/**
 * Normalize Gemini's usage metadata into smoltalk's TokenUsage, separating the
 * audio bucket for the given direction so the token-priced cost engine can bill
 * it at the audio rate. STT sets audioDirection "input" (audio prompt tokens);
 * TTS sets "output" (audio candidate tokens).
 *
 * Thinking tokens (`thoughtsTokenCount`) are reported separately from
 * `candidatesTokenCount` and are always text — they go into the text-output
 * bucket, never the audio-output bucket.
 */
export function normalizeGoogleAudioUsage(
  metadata: GenerateContentResponseUsageMetadata | undefined,
  audioDirection: GoogleAudioDirection,
): TokenUsage | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const prompt = metadata.promptTokenCount ?? 0;
  const candidates = metadata.candidatesTokenCount ?? 0;
  const thoughts = metadata.thoughtsTokenCount ?? 0;

  if (audioDirection === "input") {
    const audioIn = modalityTokens(metadata.promptTokensDetails, "AUDIO");
    const usage: TokenUsage = {
      inputTokens: Math.max(0, prompt - audioIn),
      outputTokens: candidates + thoughts,
    };
    if (audioIn > 0) usage.inputAudioTokens = audioIn;
    if (metadata.totalTokenCount !== undefined) usage.totalTokens = metadata.totalTokenCount;
    return usage;
  }

  // Output (TTS): split the audio bucket out of candidate tokens. Only assume
  // "all candidates are audio" when the details array is missing/empty; when it
  // is present, trust its AUDIO total even if that total is 0 (otherwise
  // purely-text candidate tokens would be mispriced at the audio rate).
  const details = metadata.candidatesTokensDetails;
  const detailsPresent = Array.isArray(details) && details.length > 0;
  const audioOut = detailsPresent ? modalityTokens(details, "AUDIO") : candidates;
  const usage: TokenUsage = {
    inputTokens: prompt,
    outputTokens: Math.max(0, candidates - audioOut) + thoughts,
  };
  if (audioOut > 0) usage.outputAudioTokens = audioOut;
  if (metadata.totalTokenCount !== undefined) usage.totalTokens = metadata.totalTokenCount;
  return usage;
}
