import type { FilterState } from "./filter";

export const emptyFilter: FilterState = {
  search: "",
  providers: [],
  showDeprecated: false,
};

/**
 * Reads filter state out of a query string so a filtered view is linkable.
 *
 * `known` restricts providers to ones the registry actually has. The query
 * string is user-editable, and an unrecognised provider would otherwise filter
 * everything away while rendering no chip the user could click to undo it.
 */
export function parseFilter(
  queryString: string,
  known?: readonly string[],
): FilterState {
  const params = new URLSearchParams(queryString);
  let providers = (params.get("provider") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  if (known) {
    providers = providers.filter((provider) => known.includes(provider));
  }

  return {
    search: params.get("q") ?? "",
    providers,
    showDeprecated: params.get("deprecated") === "1",
  };
}

/** The inverse. Defaults are omitted so an unfiltered page has a bare URL. */
export function filterToQuery(filter: FilterState): string {
  const params = new URLSearchParams();
  if (filter.search !== "") {
    params.set("q", filter.search);
  }
  if (filter.providers.length > 0) {
    params.set("provider", filter.providers.join(","));
  }
  if (filter.showDeprecated) {
    params.set("deprecated", "1");
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
