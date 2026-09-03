export type SortDirection = "asc" | "desc";

export type SortState = { key: string; direction: SortDirection } | null;

export type SortValue = string | number | boolean | undefined | null;

/**
 * Header clicks cycle asc -> desc -> unsorted, so a column can always be
 * returned to the registry's own ordering. Clicking a different column starts
 * that column ascending.
 */
export function nextSortState(current: SortState, key: string): SortState {
  if (current === null || current.key !== key) {
    return { key, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { key, direction: "desc" };
  }
  return null;
}

function isMissing(value: SortValue): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  return typeof value === "number" && Number.isNaN(value);
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return String(a).localeCompare(String(b), "en", {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * Returns a sorted copy. Rows whose value is missing sort last in BOTH
 * directions rather than clustering at whichever end holds the low values —
 * plenty of models have no published price, and they would otherwise fill the
 * top of an ascending cost sort.
 */
export function sortRows<T>(
  rows: readonly T[],
  getValue: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  return [...rows].sort((a, b) => {
    const aValue = getValue(a);
    const bValue = getValue(b);
    const aMissing = isMissing(aValue);
    const bMissing = isMissing(bValue);

    if (aMissing && bMissing) {
      return 0;
    }
    if (aMissing) {
      return 1;
    }
    if (bMissing) {
      return -1;
    }

    const result = compare(aValue, bValue);
    return direction === "asc" ? result : -result;
  });
}
