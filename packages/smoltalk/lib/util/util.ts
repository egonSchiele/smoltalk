export * from "./openai.js";

export function round(num: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.round(num * factor) / factor;
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
