import { describe, it, expect } from "vitest";
import { loosenJsonWhitespace } from "./jsonWhitespace.js";

// The grammar node-llama-cpp 3.21.1 builds for an object holding an array
// of strings, as it printed it.
const STOCK = [
  'root ::= "{" whitespace-b-1-4-rule "\\"labels\\"" ":" [ ]? rule1 whitespace-b-0-4-rule "}" "\\n\\n\\n\\n" [\\n]*',
  'val0 ::= "\\"positive\\""',
  "rule0 ::= ( val0 )",
  'comma-whitespace-b-2-4-rule ::= "," ([\\n] (" "{8} | "\\t\\t") | [ ]?)',
  'whitespace-b-2-4-rule ::= [\\n] (" "{8} | "\\t\\t") | [ ]?',
  'whitespace-b-1-4-rule ::= [\\n] ("    " | "\\t") | [ ]?',
  'rule1 ::= "[" whitespace-b-2-4-rule ( rule0 ( comma-whitespace-b-2-4-rule rule0 )* )? whitespace-b-1-4-rule "]"',
  "whitespace-b-0-4-rule ::= [\\n] | [ ]?",
].join("\n");

describe("loosenJsonWhitespace", () => {
  it("replaces every indentation rule with a bounded run of any whitespace, and bounds the trailing line breaks", () => {
    expect(loosenJsonWhitespace(STOCK).split("\n")).toEqual([
      'root ::= "{" whitespace-b-1-4-rule "\\"labels\\"" ":" [ ]? rule1 whitespace-b-0-4-rule "}" [\\n]{0,4}',
      'val0 ::= "\\"positive\\""',
      "rule0 ::= ( val0 )",
      'comma-whitespace-b-2-4-rule ::= "," [ \\t\\n]{0,64}',
      "whitespace-b-2-4-rule ::= [ \\t\\n]{0,64}",
      "whitespace-b-1-4-rule ::= [ \\t\\n]{0,64}",
      'rule1 ::= "[" whitespace-b-2-4-rule ( rule0 ( comma-whitespace-b-2-4-rule rule0 )* )? whitespace-b-1-4-rule "]"',
      "whitespace-b-0-4-rule ::= [ \\t\\n]{0,64}",
    ]);
  });

  it("leaves a grammar with no such rules alone", () => {
    const plain = 'root ::= "{" "}"';
    expect(loosenJsonWhitespace(plain)).toBe(plain);
  });
});
