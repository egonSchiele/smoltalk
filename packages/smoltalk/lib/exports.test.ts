import { describe, it, expect } from "vitest";
import * as smoltalk from "./index.js";

describe("public exports", () => {
  it("exposes the model-data refresh API", () => {
    expect(typeof smoltalk.refreshModels).toBe("function");
    expect(typeof smoltalk.registerModelData).toBe("function");
    expect(typeof smoltalk.clearModelData).toBe("function");
    expect(typeof smoltalk.getHostedTools).toBe("function");
  });

  it("keeps the internal errorMessage helper out of the public API", () => {
    expect("errorMessage" in smoltalk).toBe(false);
  });

  it("exposes the decision provider registry", () => {
    expect(typeof smoltalk.registerDecisionProvider).toBe("function");
    expect(typeof smoltalk.hasDecisionProvider).toBe("function");
    expect(typeof smoltalk.unregisterDecisionProvider).toBe("function");
  });
});
