import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decide, type DecisionQuestion } from "./decide.js";

const questions: Record<string, DecisionQuestion> = {
  department: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: { billing: "payments, refunds", support: "help, bugs" },
  },
  urgency: {
    type: "score",
    instructions: "How urgent?",
    criteria: ["not urgent", "urgent", "critical"],
  },
  churn: { type: "noul", instructions: "Likely to cancel?" },
};

const answers = {
  department: {
    type: "choice",
    choice: "billing",
    confidence: 0.86,
    probabilities: { billing: 0.91, support: 0.09 },
  },
  urgency: {
    type: "score",
    score: 1.2,
    confidence: 0.6,
    legend: { "0": "not urgent", "1": "urgent", "2": "critical" },
    probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
  },
  churn: { type: "noul", noul: 0.1 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("decide", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TYPESAFE_API_KEY;
  const originalBase = process.env.TYPESAFE_BASE_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse({ model: "jev-1.13", answers, usage: { input_tokens: 42, output_tokens: 0 } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_BASE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.TYPESAFE_BASE_URL;
    else process.env.TYPESAFE_BASE_URL = originalBase;
  });

  const config = { model: "jev-latest", apiKey: { typesafe: "k" } };

  it("sends the documented request body to the systemone endpoint", async () => {
    const state = { subject: "Refund not received", body: "I cancelled two weeks ago" };
    const r = await decide(state, questions, config);
    expect(r.success).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    // The noul goes out with no criteria, as the Jev example request does.
    expect(JSON.parse(init.body as string)).toEqual({ model: "jev-latest", state, questions });
  });

  it("returns each answer with its type tag, the usage, and the reported model", async () => {
    const r = await decide("hello", questions, config);
    if (!r.success) throw new Error(r.error);
    expect(r.value.answers).toEqual(answers);
    expect(r.value.usage).toEqual({ inputTokens: 42, outputTokens: 0 });
    expect(r.value.model).toBe("jev-1.13");
  });

  it("reports the server's output tokens without pricing them", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answers, usage: { input_tokens: 1_000_000, output_tokens: 20 } }),
    );
    const r = await decide("hello", questions, config);
    if (!r.success) throw new Error(r.error);
    expect(r.value.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 20 });
    expect(r.value.cost?.outputCost).toBe(0);
    expect(r.value.cost?.totalCost).toBe(0.042);
  });

  it("prices a registry model by the requested name, not the versioned one the server reports", async () => {
    const r = await decide("hello", questions, config);
    if (!r.success) throw new Error(r.error);
    // 42 tokens at $0.042 per million.
    expect(r.value.cost).toEqual({
      inputCost: 0.000002,
      outputCost: 0,
      totalCost: 0.000002,
      currency: "USD",
    });
  });

  it("has no cost for a model the registry does not know", async () => {
    const r = await decide("hello", questions, {
      model: "laya-en",
      provider: "typesafe",
      apiKey: { typesafe: "k" },
    });
    if (!r.success) throw new Error(r.error);
    expect(r.value.cost).toBeUndefined();
  });

  it("fails before any request for an unknown model with no provider", async () => {
    const r = await decide("hello", questions, { model: "laya-en", apiKey: { typesafe: "k" } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/not recognized/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails before any request for a provider that is not typesafe", async () => {
    const r = await decide("hello", questions, { model: "gpt-4o-mini", apiKey: { typesafe: "k" } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/does not answer decisions/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the key from config, then the environment", async () => {
    process.env.TYPESAFE_API_KEY = "env-key";
    await decide("hello", questions, { model: "jev-latest" });
    let init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer env-key");

    await decide("hello", questions, config);
    init = fetchMock.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("fails without a key and names the setting", async () => {
    const r = await decide("hello", questions, { model: "jev-latest" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/TYPESAFE_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses baseUrl.typesafe for a Laya server and keeps the path", async () => {
    await decide("hello", questions, {
      ...config,
      baseUrl: { typesafe: "http://localhost:8000/" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/v1/systemone");
  });

  it("refuses an empty question map", async () => {
    const r = await decide("hello", {}, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/at least one question/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses more questions than the model accepts", async () => {
    const many: Record<string, DecisionQuestion> = {};
    for (let i = 0; i < 65; i++) {
      many[`q${i}`] = { type: "noul", instructions: `Question ${i}?` };
    }
    const r = await decide("hello", many, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/at most 64/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a choice with one option and a score with one level", async () => {
    const one = await decide(
      "hello",
      { d: { type: "choice", instructions: "?", criteria: { a: "only" } } },
      config,
    );
    expect(one.success).toBe(false);
    if (!one.success) expect(one.error).toMatch(/fewer than two options/);

    const level = await decide(
      "hello",
      { s: { type: "score", instructions: "?", criteria: ["one"] } },
      config,
    );
    expect(level.success).toBe(false);
    if (!level.success) expect(level.error).toMatch(/fewer than two levels/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails on an HTTP error with the status and body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad key" }, 401));
    const r = await decide("hello", questions, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/status 401/);
    expect(r.error).toMatch(/bad key/);
  });

  it("fails on a response with no answers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ model: "jev-1.13" }));
    const r = await decide("hello", questions, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/unexpected shape at answers/);
  });

  it("fails on an answer of an unknown type", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answers: { ...answers, churn: { type: "vibe", vibe: 1 } } }),
    );
    const r = await decide("hello", questions, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/unexpected shape at answers.churn/);
  });

  it("fails when a question has no answer", async () => {
    const { churn: _dropped, ...rest } = answers;
    fetchMock.mockResolvedValueOnce(jsonResponse({ answers: rest }));
    const r = await decide("hello", questions, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/no answer for question "churn"/);
  });

  it("fails when an answer has a different type than its question", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answers: { ...answers, churn: answers.department } }),
    );
    const r = await decide("hello", questions, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/"churn" is a noul but the answer is a choice/);
  });

  it("fails when a choice picks an option that was not offered", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answers: { ...answers, department: { ...answers.department, choice: "sales" } } }),
    );
    const r = await decide("hello", questions, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/"sales", which is not one of its options/);
  });

  it("fails when a noul or a confidence is not a probability", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answers: { ...answers, churn: { type: "noul", noul: 1.5 } } }),
    );
    const noul = await decide("hello", questions, config);
    expect(noul.success).toBe(false);
    if (!noul.success) expect(noul.error).toMatch(/noul of 1.5, which is not between 0 and 1/);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ answers: { ...answers, department: { ...answers.department, confidence: -0.2 } } }),
    );
    const conf = await decide("hello", questions, config);
    expect(conf.success).toBe(false);
    if (!conf.success) expect(conf.error).toMatch(/confidence of -0.2/);
  });

  it("fails when a choice has a probability for an option that was not offered", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        answers: {
          ...answers,
          department: { ...answers.department, probabilities: { billing: 0.9, sales: 0.1 } },
        },
      }),
    );
    const r = await decide("hello", questions, config);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/probability for "sales", which is not one of its options/);
  });

  it("fails when a score answer does not match the levels sent", async () => {
    const twoLevels = { ...answers.urgency, legend: { "0": "a", "1": "b" } };
    fetchMock.mockResolvedValueOnce(jsonResponse({ answers: { ...answers, urgency: twoLevels } }));
    const legend = await decide("hello", questions, config);
    expect(legend.success).toBe(false);
    if (!legend.success) expect(legend.error).toMatch(/has 3 levels but the answer's legend has 2/);

    const twoProbs = { ...answers.urgency, probabilities: { "0": 0.5, "1": 0.5 } };
    fetchMock.mockResolvedValueOnce(jsonResponse({ answers: { ...answers, urgency: twoProbs } }));
    const probs = await decide("hello", questions, config);
    expect(probs.success).toBe(false);
    if (!probs.success) expect(probs.error).toMatch(/has 3 levels but the answer has 2 probabilities/);

    const outOfRange = { ...answers.urgency, score: 3.5 };
    fetchMock.mockResolvedValueOnce(jsonResponse({ answers: { ...answers, urgency: outOfRange } }));
    const score = await decide("hello", questions, config);
    expect(score.success).toBe(false);
    if (!score.success) expect(score.error).toMatch(/score of 3.5, outside its 3 levels/);
  });

  it("fails without a request when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await decide("hello", questions, { ...config, abortSignal: controller.signal });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toBe("Request was aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails as aborted when the signal fires during the request", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("The operation was aborted")));
        controller.abort();
      });
    });
    const r = await decide("hello", questions, { ...config, abortSignal: controller.signal });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toBe("Request was aborted");
  });
});

describe("decide through OpenRouter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("knows jev-1.13 without an explicit provider and prices it", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: "typesafe/jev-1.13-20260917",
        answers: { churn: { type: "noul", noul: 0.97 } },
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await decide(
      "hello",
      { churn: { type: "noul", instructions: "Likely to cancel?" } },
      { model: "jev-1.13", apiKey: { typesafe: "or-key" }, baseUrl: { typesafe: "https://openrouter.ai/api" } },
    );
    if (!r.success) throw new Error(r.error);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/systemone");
    expect(r.value.cost?.totalCost).toBe(0.042);
    expect(r.value.model).toBe("typesafe/jev-1.13-20260917");
  });
});
