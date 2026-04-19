import { mergeManualUsdRatesInto } from "../data/currencyTable.js";

interface ExchangeRateResponse {
  base?: string;
  rates?: Record<string, number>;
}

/**
 * Units of each currency per 1 USD (open.er-api.com `latest/USD`),
 * sau đó ghi đè bằng `units_per_usd` trong `src/data/currencies.json` (nếu có).
 * Convert foreign → USD: `amountUsd = (amountForeign * amountScale) / rates[rateKey]`
 */
export async function fetchUsdQuoteRates(): Promise<Record<string, number>> {
  const response = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!response.ok) throw new Error(`Exchange rate request failed: ${response.status}`);
  const payload = (await response.json()) as ExchangeRateResponse;
  const rates = payload.rates ?? {};
  return mergeManualUsdRatesInto({ USD: 1, ...rates });
}

export async function fetchUsdVndRate(): Promise<number> {
  const rates = await fetchUsdQuoteRates();
  const vnd = rates.VND;
  if (!vnd || !Number.isFinite(vnd)) throw new Error("VND rate missing");
  return vnd;
}

/**
 * Map TradingView quote currency to the key used in `fetchUsdQuoteRates()` + unit scale.
 * GBX / GBp = pence → multiply by 0.01 then convert as GBP.
 */
export function resolveStockFx(tvCurrency: string | null | undefined): { rateKey: string; amountScale: number } {
  const raw = (tvCurrency ?? "USD").trim();
  const c = raw.toUpperCase();
  if (c === "" || c === "USD") return { rateKey: "USD", amountScale: 1 };
  if (c === "GBX" || raw === "GBp") return { rateKey: "GBP", amountScale: 0.01 };
  return { rateKey: c, amountScale: 1 };
}

/**
 * Convert a monetary amount from TradingView quote currency to USD.
 * Returns `null` if rate missing (caller may keep native currency).
 */
export function convertStockAmountToUsd(
  amount: number | null | undefined,
  tvCurrency: string | null | undefined,
  rates: Record<string, number>,
): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  const { rateKey, amountScale } = resolveStockFx(tvCurrency);
  const a = amount * amountScale;
  if (rateKey === "USD") return a;
  const r = rates[rateKey];
  if (r === undefined || !Number.isFinite(r) || r <= 0) return null;
  return a / r;
}
