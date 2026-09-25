import { describe, it, expect } from "vitest";
import { grammarSchema } from "./grammarSchema.js";

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

  it("leaves a schema with no anyOf as it is, and does not change the input", () => {
    const schema = { type: "object", properties: { n: { type: "number" } }, anyOfLike: [1] };
    const copy = JSON.parse(JSON.stringify(schema));
    expect(grammarSchema(schema)).toEqual(copy);
    expect(schema).toEqual(copy);
  });
});
