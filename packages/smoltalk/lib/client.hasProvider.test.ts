import { describe, it, expect, afterEach } from "vitest";
import {
  getClient,
  hasProvider,
  registerProvider,
  unregisterProvider,
} from "./client.js";
import { TestProvider } from "./testing/index.js";

afterEach(() => {
  unregisterProvider("llama-cpp");
});

describe("hasProvider", () => {
  it("is false for unregistered names and for built-ins alike", () => {
    expect(hasProvider("llama-cpp")).toBe(false);
    // Built-in switch cases are not its concern — only the custom registry.
    expect(hasProvider("openai")).toBe(false);
  });

  it("reflects register/unregister", () => {
    registerProvider("llama-cpp", TestProvider);
    expect(hasProvider("llama-cpp")).toBe(true);
    unregisterProvider("llama-cpp");
    expect(hasProvider("llama-cpp")).toBe(false);
  });
});

describe("getClient unknown-provider error for llama-cpp", () => {
  it("points at auto-loading and loadLlamaCpp instead of registerProvider", () => {
    expect(() =>
      getClient({ model: "/models/x.gguf", provider: "llama-cpp", messages: [] }),
    ).toThrow(/loads automatically.*loadLlamaCpp/s);
  });

  it("keeps the generic message for other unknown providers", () => {
    expect(() =>
      getClient({ model: "m", provider: "no-such-provider", messages: [] }),
    ).toThrow(/registerProvider/);
  });
});
