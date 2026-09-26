/**
 * Live decision-model tests. Each suite runs only when its environment
 * variable is set:
 *
 *   TYPESAFE_API_KEY    — one request to Jev at TypeSafe.
 *   OPENROUTER_API_KEY  — one request to Jev through OpenRouter, which serves
 *                         it over the same protocol under the name jev-1.13.
 *   LAYA_BASE_URL       — one request to a Laya server (`laya-serve`), which
 *                         speaks the same protocol. The key is not used by
 *                         Laya but the provider requires one, so any value is
 *                         sent.
 */
import { describe, it, expect } from "vitest";
import { decide, type DecisionQuestion } from "./decide.js";

const state = {
  subject: "Refund not received",
  body: "I cancelled two weeks ago and the refund never arrived. If this is not fixed today I am leaving.",
};

const questions: Record<string, DecisionQuestion> = {
  department: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: {
      billing: "payments, invoices, refunds",
      support: "bugs, outages, help using the product",
      sales: "new purchases and upgrades",
    },
  },
  urgency: {
    type: "score",
    instructions: "How urgent is this?",
    criteria: ["not urgent", "somewhat urgent", "urgent", "critical"],
  },
  churn: { type: "noul", instructions: "Does the customer threaten to cancel or leave?" },
};

function checkShape(r: Awaited<ReturnType<typeof decide>>) {
  if (!r.success) throw new Error(r.error);
  const { answers, usage } = r.value;
  expect(answers.department.type).toBe("choice");
  if (answers.department.type === "choice") {
    expect(["billing", "support", "sales"]).toContain(answers.department.choice);
    expect(answers.department.confidence).toBeGreaterThanOrEqual(0);
    expect(answers.department.confidence).toBeLessThanOrEqual(1);
    const total = Object.values(answers.department.probabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 1);
  }
  expect(answers.urgency.type).toBe("score");
  if (answers.urgency.type === "score") {
    expect(answers.urgency.score).toBeGreaterThanOrEqual(0);
    expect(answers.urgency.score).toBeLessThanOrEqual(3);
    expect(Object.keys(answers.urgency.legend)).toHaveLength(4);
  }
  expect(answers.churn.type).toBe("noul");
  if (answers.churn.type === "noul") {
    expect(answers.churn.noul).toBeGreaterThanOrEqual(0);
    expect(answers.churn.noul).toBeLessThanOrEqual(1);
  }
  expect(usage.inputTokens).toBeGreaterThan(0);
}

describe.runIf(Boolean(process.env.TYPESAFE_API_KEY))("decide - Jev real API", () => {
  it("answers the ticket example", { timeout: 30_000 }, async () => {
    const r = await decide(state, questions, { model: "jev-latest" });
    checkShape(r);
    if (r.success) {
      expect(r.value.cost?.totalCost).toBeGreaterThan(0);
    }
  });
});

describe.runIf(Boolean(process.env.OPENROUTER_API_KEY))("decide - Jev through OpenRouter", () => {
  it("answers the ticket example", { timeout: 30_000 }, async () => {
    const r = await decide(state, questions, {
      model: "jev-1.13",
      apiKey: { typesafe: process.env.OPENROUTER_API_KEY },
      baseUrl: { typesafe: "https://openrouter.ai/api" },
    });
    checkShape(r);
    if (r.success) {
      expect(r.value.cost?.totalCost).toBeGreaterThan(0);
    }
  });
});

describe.runIf(Boolean(process.env.LAYA_BASE_URL))("decide - Laya server", () => {
  it("answers the ticket example through the same protocol", { timeout: 60_000 }, async () => {
    const r = await decide(state, questions, {
      model: "laya",
      provider: "typesafe",
      apiKey: { typesafe: "unused" },
      baseUrl: { typesafe: process.env.LAYA_BASE_URL },
    });
    checkShape(r);
    if (r.success) {
      expect(r.value.cost).toBeUndefined();
    }
  });
});
