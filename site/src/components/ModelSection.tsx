import type { Column } from "../columns";
import { filterModels, type Filterable, type FilterState } from "../filter";
import { ModelTable } from "./ModelTable";

type Props<T extends Filterable> = {
  title: string;
  rows: readonly T[];
  columns: Column<T>[];
  filter: FilterState;
};

/**
 * One model type's table. Renders nothing at all when the active filter
 * excludes every row — an empty table under a heading reads as a bug.
 */
export function ModelSection<T extends Filterable>({
  title,
  rows,
  columns,
  filter,
}: Props<T>) {
  const visible = filterModels(rows, filter);
  if (visible.length === 0) {
    return null;
  }

  return (
    <section>
      <h2>
        {title} <span className="count">{visible.length}</span>
      </h2>
      <ModelTable
        rows={visible}
        columns={columns}
        rowKey={(row) => `${row.provider}:${row.modelName}`}
        isDeprecated={(row) => row.disabled === true}
      />
    </section>
  );
}
