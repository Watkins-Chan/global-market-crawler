/**
 * TradingView crypto coin scanner — `scanner.tradingview.com/coin/scan`.
 * Does not use crypto_domains / crypto_domain_groups (omitted by design).
 */

import { CRYPTO_SCAN_FIELDS, type CryptoScanFieldKind } from "./cryptoScanSchema.js";
import { parseTickerView, parseTrendFromPercent, stripUSD } from "./tradingview.js";

export type TradingViewCryptoCrawlOptions = {
  batchSize?: number;
  maxItems?: number;
  startOffset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  timeoutMs?: number;
  sleepMs?: number;
};

export type TradingViewCrawledCrypto = {
  ticker_full: string;
  symbol: string | null;
  name: string | null;
  logo_url: string | null;
  /** ~192 normalized fields; numeric kinds (`num`, `pct`, `usd`) are plain numbers. */
  tradingview_scan: Record<string, unknown>;
  crypto_rank: number | null;
  crypto_blockchain_ecosystems: string[] | null;
  crypto_common_categories: string[] | null;
  circulating_supply: number | null;
  crypto_consensus_algorithms: string[] | null;
  max_supply: number | null;
  total_supply: number | null;
  price: number | null;
  currency: string | null;
  change_24h_pct: number | null;
  perf_w_pct: number | null;
  perf_1m_pct: number | null;
  perf_ytd_pct: number | null;
  perf_y_pct: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  week_52_high: number | null;
  week_52_low: number | null;
  high_all: number | null;
  low_all: number | null;
  source: "tradingview";
  crawled_at: Date;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strArr(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

function normalizeScanCell(kind: CryptoScanFieldKind, raw: unknown): unknown {
  switch (kind) {
    case "json":
      return raw ?? null;
    case "num":
      return toNum(raw);
    case "pct":
      return parseTrendFromPercent(String(raw ?? "")).value;
    case "usd":
      return stripUSD(String(raw ?? ""));
    case "strings":
      return strArr(raw);
    case "raw":
      if (raw === null || raw === undefined || raw === "") return null;
      return raw;
    default:
      return raw ?? null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function postCoinScan(payload: unknown, timeoutMs: number): Promise<unknown> {
  const url = "https://scanner.tradingview.com/coin/scan?label-product=screener-coin";
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "text/plain;charset=UTF-8",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("TradingView coin scan error:", res.status, text.slice(0, 300));
    throw new Error(`TradingView coin scan failed: ${res.status}`);
  }
  return res.json();
}

function buildCoinPayload(rangeFrom: number, rangeTo: number, sortBy: string, sortOrder: "asc" | "desc"): unknown {
  return {
    columns: CRYPTO_SCAN_FIELDS.map((f) => f.column),
    ignore_unknown_fields: false,
    options: { lang: "en" },
    range: [rangeFrom, rangeTo],
    sort: { sortBy, sortOrder },
    markets: ["coin"],
    symbols: {},
  };
}

function buildTradingViewScan(d: unknown[]): Record<string, unknown> {
  const scan: Record<string, unknown> = {};
  for (let i = 0; i < CRYPTO_SCAN_FIELDS.length; i += 1) {
    const def = CRYPTO_SCAN_FIELDS[i]!;
    const raw = i < d.length ? d[i] : undefined;
    scan[def.key] = normalizeScanCell(def.kind, raw);
  }
  return scan;
}

function parseCoinRow(r: { s?: string; d?: unknown[] }): TradingViewCrawledCrypto | null {
  const symbolRaw = typeof r?.s === "string" ? r.s : null;
  if (!symbolRaw) return null;

  const d = Array.isArray(r?.d) ? r.d : [];
  const tradingview_scan = buildTradingViewScan(d);

  const tickerView = d[0];
  const tv = parseTickerView(tickerView);

  const crypto_rank = toNum(tradingview_scan.crypto_total_rank);
  const crypto_blockchain_ecosystems = strArr(tradingview_scan.crypto_blockchain_ecosystems);
  const crypto_common_categories = strArr(tradingview_scan.crypto_common_categories);
  const circulating_supply = toNum(tradingview_scan.circulating_supply);
  const crypto_consensus_algorithms = strArr(tradingview_scan.crypto_consensus_algorithms);
  const max_supply = toNum(tradingview_scan.max_supply);
  const total_supply = toNum(tradingview_scan.total_supply);

  const closeRaw = tradingview_scan.close;
  const price =
    typeof closeRaw === "number" ? closeRaw : stripUSD(String(closeRaw ?? "")) ?? toNum(closeRaw);

  const currency = tradingview_scan.currency;
  const currencyStr = typeof currency === "string" ? currency : null;

  return {
    ticker_full: symbolRaw,
    symbol: tv.symbol ?? symbolRaw.split(":").pop() ?? null,
    name: tv.name ?? null,
    logo_url: tv.logo_url ?? null,
    tradingview_scan,
    crypto_rank,
    crypto_blockchain_ecosystems,
    crypto_common_categories,
    circulating_supply,
    crypto_consensus_algorithms,
    max_supply,
    total_supply,
    price,
    currency: currencyStr,
    change_24h_pct: toNum(tradingview_scan.change),
    perf_w_pct: toNum(tradingview_scan.perf_W),
    perf_1m_pct: toNum(tradingview_scan.perf_1M),
    perf_ytd_pct: toNum(tradingview_scan.perf_YTD),
    perf_y_pct: toNum(tradingview_scan.perf_Y),
    market_cap: toNum(tradingview_scan.market_cap_calc),
    volume_24h: toNum(tradingview_scan.vc_24h_vol_cmc),
    week_52_high: toNum(tradingview_scan.price_52_week_high),
    week_52_low: toNum(tradingview_scan.price_52_week_low),
    high_all: toNum(tradingview_scan.high_all),
    low_all: toNum(tradingview_scan.low_all),
    source: "tradingview",
    crawled_at: new Date(),
  };
}

/**
 * Paginates all `coin` scanner rows (global crypto list).
 */
export async function crawlCryptocurrenciesFromTradingViewApi(
  options: TradingViewCryptoCrawlOptions = {},
): Promise<TradingViewCrawledCrypto[]> {
  const {
    batchSize = 100,
    maxItems,
    startOffset = 0,
    sortBy = "crypto_total_rank",
    sortOrder = "asc",
    timeoutMs = 25_000,
    sleepMs = 250,
  } = options;

  const out: TradingViewCrawledCrypto[] = [];
  let offset = startOffset;

  while (true) {
    const from = offset;
    const to = offset + batchSize - 1;
    const payload = buildCoinPayload(from, to, sortBy, sortOrder);

    let data: { data?: Array<{ s?: string; d?: unknown[] }> };
    try {
      data = (await postCoinScan(payload, timeoutMs)) as { data?: Array<{ s?: string; d?: unknown[] }> };
    } catch (error: unknown) {
      console.warn(`TradingView coin scan failed (offset ${offset}):`, error);
      break;
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += 1) {
      const parsed = parseCoinRow(rows[i]);
      if (parsed) out.push(parsed);
      if (maxItems && out.length >= maxItems) {
        return out;
      }
    }

    offset += batchSize;
    if (sleepMs > 0) await sleep(sleepMs);
  }

  return out;
}
