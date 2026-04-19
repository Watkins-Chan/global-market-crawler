/**
 * `CRYPTO_DISCOVERY_LIMIT` caps how many cryptocurrencies are ingested from the TradingView coin scanner.
 * `undefined` means no cap: TradingView coin scan runs until batches are empty.
 */

export function parseCryptoDiscoveryLimitFromEnv(): number | undefined {
  const raw = process.env.CRYPTO_DISCOVERY_LIMIT?.trim();
  if (raw === undefined || raw === "") {
    return undefined;
  }

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
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }
  if (n === 0) {
    return undefined;
  }
  return Math.floor(n);
}
