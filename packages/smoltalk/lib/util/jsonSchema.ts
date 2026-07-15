/**
 * JSON Schema sanitization for structured output.
 *
 * Zod converts `z.any()` / `z.unknown()` to an unconstrained schema — a bare
 * `{}` (nested), `{"$schema":…}` (top-level), or the boolean `true`. That is
 * valid JSON Schema ("accept any value"), but every provider rejects an
 * unconstrained node inside a structured-output or strict-tool schema, since the
 * whole point of structured output is that it is structured. These helpers map
 * such nodes to `{"type":"string"}` (the safe universal container) and let
 * callers detect the whole-schema-is-`any` case so they can drop structured
 * output entirely and return free text.
 */

/**
 * Pure-annotation keywords. A node carrying *only* these constrains nothing, so
 * it is treated as unconstrained. Everything else — `type`, `properties`,
 * `enum`, `$ref`, any validation keyword — counts as constraining. This is an
 * allowlist, not a denylist of structural keywords, so unknown/future keywords
 * are constraining by default (the safe direction: never rewrite a schema that
 * means something).
 */
const ANNOTATION_KEYS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$comment",
  "description",
  "title",
  "default",
  "examples",
  "readOnly",
  "deprecated",
]);

/**
 * True if `node` accepts any value: the boolean `true`, or a plain object whose
 * every own key is a pure annotation (`{}`, `{$schema:…}`,
 * `{$schema:…, description:…}`). `false` and any object with a structural or
 * validation keyword are constrained.
 */
export function isUnconstrainedSchema(node: unknown): boolean {
  if (node === true) return true;
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return false;
  }
  return Object.keys(node).every((key) => ANNOTATION_KEYS.has(key));
}

/**
 * Convert a Zod `responseFormat` schema to a sanitized JSON Schema for a
 * provider's structured-output request: any nested unconstrained node becomes
 * `{"type":"string"}`. (The whole-schema-is-`any` case is handled upstream in
 * `BaseClient.normalizeResponseFormat`, which drops structured output entirely.)
 */
export function responseFormatToJsonSchema(schema: {
  toJSONSchema: () => unknown;
}): object {
  // Zod's top-level toJSONSchema() is always an object, and the whole-schema-is-
  // `any` case is stripped upstream, so sanitize always yields an object here.
  return sanitizeJsonSchema(schema.toJSONSchema()) as object;
}

/**
 * Subschema positions holding a single nested value schema (recursed into).
 *
 * `not` and `contains` are deliberately excluded: they are *assertions*, not
 * value slots, so an unconstrained schema there is meaningful and must not be
 * rewritten — `not: {}` means "reject everything" and would silently become
 * "reject only strings" if mapped to `{type:"string"}`. Zod never emits either,
 * so leaving them untouched is both correct and zero-impact in practice.
 */
const SCHEMA_KEYS = ["items", "propertyNames"] as const;

/** Subschema positions holding an object map of schemas. */
const SCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions"] as const;

/** Subschema positions holding an array of schemas. */
const SCHEMA_ARRAY_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;

/**
 * Returns a new JSON Schema with every unconstrained node replaced by
 * `{"type":"string"}` (annotations preserved), recursing through all subschema
 * positions. Idempotent — a node that already has `type` is left untouched.
 *
 * `additionalProperties` and `items` may be a boolean (`true`/`false`), which is
 * a legitimate provider-accepted flag, not an any-typed value slot; booleans
 * there are left as-is and only an object subschema is sanitized.
 */
export function sanitizeJsonSchema(node: unknown): unknown {
  if (node === true) return { type: "string" };
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return node;
  }

  if (isUnconstrainedSchema(node)) {
    return { ...(node as Record<string, unknown>), type: "string" };
  }

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  for (const key of SCHEMA_KEYS) {
    if (key in out) {
      out[key] = sanitizeSubschema(out[key]);
    }
  }

  for (const key of SCHEMA_MAP_KEYS) {
    const map = out[key];
    if (map && typeof map === "object" && !Array.isArray(map)) {
      // Object.create(null): a property literally named "__proto__" (a legal Zod
      // key) would otherwise reassign the prototype instead of setting an own key.
      const sanitized: Record<string, unknown> = Object.create(null);
      for (const [name, sub] of Object.entries(map)) {
        sanitized[name] = sanitizeJsonSchema(sub);
      }
      out[key] = sanitized;
    }
  }

  for (const key of SCHEMA_ARRAY_KEYS) {
    const arr = out[key];
    if (Array.isArray(arr)) {
      out[key] = arr.map((sub) => sanitizeJsonSchema(sub));
    }
  }

  // additionalProperties: leave booleans as-is, sanitize an object subschema.
  if ("additionalProperties" in out) {
    out.additionalProperties = sanitizeSubschema(out.additionalProperties);
  }

  return out;
}

/**
 * Sanitize a value at a single-schema position (`items`, `propertyNames`,
 * `additionalProperties`). These positions may legitimately hold a boolean:
 * `additionalProperties: false`/`true` and `items: false` are provider-accepted
 * flags, not any-typed value slots, so booleans pass through untouched and only
 * an object subschema is recursively sanitized. (Zod does not emit a boolean at
 * these positions, so `items: true` etc. are theoretical.)
 */
function sanitizeSubschema(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  return sanitizeJsonSchema(value);
}
