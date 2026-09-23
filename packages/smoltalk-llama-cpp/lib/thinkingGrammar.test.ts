import { describe, it, expect } from "vitest";
import { thinkingGrammar } from "./thinkingGrammar.js";

const json = [
  'root ::= "{" ws "\\"a\\"" ":" number "}"',
  "ws ::= [ ]?",
  'number ::= "-"? [0-9]+',
].join("\n");

describe("thinkingGrammar", () => {
  it("requires the block to close first when the wrapper opened it", () => {
    expect(thinkingGrammar(json, 1001, null).split("\n")).toEqual([
      "root ::= thinking-body <[1001]> thinking-gap thinking-json",
      "thinking-body ::= !<[1001]>*",
      "thinking-gap ::= [ \\t\\n]{0,4}",
      'thinking-json ::= "{" ws "\\"a\\"" ":" number "}"',
      "ws ::= [ ]?",
      'number ::= "-"? [0-9]+',
    ]);
  });

  it("makes the block optional when the model opens it itself", () => {
    const grammar = thinkingGrammar(json, 1001, 1000);
    expect(grammar.split("\n")[0]).toBe(
      "root ::= (<[1000]> thinking-body <[1001]>)? thinking-gap thinking-json",
    );
  });

  it("renames only the root rule", () => {
    const grammar = thinkingGrammar(json, 1001, null);
    expect(grammar.match(/^root ::=/gm)).toHaveLength(1);
    expect(grammar).toContain('thinking-json ::= "{"');
  });

  it("refuses a grammar with no root rule", () => {
    expect(() => thinkingGrammar("ws ::= [ ]?", 1001, null)).toThrow(
      "no root rule",
    );
  });
});
