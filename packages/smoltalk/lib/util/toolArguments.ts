import type { ZodType } from "zod";

/**
 * A tool call's arguments, with any value a provider sent as JSON text put
 * back as the value it spells. Some OpenRouter endpoints, when a server tool
 * is in the request, send every argument as a string: `allowedDomains: "[]"`,
 * `timeout: "30000"`, `headers: "{}"`.
 *
 * Arguments that already parse against the tool's schema come back as they
 * are. Otherwise each top-level argument the schema rejected, whose value is a
 * string that parses as JSON, is replaced by the parsed value, and the result
 * is kept only if the whole set then parses. That is the case where the
 * failure was only the stringifying. A set that still fails is left as the
 * model sent it, for the tool to report.
 *
 * A string the schema accepts is never touched, even when it reads as JSON:
 * `body: "{}"` for a parameter typed `object | string` stays the two-character
 * string, because nothing says the model did not mean it. The one exception
 * is the text `"null"`. Once at least one key on the call has been repaired,
 * so the endpoint is known to stringify, a remaining value that is exactly
 * `"null"` is also replaced by `null` when the schema accepts that. Without
 * the first repair as evidence, `"null"` stays text.
 *
 * Known gap: on a stringifying endpoint, a parameter whose schema accepts a
 * string (`z.string().nullable()`, `z.any()`, a union with `z.string()`)
 * cannot be told apart from a value the model meant, so it goes through as
 * sent. Tools with such parameters should expect that.
 *
 * A schema that cannot be checked synchronously (an async refinement) is
 * left alone: the arguments come back as they are, never a throw. Any
 * refinement or transform on the schema does run as part of the check.
 *
 * The returned arguments are the model's, not Zod's parsed output, so a
 * schema's defaults and transforms are not applied here.
 */
export function repairStringifiedArguments(
  args: Record<string, unknown>,
  schema: ZodType,
): { args: Record<string, unknown>; repairedKeys: string[] } {
  const unchanged = { args, repairedKeys: [] };
  try {
    return repair(args, schema, unchanged);
  } catch {
    // safeParse itself threw (zod 4 does on an async refinement), so the
    // schema cannot be checked here. Leave the arguments as they came.
    return unchanged;
  }
}

function repair(
  args: Record<string, unknown>,
  schema: ZodType,
  unchanged: { args: Record<string, unknown>; repairedKeys: string[] },
): { args: Record<string, unknown>; repairedKeys: string[] } {
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return unchanged;
  }
  const rejectedKeys: string[] = [];
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !rejectedKeys.includes(key)) {
      rejectedKeys.push(key);
    }
  }
  const repaired: Record<string, unknown> = { ...args };
  const repairedKeys: string[] = [];
  for (const key of rejectedKeys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    try {
      repaired[key] = JSON.parse(value);
      repairedKeys.push(key);
    } catch {
      // Not JSON text, so not a stringified value.
    }
  }
  if (repairedKeys.length === 0 || !schema.safeParse(repaired).success) {
    return unchanged;
  }
  // The endpoint stringifies. A remaining "null" is its null, if the
  // schema takes one there.
  for (const key of Object.keys(repaired)) {
    if (repairedKeys.includes(key) || repaired[key] !== "null") continue;
    const withNull = { ...repaired, [key]: null };
    if (schema.safeParse(withNull).success) {
      repaired[key] = null;
      repairedKeys.push(key);
    }
  }
  return { args: repaired, repairedKeys };
}
