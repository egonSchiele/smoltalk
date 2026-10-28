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
 * failure was only the stringifying. Anything else (a string the schema
 * accepts, such as `body: "null"` for a parameter that takes strings, or a
 * set that still fails) is left as the model sent it, for the tool to report.
 *
 * The returned arguments are the model's, not Zod's parsed output, so a
 * schema's defaults and transforms are not applied here.
 */
export function repairStringifiedArguments(
  args: Record<string, unknown>,
  schema: ZodType,
): { args: Record<string, unknown>; repairedKeys: string[] } {
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return { args, repairedKeys: [] };
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
    return { args, repairedKeys: [] };
  }
  return { args: repaired, repairedKeys };
}
