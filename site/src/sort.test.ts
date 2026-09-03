import { describe, expect, it } from "vitest";
import { nextSortState, sortRows, type SortState } from "./sort";

type Row = { name: string; cost?: number };

const rows: Row[] = [
  { name: "beta", cost: 5 },
  { name: "alpha", cost: 10 },
  { name: "gamma" },
  { name: "delta", cost: 1 },
];

const byCost = (row: Row) => row.cost;
const byName = (row: Row) => row.name;

describe("nextSortState", () => {
  it("starts a new column ascending", () => {
    expect(nextSortState(null, "cost")).toEqual({
      key: "cost",
      direction: "asc",
    });
  });

  it("cycles ascending to descending to unsorted", () => {
    const asc: SortState = { key: "cost", direction: "asc" };
    const desc = nextSortState(asc, "cost");
    expect(desc).toEqual({ key: "cost", direction: "desc" });
    expect(nextSortState(desc, "cost")).toBeNull();
  });

  it("restarts ascending when a different column is clicked", () => {
    const desc: SortState = { key: "cost", direction: "desc" };
    expect(nextSortState(desc, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });
});

describe("sortRows", () => {
  it("sorts numbers ascending", () => {
    const sorted = sortRows(rows, byCost, "asc");
    expect(sorted.map((r) => r.name)).toEqual([
      "delta",
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("sorts numbers descending", () => {
    const sorted = sortRows(rows, byCost, "desc");
    expect(sorted.map((r) => r.name)).toEqual([
      "alpha",
      "beta",
      "delta",
      "gamma",
    ]);
  });

  it("keeps missing values last in both directions", () => {
    // A model with no published price must never crowd the top of the table.
    expect(sortRows(rows, byCost, "asc").at(-1)?.name).toBe("gamma");
    expect(sortRows(rows, byCost, "desc").at(-1)?.name).toBe("gamma");
  });

  it("sorts strings case-insensitively", () => {
    const mixed = [{ name: "Zeta" }, { name: "alpha" }] as Row[];
    expect(sortRows(mixed, byName, "asc").map((r) => r.name)).toEqual([
      "alpha",
      "Zeta",
    ]);
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    sortRows(rows, byCost, "asc");
    expect(rows).toEqual(original);
  });
});
