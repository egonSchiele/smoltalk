/**
 * Real-API smoke tests for the image generation feature.
 * Runs only with API keys set, via `pnpm test:live`.
 */
import { describe, it, expect } from "vitest";
import { image } from "../image.js";

const TIMEOUT = 60_000;

describe.runIf(Boolean(process.env.OPENAI_API_KEY))(
  "OpenAI Image - real API",
  () => {
    it("text-to-image", { timeout: TIMEOUT }, async () => {
      const r = await image("a small red cube on a white background", {
        model: "gpt-image-1",
        size: "1024x1024",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.images).toHaveLength(1);
        expect(r.value.images[0].data.byteLength).toBeGreaterThan(1000);
        expect(r.value.images[0].mimeType).toMatch(/^image\//);
      }
    });
  },
);

describe.runIf(Boolean(process.env.GEMINI_API_KEY))(
  "Google Image - real API",
  () => {
    it("text-to-image", { timeout: TIMEOUT }, async () => {
      const r = await image("a small red cube on a white background", {
        model: "gemini-2.5-flash-image-preview",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.value.images.length).toBeGreaterThan(0);
        expect(r.value.images[0].data.byteLength).toBeGreaterThan(1000);
      }
    });
  },
);
