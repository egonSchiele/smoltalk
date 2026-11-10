import type { ReasoningRecord, ThinkingBlock } from "../types.js";

/** The client a request is being built for. */
export type ReplayTarget = {
  provider: string;
  model: string;
  /** False when `SmolConfig.replayReasoning` is false. Applies to reasoning
   *  records only, never to thinking blocks. */
  replayRecords: boolean;
};

/** True when `record` came from the model the request goes to, and records
 *  are being sent. Reasoning only works for the model that wrote it. */
export function canReplay(record: ReasoningRecord, target: ReplayTarget): boolean {
  return (
    target.replayRecords &&
    record.provider === target.provider &&
    record.model === target.model
  );
}

/** The fields to add to an OpenAI-style chat message for `record`. */
export function chatReasoningFields(record: ReasoningRecord): Record<string, unknown> {
  switch (record.format) {
    case "reasoning":
      if (record.details !== undefined) {
        return { reasoning_details: record.details };
      }
      return { reasoning: record.text };
    case "reasoning_content":
      return { reasoning_content: record.text };
    case "responsesItems":
      // Responses items are input items of their own, not chat fields.
      return {};
  }
}

/** The thinking blocks to send to `target`: those from its provider, and
 *  untagged ones, which were saved before blocks recorded a provider. */
export function replayableThinkingBlocks(
  blocks: ThinkingBlock[],
  target: ReplayTarget,
): ThinkingBlock[] {
  return blocks.filter(
    (block) => block.provider === undefined || block.provider === target.provider,
  );
}

/** The text fields a streamed detail piece adds to its entry. */
const JOINED_FIELDS = ["text", "summary", "data"];

/** Merge OpenRouter's streamed `reasoning_details` pieces into whole
 *  entries. Pieces that share an `index` are one entry: their `text`,
 *  `summary` and `data` are joined, and their other fields, such as
 *  `type`, `signature`, `format` and `id`, are kept from whichever piece
 *  has them. Entries come back in `index` order. A piece with no `index`
 *  is an entry of its own. Joining the arrays instead would split a
 *  signature from the text it signs. */
export function mergeReasoningDetails(pieces: unknown[]): unknown[] {
  const byIndex: Record<string, Record<string, unknown>> = {};
  const order: { index: number; entry: Record<string, unknown> }[] = [];
  for (const piece of pieces) {
    if (piece === null || typeof piece !== "object") continue;
    const fields = piece as Record<string, unknown>;
    const index = typeof fields.index === "number" ? fields.index : null;
    const key = index === null ? null : String(index);
    if (key === null || byIndex[key] === undefined) {
      const entry = { ...fields };
      if (key !== null) byIndex[key] = entry;
      order.push({ index: index ?? Number.MAX_SAFE_INTEGER, entry });
      continue;
    }
    const entry = byIndex[key];
    for (const [name, value] of Object.entries(fields)) {
      if (JOINED_FIELDS.includes(name) && typeof value === "string") {
        entry[name] = typeof entry[name] === "string" ? entry[name] + value : value;
      } else if (entry[name] === undefined) {
        entry[name] = value;
      }
    }
  }
  return order
    .map((item, position) => ({ ...item, position }))
    .sort((a, b) => a.index - b.index || a.position - b.position)
    .map((item) => item.entry);
}
