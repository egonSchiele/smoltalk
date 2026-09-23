/**
 * A grammar for a typed reply from a thinking model.
 *
 * node-llama-cpp applies a grammar from a reply's first token. Since 3.20,
 * its Qwen chat wrapper opens a `<think>` block at the start of every reply.
 * Put the two together with a plain JSON grammar and the model writes the
 * JSON inside the block: node-llama-cpp files it as thinking, and
 * `result.response` comes back empty. A model that opens the block itself
 * has the opposite problem: the grammar never lets it, so it cannot think.
 *
 * The grammar here has two parts. Up to the token that closes the block,
 * anything goes. After it, the reply has to fit the schema. That is what
 * llama.cpp's own server does. The block is written with token ids rather
 * than text, because `</think>` is one token and the model has to be held
 * to that token, not to eight characters that happen to spell it.
 */

/** GBNF for a reply that may think, then must write JSON fitting
 *  `jsonGbnf`, the grammar node-llama-cpp derives from a JSON schema.
 *
 *  `openToken` is null when the chat wrapper has already opened the thought
 *  block, so the reply starts inside it and must close it before the JSON.
 *  Otherwise the block is optional, and starts with that token if the model
 *  wants to think. */
export function thinkingGrammar(
  jsonGbnf: string,
  closeToken: number,
  openToken: number | null,
): string {
  if (!/^root ::=/m.test(jsonGbnf)) {
    throw new Error("The JSON grammar has no root rule.");
  }
  const close = `<[${closeToken}]>`;
  const block =
    openToken === null
      ? `thinking-body ${close}`
      : `(<[${openToken}]> thinking-body ${close})?`;
  // The gap between the block and the JSON is bounded. Unbounded, a model
  // at greedy decoding that would rather not write JSON can sit in it,
  // writing tabs until the token limit; a bound forces the JSON to start.
  return [
    `root ::= ${block} thinking-gap thinking-json`,
    `thinking-body ::= !${close}*`,
    `thinking-gap ::= [ \\t\\n]{0,4}`,
    jsonGbnf.replace(/^root ::=/m, "thinking-json ::="),
  ].join("\n");
}
