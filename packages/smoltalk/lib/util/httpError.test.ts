import { describe, it, expect } from "vitest";
import { extractHttpErrorFields } from "./httpError.js";

describe("extractHttpErrorFields", () => {
  it("returns empty fields for non-objects", () => {
    expect(extractHttpErrorFields(undefined)).toEqual({});
    expect(extractHttpErrorFields("oops")).toEqual({});
    expect(extractHttpErrorFields(null)).toEqual({});
  });

  it("reads a numeric `status` (OpenAI/Anthropic/Google shape)", () => {
    expect(extractHttpErrorFields({ status: 429 })).toEqual({ status: 429 });
  });

  it("reads `statusCode` and `status_code` (Ollama shape)", () => {
    expect(extractHttpErrorFields({ statusCode: 503 })).toEqual({ status: 503 });
    expect(extractHttpErrorFields({ status_code: 404 })).toEqual({ status: 404 });
  });

  it("ignores a non-numeric status", () => {
    expect(extractHttpErrorFields({ status: "nope" })).toEqual({});
  });

  it("normalizes a web `Headers` instance", () => {
    const headers = new Headers({ "retry-after": "30", "x-request-id": "abc" });
    expect(extractHttpErrorFields({ status: 429, headers })).toEqual({
      status: 429,
      headers: { "retry-after": "30", "x-request-id": "abc" },
    });
  });

  it("normalizes a plain-object headers map", () => {
    expect(
      extractHttpErrorFields({ headers: { "X-Foo": "bar", skip: 5 } }),
    ).toEqual({ headers: { "X-Foo": "bar" } });
  });

  it("omits headers when empty", () => {
    expect(extractHttpErrorFields({ status: 500, headers: {} })).toEqual({
      status: 500,
    });
  });
});
