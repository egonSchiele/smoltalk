/**
 * Looser whitespace in the grammar node-llama-cpp builds from a JSON schema.
 *
 * That grammar fixes the indentation: inside an array three levels deep, a
 * line break has to be followed by exactly twelve spaces, and the space
 * before the closing bracket is a single optional one. A model does not
 * write spaces one at a time. Qwen3.5 writes a run of thirteen spaces as one
 * token, which the grammar accepts as the twelve of indentation plus the
 * one before the bracket, and after that the bracket is the only token
 * left. Every array the 4B and 9B models wrote came back empty this way,
 * at any temperature.
 *
 * Here each whitespace rule is replaced by a short run of any whitespace,
 * so a long space token stays inside the indentation and the item can
 * follow. The run is bounded because an unbounded one let a model that
 * would rather not write JSON sit in it writing tabs until the token limit.
 */

/** The longest whitespace run the loosened rules accept. Longer than any
 *  one space-run token in the tokenizers seen so far, and short enough
 *  that a model stalling in whitespace is stopped within a few tokens. */
const MOST_WHITESPACE = 64;

/** The most line breaks a reply may end with. node-llama-cpp's root rule
 *  ends the JSON with four line breaks and then any number more, and a
 *  model that samples can write line breaks instead of stopping for as
 *  long as they are allowed: Gemma 4 spent ninety seconds on them after a
 *  one-line reply. After this many, the reply has to end. */
const MOST_TRAILING_BREAKS = 4;

/** `gbnf`, node-llama-cpp's grammar for a JSON schema, with its indentation
 *  rules loosened and its trailing line breaks bounded. A grammar without
 *  those rules is returned as it is. */
export function loosenJsonWhitespace(gbnf: string): string {
  const run = `[ \\t\\n]{0,${MOST_WHITESPACE}}`;
  return gbnf
    .replace(/^(whitespace-b-\d+-\d+-rule) ::= .*$/gm, `$1 ::= ${run}`)
    .replace(/^(comma-whitespace-b-\d+-\d+-rule) ::= .*$/gm, `$1 ::= "," ${run}`)
    .replace(/^(root ::= .*) "\\n\\n\\n\\n" \[\\n\]\*$/m, `$1 [\\n]{0,${MOST_TRAILING_BREAKS}}`);
}
