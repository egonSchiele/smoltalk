import { describe, it, expect } from "vitest";
import { ModelNameSchema, ProviderSchema } from "./models.js";

describe("ModelNameSchema", () => {
  it("accepts slashed and @-versioned model ids", () => {
    expect(ModelNameSchema.safeParse("z-ai/glm-5.2").success).toBe(true);
    expect(
      ModelNameSchema.safeParse("accounts/fireworks/models/glm-x").success,
    ).toBe(true);
    expect(ModelNameSchema.safeParse("vendor/model@1.2").success).toBe(true);
    expect(ModelNameSchema.safeParse("openai/gpt-oss-20b").success).toBe(true);
  });

  it("still accepts plain model ids", () => {
    expect(ModelNameSchema.safeParse("gpt-4o-mini").success).toBe(true);
    expect(ModelNameSchema.safeParse("claude-sonnet-4-6").success).toBe(true);
    expect(ModelNameSchema.safeParse("deepseek-r1:8b").success).toBe(true);
  });

  it("still rejects clearly-malformed names", () => {
    expect(ModelNameSchema.safeParse("bad name!").success).toBe(false);
    expect(ModelNameSchema.safeParse("a b").success).toBe(false);
    expect(ModelNameSchema.safeParse("model<script>").success).toBe(false);
  });
});

describe("ProviderSchema", () => {
  it("includes the four hosted providers", () => {
    expect(ProviderSchema.safeParse("openrouter").success).toBe(true);
    expect(ProviderSchema.safeParse("deepinfra").success).toBe(true);
    expect(ProviderSchema.safeParse("litellm").success).toBe(true);
    expect(ProviderSchema.safeParse("openai-compat").success).toBe(true);
  });
});
