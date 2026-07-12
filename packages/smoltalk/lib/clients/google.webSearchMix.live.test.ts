/**
 * Real-API regression test for issue egonSchiele/agency-lang#495:
 * "Tool call context circulation is not enabled for models/gemini-2.5-flash".
 *
 * Verified matrix (function tools + hosted web_search in one request):
 *   - Gemini 3+ : works only with includeServerSideToolInvocations set.
 *   - Gemini 2.5: impossible by any means (both the flag and the raw
 *     combination 400) — the client now fails fast with a clear error.
 *
 * Runs only with GEMINI_API_KEY set, via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { text } from "../functions.js";
import { userMessage } from "../classes/message/index.js";

const haveKey = Boolean(process.env.GEMINI_API_KEY);
const TIMEOUT = 60_000;

const addTool = {
  name: "add",
  description: "Adds two integers.",
  schema: z.object({
    a: z.number().describe("first integer"),
    b: z.number().describe("second integer"),
  }),
};

describe.runIf(haveKey)("Gemini function tools + hosted web_search - real API", () => {
  it("Gemini 3+ combines function tools with web search and grounds", { timeout: TIMEOUT }, async () => {
    const r = await text({
      model: "gemini-3-flash-preview",
      messages: [
        userMessage(
          "Search the web for the latest stable release version of the TypeScript compiler, then tell me the version number.",
        ),
      ],
      tools: [addTool],
      hostedTools: ["web_search"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const ws = r.value.hostedToolResults?.find((h) => h.tool === "web_search");
      expect(ws).toBeDefined();
      expect((ws?.queries?.length ?? 0) > 0 || (ws?.sources?.length ?? 0) > 0).toBe(true);
    }
  });

  it("Gemini 2.5 fails fast with an actionable error (no cryptic 400)", { timeout: TIMEOUT }, async () => {
    // The client throws a terminal error before hitting the API (textSync
    // rethrows non-abort errors), so this is a rejection — our pre-flight
    // message, not Google's "Tool call context circulation" / "cannot be
    // combined" raw 400.
    await expect(
      text({
        model: "gemini-2.5-flash",
        messages: [userMessage("Use the add tool to add 3 and 4.")],
        tools: [addTool],
        hostedTools: ["web_search"],
      }),
    ).rejects.toThrow(/cannot use the hosted web_search tool together with function tools/);
  });
});
