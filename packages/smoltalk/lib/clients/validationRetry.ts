import { userMessage } from "../classes/message/index.js";
import type { Message } from "../classes/message/index.js";

/**
 * The messages `textWithRetry` adds when a reply does not fit the response
 * format, and the test for them. A client that makes a tool round before the
 * format request (see structuredAfterTools.ts) uses the test to skip the tool
 * round on a retry.
 */

const FAILED_VALIDATION = "Your previous response failed validation.";
const RETURNED_UNDEFINED = `You returned "undefined" instead of a valid response.`;

export function failedValidationMessage(errorMessage: string) {
  return userMessage(
    `${FAILED_VALIDATION} Please fix the following errors and try again:\n${errorMessage}`,
  );
}

export function returnedUndefinedMessage() {
  return userMessage(`${RETURNED_UNDEFINED} Please provide a valid response.`);
}

/** Whether the last message asks the model to correct its previous reply. */
export function endsInValidationRetry(messages: Message[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return false;
  }
  const text = last.content;
  return text.startsWith(FAILED_VALIDATION) || text.startsWith(RETURNED_UNDEFINED);
}
