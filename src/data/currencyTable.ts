import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  /** Số đơn vị tiền này đổi được cho 1 USD (cùng quy ước open.er-api). `null` = dùng tỉ giá API. */
  units_per_usd: number | null;
}

export interface CurrencyTableFile {
  schemaVersion: number;
  meta: Record<string, string>;
  currencies: CurrencyRow[];
}

const raw = readFileSync(join(__dirname, "currencies.json"), "utf-8");
export const currencyTable: CurrencyTableFile = JSON.parse(raw) as CurrencyTableFile;

const byCode = new Map<string, CurrencyRow>();
for (const row of currencyTable.currencies) {
  byCode.set(row.code.toUpperCase(), row);
}

export function getCurrencyRow(code: string | null | undefined): CurrencyRow | undefined {
  if (!code?.trim()) return undefined;
  return byCode.get(code.trim().toUpperCase());
}

/**
 * Ghi đè `rates` từ API bằng `units_per_usd` trong file (khi có số dương).
 */
export function mergeManualUsdRatesInto(apiRates: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...apiRates, USD: 1 };
  for (const row of currencyTable.currencies) {
    const v = row.units_per_usd;
    if (v !== null && Number.isFinite(v) && v > 0) {
      out[row.code.toUpperCase()] = v;
    }
  }
  return out;
}
