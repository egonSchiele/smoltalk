import type { ReasoningRecord, ResponsesReasoningEntry, ThinkingBlock } from "../types.js";

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
 *  entries. Pieces that share an `index` and a `type` are one entry: their `text`,
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
    const key = index === null ? null : `${index}:${String(fields.type)}`;
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

/** The reasoning a chat client read from one completion message or one
 *  stream delta. */
export type ReasoningPart = {
  text: string;
  field: "reasoning" | "reasoning_content";
  /** OpenRouter's `reasoning_details`, or pieces of them while streaming. */
  details?: unknown[];
};

/** The reasoning text for logs and the record for sending back, from the
 *  parts of one reply. The record keeps the text only when no details came,
 *  so the reasoning is stored once. No record without a target, which is a
 *  client that does not know its provider. */
export function reasoningFromParts(
  parts: ReasoningPart[],
  target: ReplayTarget | undefined,
): { text?: string; record?: ReasoningRecord } {
  const text = parts.map((part) => part.text).join("");
  const pieces = parts.flatMap((part) => part.details ?? []);
  if (text === "" && pieces.length === 0) return {};
  const field = parts.find((part) => part.text !== "")?.field ?? parts[0].field;
  const result: { text?: string; record?: ReasoningRecord } = {};
  if (text !== "") result.text = text;
  if (target === undefined) return result;
  result.record =
    pieces.length > 0
      ? { provider: target.provider, model: target.model, text: "", format: field, details: mergeReasoningDetails(pieces) }
      : { provider: target.provider, model: target.model, text, format: field };
  return result;
}

/** The reasoning items of a Responses reply that can go back, each with the
 *  item directly after it: a function call's `call_id`, or "message" for the
 *  reply's text. An item is kept only when it carries `encrypted_content`:
 *  an item sent back by id alone fails when the conversation is not stored
 *  (`store: false`, or an organization with zero data retention). An item
 *  followed by anything else, such as a hosted web search, or by nothing, is
 *  dropped, because the API refuses a reasoning item sent without the item
 *  it led to. */
export function responsesReasoningEntries(output: any[]): ResponsesReasoningEntry[] {
  const entries: ResponsesReasoningEntry[] = [];
  output.forEach((item, position) => {
    if (item?.type !== "reasoning" || typeof item.encrypted_content !== "string") {
      return;
    }
    const next = output[position + 1];
    if (next?.type === "function_call") {
      entries.push({ item, followedBy: next.call_id });
    } else if (next?.type === "message") {
      entries.push({ item, followedBy: "message" });
    }
  });
  return entries;
}

/** The summary text of every reasoning item in a Responses reply, for
 *  logs, whether or not the item can go back. */
export function responsesReasoningText(output: any[]): string {
  return output
    .filter((item) => item?.type === "reasoning")
    .flatMap((item) => (item.summary ?? []) as { text?: string }[])
    .map((part) => part.text ?? "")
    .filter((text) => text !== "")
    .join("\n\n");
}
