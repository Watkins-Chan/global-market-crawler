/**
 * `STOCK_DISCOVERY_LIMIT` controls how many stocks TradingView scanner returns.
 * `undefined` from this function means no cap (crawl until batches are empty).
 */

export function parseStockDiscoveryLimitFromEnv(): number | undefined {
  const raw = process.env.STOCK_DISCOVERY_LIMIT?.trim();
  if (raw === undefined || raw === "") return 5;

  const lower = raw.toLowerCase();
  if (
    lower === "all" ||
    lower === "full" ||
    lower === "unlimited" ||
    raw === "*" ||
    raw === "-1" ||
    raw === "0"
  ) {
    return undefined;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  if (n < 0) return 5;
  if (n === 0) return undefined;
  return Math.floor(n);
}
