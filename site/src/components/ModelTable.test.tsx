import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelTable } from "./ModelTable";
import type { Column } from "../columns";
import { formatCost } from "../format";

type Row = { modelName: string; provider: string; cost?: number };

const rows: Row[] = [
  { modelName: "beta", provider: "openai", cost: 5 },
  { modelName: "alpha", provider: "google", cost: 10 },
  { modelName: "gamma", provider: "openai" },
];

const columns: Column<Row>[] = [
  {
    key: "modelName",
    label: "Model",
    sortValue: (row) => row.modelName,
    render: (row) => row.modelName,
  },
  {
    key: "cost",
    label: "Input",
    align: "right",
    sortValue: (row) => row.cost,
    render: (row) => formatCost(row.cost),
  },
];

function renderTable(overrides: Partial<Row>[] = []) {
  const data = overrides.length > 0 ? (overrides as Row[]) : rows;
  return render(
    <ModelTable
      rows={data}
      columns={columns}
      rowKey={(row) => row.modelName}
      isDeprecated={(row) => row.modelName === "gamma"}
    />,
  );
}

// The first cell holds the model name plus, for deprecated rows, a badge
// element. Reading the leading text node keeps these assertions about order.
const modelCells = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelectorAll("td")[0]?.firstChild?.textContent);

describe("ModelTable", () => {
  it("renders rows in registry order until a column is clicked", () => {
    renderTable();
    expect(modelCells()).toEqual(["beta", "alpha", "gamma"]);
  });

  it("sorts ascending, then descending, then back to registry order", async () => {
    const user = userEvent.setup();
    renderTable();
    const header = screen.getByRole("button", { name: /Input/ });

    await user.click(header);
    expect(modelCells()).toEqual(["beta", "alpha", "gamma"]);

    await user.click(header);
    expect(modelCells()).toEqual(["alpha", "beta", "gamma"]);

    await user.click(header);
    expect(modelCells()).toEqual(["beta", "alpha", "gamma"]);
  });

  it("exposes sort direction to assistive technology", async () => {
    const user = userEvent.setup();
    renderTable();
    const [, costHeader] = screen.getAllByRole("columnheader");

    expect(costHeader).toHaveAttribute("aria-sort", "none");
    await user.click(screen.getByRole("button", { name: /Input/ }));
    expect(costHeader).toHaveAttribute("aria-sort", "ascending");
  });

  it("marks deprecated rows and renders missing costs as an em dash", () => {
    renderTable();
    const gamma = screen.getByText("gamma").closest("tr");
    expect(gamma).toHaveClass("deprecated");
    expect(gamma?.querySelectorAll("td")[1]?.textContent).toBe("—");
  });
});
