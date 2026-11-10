/**
 * A JSON schema in the dialect node-llama-cpp reads.
 *
 * node-llama-cpp uses a JSON schema twice: it builds a grammar from it,
 * which limits what the model can write, and it checks the parsed value
 * against it (a tool call's arguments, every time). Both read a narrower
 * dialect than JSON Schema itself. They know `oneOf`, `const`, `enum`, and
 * `additionalProperties: true`, but not `anyOf`, and they have no schema
 * for "any value". A schema part they do not know becomes `null` in the
 * grammar, and the check throws `Unknown immutable type undefined` on it,
 * even when the value is `null`.
 *
 * zod writes both of the parts node-llama-cpp does not know:
 *
 * - `anyOf` for every union, including an optional parameter
 *   (`z.string().nullable()` is `anyOf: [string, null]`) and a union of
 *   string literals (`"positive" | "negative"`).
 * - `{}` for `z.any()`, alone or inside a record
 *   (`z.record(z.string(), z.any())` is `additionalProperties: {}`).
 *
 * So a tool with an optional parameter failed on every call, and a field
 * typed as one of three strings came back as `null`. Here every `anyOf`
 * becomes a `oneOf`, or an `enum` when every alternative is a string
 * constant, and every `{}` becomes `ANY_VALUE`. So does the boolean schema
 * `true`, except as `additionalProperties`, where node-llama-cpp reads it.
 *
 * The walk follows only the keys that hold a schema. A `{}` elsewhere is
 * data, not a schema: `properties: {}` (an object with no properties) or
 * `default: {}` must stay as they are.
 */

type Schema = Record<string, unknown>;

function isObject(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "Any JSON value", written in parts node-llama-cpp knows. An array with
 *  no `items` and an object with `additionalProperties: true` each take any
 *  JSON value inside, in the grammar and in the check. */
const ANY_VALUE = {
  oneOf: [
    { type: ["string", "number", "boolean", "null"] },
    { type: "array" },
    { type: "object", additionalProperties: true },
  ],
};

/** Keys that describe a schema without limiting its values. A schema with
 *  only these keys accepts any value. The same list as smoltalk's
 *  `isUnconstrainedSchema` (`lib/util/jsonSchema.ts`), which is not
 *  exported. */
const ANNOTATION_KEYS = [
  "$schema",
  "$id",
  "$anchor",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
];

/** Keys whose value is one schema. */
const SCHEMA_KEYS = [
  "additionalProperties",
  "items",
  "additionalItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "unevaluatedItems",
];

/** Keys whose value is a list of schemas. */
const SCHEMA_LIST_KEYS = ["oneOf", "allOf", "prefixItems"];

/** Keys whose value maps names to schemas. */
const SCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];

/** The string each alternative is pinned to, when every one is a string
 *  constant; otherwise undefined. */
function stringConstants(alternatives: unknown[]): string[] | undefined {
  const values: string[] = [];
  for (const alternative of alternatives) {
    if (!isObject(alternative) || typeof alternative.const !== "string") {
      return undefined;
    }
    const keys = Object.keys(alternative).filter(
      (key) => !["const", "type", "description", "title"].includes(key),
    );
    if (keys.length > 0 || (alternative.type !== undefined && alternative.type !== "string")) {
      return undefined;
    }
    values.push(alternative.const);
  }
  return values;
}

function acceptsAnyValue(schema: Schema): boolean {
  return Object.keys(schema).every((key) => ANNOTATION_KEYS.includes(key));
}

/** `schema` with every `anyOf` and every `{}` rewritten, at every depth.
 *  The input is not changed. */
export function grammarSchema(schema: unknown): unknown {
  if (schema === true) {
    // The boolean schema that accepts any value, the same as `{}`.
    return { ...ANY_VALUE };
  }
  if (!isObject(schema)) {
    return schema;
  }
  if (acceptsAnyValue(schema)) {
    return { ...schema, ...ANY_VALUE };
  }
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "anyOf" && Array.isArray(value)) {
      const constants = stringConstants(value);
      if (constants !== undefined) {
        out.type = "string";
        out.enum = constants;
      } else {
        out.oneOf = value.map(grammarSchema);
      }
    } else if (key === "additionalProperties" && typeof value === "boolean") {
      // node-llama-cpp reads both: `true` allows extra keys of any value,
      // `false` allows none.
      out[key] = value;
    } else if (SCHEMA_KEYS.includes(key)) {
      // `items` may also be a list, in older drafts.
      out[key] = Array.isArray(value) ? value.map(grammarSchema) : grammarSchema(value);
    } else if (SCHEMA_LIST_KEYS.includes(key) && Array.isArray(value)) {
      out[key] = value.map(grammarSchema);
    } else if (SCHEMA_MAP_KEYS.includes(key) && isObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, inner]) => [name, grammarSchema(inner)]),
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}
