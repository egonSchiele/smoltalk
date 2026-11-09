export * from "./openai.js";

export function round(num: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.round(num * factor) / factor;
}

/** Token-cost prices in the model registry are quoted per 1M tokens. */
export const TOKENS_PER_MILLION = 1_000_000;

/** Round all dollar costs to 6 decimal places (1/100 of a cent). */
export const COST_DECIMAL_PLACES = 6;

/**
 * Compute the dollar cost of `tokens` at `costPerMillion` (USD per 1M tokens).
 * Returns 0 if either argument is missing or non-positive.
 */
export function tokenCost(
  tokens: number | undefined,
  costPerMillion: number | undefined,
): number {
  if (!tokens || !costPerMillion || tokens <= 0) return 0;
  return round(
    (tokens * costPerMillion) / TOKENS_PER_MILLION,
    COST_DECIMAL_PLACES,
  );
}

/**
 * Strip surrounding markdown code fences from a string. Returns the raw
 * input unchanged if no fences are present. Handles both the leading
 * ` ```json ` (case-insensitive, with optional trailing whitespace) and a
 * trailing ` ``` ` on its own line. Useful when LLMs return JSON wrapped
 * in markdown despite being asked for raw JSON.
 */
export function stripCodeFence(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
}

/**
 * Return a shallow copy of `obj` with all `undefined` values stripped out.
 * Useful when building request payloads where optional fields should only
 * appear when explicitly set.
 */
export function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== undefined) result[key] = value;
  }
  return result as T;
}

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

/**
 * Sanitizes an object by removing keys that could cause prototype pollution.
 * Returns a shallow copy with dangerous keys filtered out.
 */
export function sanitizeAttributes(
  attrs: Record<string, any> | undefined,
): Record<string, any> {
  if (!attrs) return {};
  const result: Record<string, any> = {};
  for (const key of Object.keys(attrs)) {
    if (!DANGEROUS_KEYS.has(key)) {
      result[key] = attrs[key];
    }
  }
  return result;
}

const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates that a tool name contains only safe characters.
 * Throws if the name contains characters outside [a-zA-Z0-9_-].
 */
export function validateToolName(name: string): void {
  if (!VALID_TOOL_NAME.test(name)) {
    throw new Error(
      `Invalid tool name "${name}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
}
