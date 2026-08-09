import type { GenerateContentResponseUsageMetadata, ModalityTokenCount } from "@google/genai";
import type { TokenUsage } from "./types/tokenUsage.js";

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
  const audio =
    audioDirection === "input"
      ? modalityTokens(metadata.promptTokensDetails, "AUDIO")
      : modalityTokens(metadata.candidatesTokensDetails, "AUDIO") || candidates;
  return {
    inputTokens: audioDirection === "input" ? Math.max(0, prompt - audio) : prompt,
    outputTokens: audioDirection === "output" ? Math.max(0, candidates - audio) : candidates,
    ...(audioDirection === "input" && audio > 0 ? { inputAudioTokens: audio } : {}),
    ...(audioDirection === "output" && audio > 0 ? { outputAudioTokens: audio } : {}),
    ...(metadata.totalTokenCount !== undefined
      ? { totalTokens: metadata.totalTokenCount }
      : {}),
  };
}
