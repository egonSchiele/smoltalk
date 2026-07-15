import { describe, it, expect } from "vitest";
import { z } from "zod";
import { isUnconstrainedSchema, sanitizeJsonSchema } from "./jsonSchema.js";

describe("isUnconstrainedSchema", () => {
  it("treats an empty object as unconstrained", () => {
    expect(isUnconstrainedSchema({})).toBe(true);
  });

  it("treats the boolean true schema as unconstrained", () => {
    expect(isUnconstrainedSchema(true)).toBe(true);
  });

  it("treats a top-level z.any() ({$schema}) as unconstrained", () => {
    expect(isUnconstrainedSchema(z.any().toJSONSchema())).toBe(true);
  });

  it("treats an annotation-only object as unconstrained", () => {
    expect(
      isUnconstrainedSchema({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        description: "notes",
      }),
    ).toBe(true);
  });

  it("treats a typed schema as constrained", () => {
    expect(isUnconstrainedSchema({ type: "string" })).toBe(false);
  });

  it("treats a bare validation keyword as constrained (safe default)", () => {
    expect(isUnconstrainedSchema({ minimum: 0 })).toBe(false);
  });

  it("treats anyOf / properties as constrained", () => {
    expect(isUnconstrainedSchema({ anyOf: [{ type: "string" }] })).toBe(false);
    expect(isUnconstrainedSchema({ properties: {} })).toBe(false);
  });

  it("treats the boolean false schema as constrained", () => {
    expect(isUnconstrainedSchema(false)).toBe(false);
  });
});

describe("sanitizeJsonSchema", () => {
  it("maps a bare {} to {type:string}", () => {
    expect(sanitizeJsonSchema({})).toEqual({ type: "string" });
  });

  it("maps a boolean true to {type:string}", () => {
    expect(sanitizeJsonSchema(true)).toEqual({ type: "string" });
  });

  it("sanitizes a nested any property", () => {
    const input = z
      .object({ a: z.string(), b: z.any() })
      .toJSONSchema() as any;
    const out = sanitizeJsonSchema(input) as any;
    expect(out.properties.a).toEqual({ type: "string" });
    expect(out.properties.b).toEqual({ type: "string" });
  });

  it("sanitizes a single-schema items (z.array(z.any()))", () => {
    const input = z.array(z.any()).toJSONSchema() as any;
    const out = sanitizeJsonSchema(input) as any;
    expect(out.items).toEqual({ type: "string" });
  });

  it("leaves an assertion position (not) untouched", () => {
    // `not: {}` means "reject everything"; rewriting it to {type:"string"} would
    // flip it to "reject only strings".
    const out = sanitizeJsonSchema({ not: {} }) as any;
    expect(out.not).toEqual({});
  });

  it("keeps a __proto__ property as data without polluting the prototype", () => {
    // Computed key → an OWN "__proto__" property (a plain literal would set the
    // prototype instead). The sanitized map must carry it as data, not a proto.
    const input = {
      type: "object",
      properties: { ["__proto__"]: {} }, // unconstrained value → sanitized
    };
    const out = sanitizeJsonSchema(input) as any;
    const protoValue = Object.getOwnPropertyDescriptor(
      out.properties,
      "__proto__",
    )?.value;
    expect(protoValue).toEqual({ type: "string" });
    expect(({} as any).type).toBeUndefined(); // global prototype untouched
  });

  it("sanitizes an any array element (tuple prefixItems)", () => {
    const input = z.tuple([z.string(), z.any()]).toJSONSchema() as any;
    const out = sanitizeJsonSchema(input) as any;
    expect(out.prefixItems[0]).toEqual({ type: "string" });
    expect(out.prefixItems[1]).toEqual({ type: "string" });
  });

  it("sanitizes object additionalProperties but keeps propertyNames typed", () => {
    const input = z
      .record(z.string(), z.any())
      .toJSONSchema() as any;
    const out = sanitizeJsonSchema(input) as any;
    expect(out.additionalProperties).toEqual({ type: "string" });
    expect(out.propertyNames).toEqual({ type: "string" });
  });

  it("leaves boolean additionalProperties untouched", () => {
    const out = sanitizeJsonSchema({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    }) as any;
    expect(out.additionalProperties).toBe(false);
  });

  it("sanitizes an unconstrained anyOf branch", () => {
    const out = sanitizeJsonSchema({
      anyOf: [{ type: "string" }, {}],
    }) as any;
    expect(out.anyOf[1]).toEqual({ type: "string" });
  });

  it("preserves annotations while adding type:string", () => {
    const out = sanitizeJsonSchema({
      $schema: "s",
      description: "notes",
    }) as any;
    expect(out).toEqual({ $schema: "s", description: "notes", type: "string" });
  });

  it("leaves a real object schema untouched and is idempotent", () => {
    const real = {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
    };
    const once = sanitizeJsonSchema(real);
    expect(once).toEqual(real);
    expect(sanitizeJsonSchema(once)).toEqual(real);
  });
});
