import { useMemo, useState } from "react";
import type { Column } from "../columns";
import { nextSortState, sortRows, type SortState } from "../sort";

type Props<T> = {
  rows: readonly T[];
  columns: Column<T>[];
  /** Row identity — model names are unique within a section. */
  rowKey: (row: T) => string;
  isDeprecated?: (row: T) => boolean;
};

const ARROW = { asc: "↑", desc: "↓" } as const;

export function ModelTable<T>({
  rows,
  columns,
  rowKey,
  isDeprecated,
}: Props<T>) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (sort === null) {
      return rows;
    }
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) {
      return rows;
    }
    return sortRows(rows, column.sortValue, sort.direction);
  }, [rows, columns, sort]);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  className={column.align === "right" ? "right" : undefined}
                  aria-sort={
                    active
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((current) => nextSortState(current, column.key))
                    }
                    title={column.help}
                  >
                    <span>{column.label}</span>
                    <span className={active ? "arrow active" : "arrow"}>
                      {active ? ARROW[sort.direction] : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className={isDeprecated?.(row) ? "deprecated" : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.align === "right" ? "right" : undefined}
                  title={column.title?.(row)}
                >
                  {column.render(row)}
                  {column.key === "modelName" && isDeprecated?.(row) ? (
                    <span className="badge">deprecated</span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
