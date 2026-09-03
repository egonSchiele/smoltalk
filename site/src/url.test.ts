import { describe, expect, it } from "vitest";
import { emptyFilter, filterToQuery, parseFilter } from "./url";

describe("parseFilter", () => {
  it("returns the default filter for an empty query string", () => {
    expect(parseFilter("")).toEqual(emptyFilter);
    expect(parseFilter("?")).toEqual(emptyFilter);
  });

  it("reads search, providers and the deprecated flag", () => {
    expect(parseFilter("?q=gpt&provider=openai,google&deprecated=1")).toEqual({
      search: "gpt",
      providers: ["openai", "google"],
      showDeprecated: true,
    });
  });

  it("ignores empty provider entries", () => {
    expect(parseFilter("?provider=,openai,").providers).toEqual(["openai"]);
  });
});

describe("filterToQuery", () => {
  it("is empty when nothing is filtered, so the URL stays clean", () => {
    expect(filterToQuery(emptyFilter)).toBe("");
  });

  it("omits defaults and includes only what is set", () => {
    expect(filterToQuery({ ...emptyFilter, search: "claude" })).toBe(
      "?q=claude",
    );
    expect(filterToQuery({ ...emptyFilter, showDeprecated: true })).toBe(
      "?deprecated=1",
    );
  });

  it("round-trips a fully populated filter", () => {
    const filter = {
      search: "flash",
      providers: ["google", "openai"],
      showDeprecated: true,
    };
    expect(parseFilter(filterToQuery(filter))).toEqual(filter);
  });
});
