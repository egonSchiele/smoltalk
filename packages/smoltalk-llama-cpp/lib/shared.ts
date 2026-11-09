/** Helpers the plugin's embed and decide share. */

/** Two-plus characters before the colon, so a Windows drive letter is a
 *  path. The same rule LlamaCPP applies to config.model. */
export const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

/** The text of a caught value: an Error's message, or the value as a string. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
