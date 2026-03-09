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
    const strategy = new FallbackStrategy(
      [new IDStrategy("gpt-4o"), new IDStrategy("claude-sonnet-4-6")],
      { fallbackOn: ["error", "timeout"] },
    );
    roundTrip(strategy);
  });

  it("FallbackStrategy with all fallback reasons round-trips correctly", () => {
    const strategy = new FallbackStrategy(
      [new IDStrategy("gpt-4o")],
      { fallbackOn: ["error", "timeout", "structuredOutputFailure"] },
    );
    roundTrip(strategy);
  });

  it("nested RaceStrategy inside FallbackStrategy round-trips correctly", () => {
    const strategy = new FallbackStrategy(
      [
        new RaceStrategy([
          new IDStrategy("gpt-4o"),
          new IDStrategy("claude-sonnet-4-6"),
        ]),
        new IDStrategy("gemini-2.0-flash"),
      ],
      { fallbackOn: ["error"] },
    );
    roundTrip(strategy);
  });

  it("nested FallbackStrategy inside RaceStrategy round-trips correctly", () => {
    const strategy = new RaceStrategy([
      new FallbackStrategy(
        [new IDStrategy("gpt-4o"), new IDStrategy("gemini-2.0-flash")],
        { fallbackOn: ["timeout"] },
      ),
      new IDStrategy("claude-sonnet-4-6"),
    ]);
    roundTrip(strategy);
  });

  it("deeply nested strategies round-trip correctly", () => {
    const strategy = new FallbackStrategy(
      [
        new RaceStrategy([
          new FallbackStrategy(
            [new IDStrategy("gpt-4o"), new IDStrategy("gpt-4o-mini")],
            { fallbackOn: ["error", "structuredOutputFailure"] },
          ),
          new IDStrategy("claude-sonnet-4-6"),
        ]),
        new IDStrategy("gemini-2.0-flash"),
      ],
      { fallbackOn: ["error", "timeout"] },
    );
    roundTrip(strategy);
  });
});
