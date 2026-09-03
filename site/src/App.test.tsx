import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { modelData } from "./types";

/**
 * These run against the real generated models.json rather than fixtures, so
 * they fail if the generator, the column specs, and the registry ever drift
 * apart — the failure mode this site exists to avoid.
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
    // Guards against the generator silently emitting empty arrays.
    expect(modelData.text.length).toBeGreaterThan(0);
    expect(modelData.smoltalkVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
