export type Filterable = {
  modelName: string;
  provider: string;
  disabled?: boolean;
};

export type FilterState = {
  search: string;
  providers: readonly string[];
  showDeprecated: boolean;
};

/**
 * Search matches model name or provider, so typing "anthropic" narrows to that
 * vendor's models without touching the provider checkboxes.
 */
export function filterModels<T extends Filterable>(
  rows: readonly T[],
  { search, providers, showDeprecated }: FilterState,
): T[] {
  const query = search.trim().toLowerCase();

  return rows.filter((row) => {
    if (row.disabled && !showDeprecated) {
      return false;
    }
    // An empty selection means "no provider constraint", not "nothing".
    if (providers.length > 0 && !providers.includes(row.provider)) {
      return false;
    }
    if (query === "") {
      return true;
    }
    return (
      row.modelName.toLowerCase().includes(query) ||
      row.provider.toLowerCase().includes(query)
    );
  });
}

/**
 * The provider list is derived from the data rather than hardcoded, so a
 * provider added to the registry shows up here on its own. Deprecated models
 * count: hiding a provider's only entry shouldn't remove its checkbox.
 */
export function collectProviders(rows: readonly Filterable[]): string[] {
  return [...new Set(rows.map((row) => row.provider))].sort();
}
