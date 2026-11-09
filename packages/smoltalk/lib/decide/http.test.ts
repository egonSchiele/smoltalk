import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postDecisionRequest } from "./http.js";

function headersOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe("postDecisionRequest", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts the body as JSON with the key as a bearer token and returns the parsed reply", async () => {
    const r = await postDecisionRequest({
      endpoint: "http://example.test/v1/decisions",
      apiKey: "k",
      body: { a: 1 },
    });
    expect(r).toEqual({ success: true, value: { ok: 1 } });
    expect(fetchMock.mock.calls[0][0]).toBe("http://example.test/v1/decisions");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(headersOf(fetchMock)).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer k",
    });
  });

  it("sends no Authorization header without a key", async () => {
    await postDecisionRequest({ endpoint: "http://example.test", body: {} });
    expect(headersOf(fetchMock)).toEqual({ "Content-Type": "application/json" });
  });

  it("fails without a request when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await postDecisionRequest({
      endpoint: "http://example.test",
      body: {},
      signal: controller.signal,
    });
    expect(r).toEqual({ success: false, error: "Request was aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails as aborted when the signal fires during the request", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("The operation was aborted");
    });
    const r = await postDecisionRequest({
      endpoint: "http://example.test",
      body: {},
      signal: controller.signal,
    });
    expect(r).toEqual({ success: false, error: "Request was aborted" });
  });

  it("fails with the error text when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await postDecisionRequest({ endpoint: "http://example.test", body: {} });
    expect(r).toEqual({ success: false, error: "Decision request failed: ECONNREFUSED" });
  });

  it("carries the status of a non-2xx reply", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    const r = await postDecisionRequest({ endpoint: "http://example.test", body: {} });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toBe("Decision request failed with status 503: nope");
    expect(r.status).toBe(503);
  });

  it("fails on a reply that is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    const r = await postDecisionRequest({ endpoint: "http://example.test", body: {} });
    expect(r).toEqual({ success: false, error: "Decision response is not JSON: <html>" });
  });
});
