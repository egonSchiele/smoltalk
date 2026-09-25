/**
 * A JSON schema in the dialect node-llama-cpp's grammar builder reads.
 *
 * node-llama-cpp turns a JSON schema into a grammar, but it reads a
 * narrower dialect than JSON Schema itself: it knows `oneOf`, `const`, and
 * `enum`, and it does not know `anyOf`. A schema part it does not know
 * becomes "any JSON value", quietly, so a field typed as one of three
 * strings can come back as `null`.
 *
 * `anyOf` is what zod writes for a union, including a union of string
 * literals (`"positive" | "negative" | "neutral"`), so a smoltalk caller
 * with an enum-shaped field hit this every time. Every `anyOf` here becomes
 * a `oneOf`, which the builder reads, and a `oneOf` of string constants
 * becomes an `enum`, which reads the same and makes a smaller grammar.
 */

type Schema = Record<string, unknown>;

function isObject(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

/** `schema` with every `anyOf` rewritten, at every depth. The input is not
 *  changed. */
export function grammarSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(grammarSchema);
  }
  if (!isObject(schema)) {
    return schema;
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
      continue;
    }
    out[key] = grammarSchema(value);
  }
  return out;
}
