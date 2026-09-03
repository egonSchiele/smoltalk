import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { modelData } from "./types";

/**
 * These run against the live registry imported from `smoltalk/models`, not
 * fixtures, so they fail if the column specs and the real catalog ever drift
 * apart — a model type losing its section, or a renamed field emptying a
 * column, shows up here rather than in production.
 */
describe("App", () => {
  it("renders a section per model type", () => {
    render(<App />);
    for (const title of [
      "Text",
      "Image",
      "Embeddings",
      "Speech to text",
      "Text to speech",
    ]) {
      // Anchored on the trailing count so "Text" doesn't also match
      // "Text to speech".
      expect(
        screen.getByRole("heading", { name: new RegExp(`^${title} \\d+$`) }),
      ).toBeInTheDocument();
    }
  });

  it("lists active models and hides deprecated ones by default", () => {
    render(<App />);
    expect(screen.getByText("claude-fable-5-1")).toBeInTheDocument();
    // gpt-4 is disabled: true in the registry.
    expect(screen.queryByText("gpt-4")).not.toBeInTheDocument();
  });

  it("reveals deprecated models when the toggle is checked", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByText("gpt-4")).toBeInTheDocument();
  });

  it("narrows to matching models as you search", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("searchbox"), "fable");
    expect(screen.getByText("claude-fable-5-1")).toBeInTheDocument();
    expect(screen.queryByText("gpt-5.6-sol")).not.toBeInTheDocument();
  });

  it("filters to one provider and drops sections with no matches", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "anthropic" }));
    expect(screen.getByText("claude-fable-5-1")).toBeInTheDocument();
    // Anthropic has no image models in the registry.
    expect(
      screen.queryByRole("heading", { name: /^Image/ }),
    ).not.toBeInTheDocument();
  });

  it("explains an empty result rather than showing bare headings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("searchbox"), "definitely-not-a-model");
    expect(screen.getByText(/No models match/)).toBeInTheDocument();
  });

  it("has a non-empty registry to render", () => {
    // Catches a stale or empty `smoltalk/models` build: the type guards would
    // filter every row away and each section would render nothing, which the
    // per-section assertions above cannot distinguish from a filter bug.
    expect(modelData.text.length).toBeGreaterThan(0);
    // The version comes from Vite's `define`; an unsubstituted constant fails.
    expect(modelData.smoltalkVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
