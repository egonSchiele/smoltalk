/**
 * Real-API smoke tests for the embeddings feature.
 * Runs only with API keys set, via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { embed } from "../embed.js";

const TIMEOUT = 30_000;

describe.runIf(Boolean(process.env.OPENAI_API_KEY)).concurrent(
  "OpenAI Embeddings - real API",
  () => {
    it("single string", { timeout: TIMEOUT }, async () => {
      const r = await embed("hello world", {
        model: "text-embedding-3-small",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(1);
        expect(r.value.embeddings[0].length).toBeGreaterThan(0);
        expect(r.value.tokenUsage?.inputTokens).toBeGreaterThan(0);
        expect(r.value.costEstimate).toBeDefined();
      }
    });

    it("batch input", { timeout: TIMEOUT }, async () => {
      const r = await embed(["hello", "world", "foo"], {
        model: "text-embedding-3-small",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(3);
      }
    });

    it("with dimensions", { timeout: TIMEOUT }, async () => {
      const r = await embed("hello", {
        model: "text-embedding-3-small",
        dimensions: 256,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings[0]).toHaveLength(256);
      }
    });
  },
);

describe.runIf(Boolean(process.env.GEMINI_API_KEY)).concurrent(
  "Google Embeddings - real API",
  () => {
    it("single string", { timeout: TIMEOUT }, async () => {
      const r = await embed("hello world", {
        model: "gemini-embedding-001",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(1);
        expect(r.value.embeddings[0].length).toBeGreaterThan(0);
      }
    });

    it("batch input", { timeout: TIMEOUT }, async () => {
      const r = await embed(["hello", "world"], {
        model: "gemini-embedding-001",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.embeddings).toHaveLength(2);
      }
    });
  },
);
