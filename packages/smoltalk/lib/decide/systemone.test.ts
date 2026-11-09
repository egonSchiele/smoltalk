import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DecisionQuestion } from "../decide.js";
import { systemoneDecide, SYSTEMONE_SERVERS } from "./systemone.js";

const questions: Record<string, DecisionQuestion> = {
  churn: { type: "noul", instructions: "Likely to cancel?" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>, call: number): Record<string, string> {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe("systemoneDecide", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("TYPESAFE_BASE_URL", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    fetchMock = vi.fn(async () =>
      jsonResponse({
        model: "jev-1.14",
        answers: { churn: { type: "noul", noul: 0.2 } },
        usage: { input_tokens: 12, output_tokens: 0 },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("posts the state and questions to the row's path under the base URL", async () => {
    const r = await systemoneDecide({ ticket: "refund" }, questions, {
      model: "jev-latest",
      provider: "typesafe",
      apiKey: { typesafe: "k" },
      baseUrl: { typesafe: "http://example.test/" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value).toEqual({
      answers: { churn: { type: "noul", noul: 0.2 } },
      usage: { inputTokens: 12, outputTokens: 0 },
      model: "jev-1.14",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://example.test/v1/systemone");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      model: "jev-latest",
      state: { ticket: "refund" },
      questions,
    });
    expect(sentHeaders(fetchMock, 0).Authorization).toBe("Bearer k");
  });

  it("uses OpenRouter's path and key", async () => {
    await systemoneDecide("hi", questions, {
      model: "jev-1.14",
      provider: "openrouter",
      apiKey: { openRouter: "or-key" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/systemone");
    expect(sentHeaders(fetchMock, 0).Authorization).toBe("Bearer or-key");
  });

  it("fails with the row's message when a key is required and missing", async () => {
    const r = await systemoneDecide("hi", questions, { model: "jev-latest", provider: "typesafe" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toBe(
      "No TypeSafe API key provided. Set config.apiKey.typesafe or the TYPESAFE_API_KEY environment variable.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the status of a non-2xx reply", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    const r = await systemoneDecide("hi", questions, {
      model: "jev-latest",
      provider: "typesafe",
      apiKey: { typesafe: "k" },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toBe("Decision request failed with status 429: slow down");
    expect(r.status).toBe(429);
  });

  it("fails on a reply that is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }));
    const r = await systemoneDecide("hi", questions, {
      model: "jev-latest",
      provider: "typesafe",
      apiKey: { typesafe: "k" },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toBe("Decision response is not JSON: <html>oops</html>");
  });

  it("fails on a reply with the wrong shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ answers: { churn: { type: "noul" } } }));
    const r = await systemoneDecide("hi", questions, {
      model: "jev-latest",
      provider: "typesafe",
      apiKey: { typesafe: "k" },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/^Decision response has an unexpected shape at answers\.churn\.noul/);
  });

  it("fails, not throws, for a row whose provider has no base URL", async () => {
    SYSTEMONE_SERVERS["no-base-url"] = { path: "/v1/systemone" };
    try {
      const r = await systemoneDecide("hi", questions, { model: "m", provider: "no-base-url" });
      expect(r).toEqual({
        success: false,
        error:
          'No base URL for provider "no-base-url": its row in SYSTEMONE_SERVERS needs a case in resolveBaseUrl (lib/util/provider.ts).',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete SYSTEMONE_SERVERS["no-base-url"];
    }
  });

  it("sends no Authorization header to a keyless server without a key, and the key when given", async () => {
    // No built-in row is keyless yet, so the typesafe row stands in for one:
    // a row's base URL comes from resolveBaseUrl, which has no case for a
    // made-up provider name.
    const original = SYSTEMONE_SERVERS.typesafe;
    SYSTEMONE_SERVERS.typesafe = { path: "/v1/systemone" };
    try {
      const config = {
        model: "laya",
        provider: "typesafe",
        baseUrl: { typesafe: "http://127.0.0.1:9" },
      };
      const without = await systemoneDecide("hi", questions, config);
      expect(without.success).toBe(true);
      expect(sentHeaders(fetchMock, 0).Authorization).toBeUndefined();

      await systemoneDecide("hi", questions, { ...config, apiKey: { typesafe: "proxy-key" } });
      expect(sentHeaders(fetchMock, 1).Authorization).toBe("Bearer proxy-key");
    } finally {
      SYSTEMONE_SERVERS.typesafe = original;
    }
  });
});
