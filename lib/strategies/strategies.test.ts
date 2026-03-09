import { describe, it, expect } from "vitest";
import { IDStrategy } from "./idStrategy.js";
import { RaceStrategy } from "./raceStrategy.js";
import { FallbackStrategy } from "./fallbackStrategy.js";
import { fromJSON } from "./index.js";

function roundTrip(strategy: { toJSON(): any }) {
  const json1 = strategy.toJSON();
  const restored = fromJSON(json1);
  const json2 = restored.toJSON();
  expect(json2).toEqual(json1);
  const restored2 = fromJSON(json2);
  const json3 = restored2.toJSON();
  expect(json3).toEqual(json1);
}

describe("Strategy toJSON/fromJSON round-trip", () => {
  it("IDStrategy round-trips correctly", () => {
    const strategy = new IDStrategy("gpt-4o");
    roundTrip(strategy);
  });

  it("RaceStrategy with IDStrategy children round-trips correctly", () => {
    const strategy = new RaceStrategy([
      new IDStrategy("gpt-4o"),
      new IDStrategy("claude-sonnet-4-6"),
    ]);
    roundTrip(strategy);
  });

  it("FallbackStrategy with IDStrategy children round-trips correctly", () => {
    const strategy = new FallbackStrategy(new IDStrategy("gpt-4o"), {
      error: [{ type: "id", params: { model: "claude-sonnet-4-6" } }],
      timeout: [{ type: "id", params: { model: "claude-sonnet-4-6" } }],
    });
    roundTrip(strategy);
  });

  it("FallbackStrategy with all fallback reasons round-trips correctly", () => {
    const strategy = new FallbackStrategy(new IDStrategy("gpt-4o"), {
      error: [{ type: "id", params: { model: "gpt-4o-mini" } }],
      timeout: [{ type: "id", params: { model: "gpt-4o-mini" } }],
      structuredOutputFailure: [
        { type: "id", params: { model: "gpt-4o-mini" } },
      ],
    });
    roundTrip(strategy);
  });

  it("nested RaceStrategy inside FallbackStrategy round-trips correctly", () => {
    const strategy = new FallbackStrategy(
      new RaceStrategy([
        new IDStrategy("gpt-4o"),
        new IDStrategy("claude-sonnet-4-6"),
      ]),
      {
        error: [{ type: "id", params: { model: "gemini-2.0-flash" } }],
      },
    );
    roundTrip(strategy);
  });

  it("nested FallbackStrategy inside RaceStrategy round-trips correctly", () => {
    const strategy = new RaceStrategy([
      new FallbackStrategy(new IDStrategy("gpt-4o"), {
        timeout: [{ type: "id", params: { model: "gemini-2.0-flash" } }],
      }),
      new IDStrategy("claude-sonnet-4-6"),
    ]);
    roundTrip(strategy);
  });

  it("deeply nested strategies round-trip correctly", () => {
    const strategy = new FallbackStrategy(
      new RaceStrategy([
        new FallbackStrategy(new IDStrategy("gpt-4o"), {
          error: [{ type: "id", params: { model: "gpt-4o-mini" } }],
          structuredOutputFailure: [
            { type: "id", params: { model: "gpt-4o-mini" } },
          ],
        }),
        new IDStrategy("claude-sonnet-4-6"),
      ]),
      {
        error: [{ type: "id", params: { model: "gemini-2.0-flash" } }],
        timeout: [{ type: "id", params: { model: "gemini-2.0-flash" } }],
      },
    );
    roundTrip(strategy);
  });
});
