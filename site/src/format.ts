/** Display formatting. Every formatter renders a missing value as an em dash. */

export const MISSING = "—";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const exact = new Intl.NumberFormat("en-US");

function trimTrailingZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** Context windows and token caps: 1048576 -> "1M", 65536 -> "65.5K". */
export function formatTokens(value: number | undefined): string {
  if (value === undefined) {
    return MISSING;
  }
  return compact.format(value);
}

/** The unrounded count, for a cell's title attribute. */
export function formatTokensExact(value: number | undefined): string {
  if (value === undefined) {
    return MISSING;
  }
  return `${exact.format(value)} tokens`;
}

/**
 * Dollar amounts. Two decimals at or above $1, up to four below it — the
 * registry carries costs as small as $0.005 per million tokens, and rounding
 * those to cents would erase the difference between models.
 */
export function formatCost(value: number | undefined): string {
  if (value === undefined) {
    return MISSING;
  }
  if (value === 0) {
    return "$0";
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  return `$${trimTrailingZeros(value.toFixed(4))}`;
}

/**
 * Scales a per-unit cost to a per-million cost. Speech models bill per
 * character; quoting them per million puts them on the same scale as the
 * token prices everywhere else on the page.
 */
export function formatCostPerMillion(value: number | undefined): string {
  if (value === undefined) {
    return MISSING;
  }
  return formatCost(value * 1_000_000);
}

/** Upload caps, in binary units. */
export function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return MISSING;
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${trimTrailingZeros(size.toFixed(1))} ${units[unit]}`;
}

/** Tokens per second, as a plain integer. */
export function formatRate(value: number | undefined): string {
  if (value === undefined) {
    return MISSING;
  }
  return exact.format(Math.round(value));
}

/** A date like "2026-09-01" or "2026-06"; returned as-is, or an em dash. */
export function formatDate(value: string | undefined): string {
  return value ?? MISSING;
}
