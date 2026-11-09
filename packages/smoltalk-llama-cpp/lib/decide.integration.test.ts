import { describe, it, expect, afterAll } from "vitest";
import type { DecisionQuestion } from "smoltalk";
import { decide } from "./decide.js";
import { disposeAll } from "./nativeRegistry.js";

/**
 * Loads a real model file and asks one question of each type. Off unless
 * LLAMA_CPP_DECIDE_MODEL holds the path of a local .gguf, such as a Qwen 3.5
 * 0.8B file; no test resolves an hf: URI, so nothing is downloaded.
 */
const modelPath = process.env.LLAMA_CPP_DECIDE_MODEL;

const questions: Record<string, DecisionQuestion> = {
  department: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: { billing: "payments, refunds", support: "bugs, help", sales: "new purchases" },
  },
  urgency: {
    type: "score",
    instructions: "How urgent is this?",
    criteria: ["not urgent", "somewhat urgent", "urgent", "critical"],
  },
  churn: { type: "noul", instructions: "Does the customer threaten to leave?" },
};

describe.runIf(Boolean(modelPath))("decide with a real model file", () => {
  afterAll(async () => {
    await disposeAll();
  });

  it("answers one question of each type", { timeout: 120_000 }, async () => {
    const r = await decide(
      { subject: "Refund not received", body: "The refund never arrived. Fix it today or I leave." },
      questions,
      { model: modelPath! },
    );
    if (!r.success) throw new Error(r.error);
    const { answers, usage } = r.value;
    expect(answers.department.type).toBe("choice");
    expect(answers.urgency.type).toBe("score");
    expect(answers.churn.type).toBe("noul");
    if (answers.churn.type === "noul") {
      expect(answers.churn.noul).toBeGreaterThanOrEqual(0);
      expect(answers.churn.noul).toBeLessThanOrEqual(1);
    }
    if (answers.urgency.type === "score") {
      expect(Object.keys(answers.urgency.probabilities ?? {})).toEqual(["0", "1", "2", "3"]);
    }
    expect(usage.inputTokens).toBeGreaterThan(0);
  });
});
