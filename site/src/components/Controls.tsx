import type { FilterState } from "../filter";

type Props = {
  filter: FilterState;
  providers: string[];
  deprecatedCount: number;
  onChange: (next: FilterState) => void;
};

export function Controls({
  filter,
  providers,
  deprecatedCount,
  onChange,
}: Props) {
  const toggleProvider = (provider: string) => {
    const selected = filter.providers.includes(provider)
      ? filter.providers.filter((name) => name !== provider)
      : [...filter.providers, provider];
    onChange({ ...filter, providers: selected });
  };

  return (
    <div className="controls">
      <input
        type="search"
        className="search"
        placeholder="Search models and providers…"
        aria-label="Search models and providers"
        value={filter.search}
        onChange={(event) =>
          onChange({ ...filter, search: event.target.value })
        }
      />

      <div className="providers" role="group" aria-label="Filter by provider">
        {providers.map((provider) => {
          const selected = filter.providers.includes(provider);
          return (
            <button
              key={provider}
              type="button"
              className={selected ? "chip selected" : "chip"}
              aria-pressed={selected}
              onClick={() => toggleProvider(provider)}
            >
              {provider}
            </button>
          );
        })}
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={filter.showDeprecated}
          onChange={(event) =>
            onChange({ ...filter, showDeprecated: event.target.checked })
          }
        />
        Show deprecated ({deprecatedCount})
      </label>
    </div>
  );
}
