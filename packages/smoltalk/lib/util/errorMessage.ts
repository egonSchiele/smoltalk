/** The text of a caught value: an Error's message, or the value as a string.
 *  Internal: kept out of lib/util/util.ts, which lib/index.ts re-exports. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
