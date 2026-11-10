import { describe, it, expect } from "vitest";
import { LlamaJsonSchemaGrammar } from "node-llama-cpp";
import { grammarSchema } from "./grammarSchema.js";

/**
 * node-llama-cpp's own grammar builder and its own check, which is what a
 * tool call's arguments go through. Both are plain JavaScript; only the
 * native grammar object needs a loaded library, so a stand-in binding is
 * enough and no model is loaded. `parse` throws when the check rejects.
 */
function nodeLlamaCppParse(schema: unknown, value: unknown): unknown {
  const fakeLlama = { _bindings: { AddonGrammar: class {} } };
  const grammar = new LlamaJsonSchemaGrammar(fakeLlama as any, schema as any);
  return grammar.parse(JSON.stringify(value));
}

// The parameters of a fetch tool, as zod writes them for
// z.object({
//   url: z.string(),
//   path: z.string().nullable(),
//   headers: z.record(z.string(), z.any()).nullable(),
//   body: z.union([z.record(z.string(), z.any()), z.string(), z.null()]),
//   data: z.any().describe("anything"),
// })
const RECORD_OF_ANY = { type: "object", propertyNames: { type: "string" }, additionalProperties: {} };
const FETCH_PARAMS = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    url: { type: "string" },
    path: { anyOf: [{ type: "string" }, { type: "null" }] },
    headers: { anyOf: [RECORD_OF_ANY, { type: "null" }] },
    body: { anyOf: [RECORD_OF_ANY, { type: "string" }, { type: "null" }] },
    data: { description: "anything" },
  },
  required: ["url", "path", "headers", "body", "data"],
  additionalProperties: false,
};

const FETCH_ARGUMENTS = {
  "every optional value null": { url: "u", path: null, headers: null, body: null, data: null },
  "an optional value set": { url: "u", path: "/x", headers: null, body: "text", data: null },
  "a header value": { url: "u", path: null, headers: { accept: "text/html" }, body: null, data: null },
  "an object for an any parameter": { url: "u", path: null, headers: null, body: { a: 1 }, data: { k: [1, "two", null] } },
  "an array for an any parameter": { url: "u", path: null, headers: null, body: null, data: [true, 2] },
};

describe("node-llama-cpp's check of tool arguments", () => {
  it("throws on the schema as zod writes it", () => {
    expect(() =>
      nodeLlamaCppParse(FETCH_PARAMS, FETCH_ARGUMENTS["every optional value null"]),
    ).toThrow("Unknown immutable type undefined");
  });

  for (const [name, value] of Object.entries(FETCH_ARGUMENTS)) {
    it(`accepts ${name} once the schema is rewritten`, () => {
      expect(nodeLlamaCppParse(grammarSchema(FETCH_PARAMS), value)).toEqual(value);
    });
  }

  it("still rejects a value of the wrong type", () => {
    const value = { ...FETCH_ARGUMENTS["every optional value null"], path: 5 };
    expect(() => nodeLlamaCppParse(grammarSchema(FETCH_PARAMS), value)).toThrow();
  });
});

describe("grammarSchema", () => {
  it("turns a union of string literals into an enum", () => {
    // What zod writes for "positive" | "negative" | "neutral".
    const schema = {
      type: "object",
      properties: {
        labels: {
          type: "array",
          items: {
            anyOf: [
              { type: "string", const: "positive" },
              { type: "string", const: "negative" },
              { type: "string", const: "neutral" },
            ],
          },
        },
      },
    };
    expect(grammarSchema(schema)).toEqual({
      type: "object",
      properties: {
        labels: {
          type: "array",
          items: { type: "string", enum: ["positive", "negative", "neutral"] },
        },
      },
    });
  });

  it("turns any other anyOf into a oneOf, at every depth", () => {
    const schema = {
      anyOf: [
        { type: "number" },
        { type: "object", properties: { inner: { anyOf: [{ type: "string" }, { type: "null" }] } } },
      ],
    };
    expect(grammarSchema(schema)).toEqual({
      oneOf: [
        { type: "number" },
        { type: "object", properties: { inner: { oneOf: [{ type: "string" }, { type: "null" }] } } },
      ],
    });
  });

  it("keeps a const alternative with extra checks as a oneOf", () => {
    const schema = {
      anyOf: [
        { type: "string", const: "a", minLength: 1 },
        { type: "string", const: "b" },
      ],
    };
    expect(grammarSchema(schema)).toEqual({ oneOf: schema.anyOf });
  });

  it("writes out any value for a schema with no constraints, keeping its description", () => {
    const rewritten = grammarSchema({
      type: "object",
      properties: { data: { description: "anything" } },
      additionalProperties: {},
    }) as any;
    expect(rewritten.properties.data.description).toBe("anything");
    expect(rewritten.properties.data.oneOf).toEqual([
      { type: ["string", "number", "boolean", "null"] },
      { type: "array" },
      { type: "object", additionalProperties: true },
    ]);
    expect(rewritten.additionalProperties.oneOf).toHaveLength(3);
  });

  it("rewrites schemas inside items, $defs, and an anyOf alternative", () => {
    const rewritten = grammarSchema({
      type: "array",
      items: { $ref: "#/$defs/entry" },
      $defs: { entry: { anyOf: [{}, { type: "null" }] } },
    }) as any;
    expect(rewritten.items).toEqual({ $ref: "#/$defs/entry" });
    expect(rewritten.$defs.entry.oneOf[0].oneOf).toHaveLength(3);
    expect(rewritten.$defs.entry.oneOf[1]).toEqual({ type: "null" });
  });

  it("treats the boolean schema true as any value, except as additionalProperties", () => {
    const rewritten = grammarSchema({
      type: "object",
      properties: { list: { type: "array", items: true } },
      additionalProperties: true,
    }) as any;
    expect(rewritten.properties.list.items.oneOf).toHaveLength(3);
    expect(rewritten.additionalProperties).toBe(true);
  });

  it("leaves an empty object that is data, not a schema, as it is", () => {
    // A tool with no parameters, and a default value.
    const schema = {
      type: "object",
      properties: {},
      additionalProperties: false,
      default: {},
      examples: [{}],
    };
    expect(grammarSchema(schema)).toEqual(schema);
  });

  it("leaves a schema with no anyOf as it is, and does not change the input", () => {
    const schema = { type: "object", properties: { n: { type: "number" } }, anyOfLike: [1] };
    const copy = JSON.parse(JSON.stringify(schema));
    expect(grammarSchema(schema)).toEqual(copy);
    expect(schema).toEqual(copy);
  });
});
