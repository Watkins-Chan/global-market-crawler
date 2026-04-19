/**
 * TradingView scanner crawl — adapted from legacy crawler.
 * Domain / industryDomainMap removed per project requirements.
 */

export type Trend = "up" | "down" | "flat";

export type TradingViewCrawlOptions = {
  batchSize?: number;
  maxItems?: number;
  startOffset?: number;
  markets?: string[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  timeoutMs?: number;
  sleepMs?: number;
};

export type TradingViewCrawledStock = {
  type: "stock";
  exchange: string | null;
  symbol: string | null;
  name: string | null;
  logo_url: string | null;
  ticker_full: string;

  price: number | null;
  currency: string | null;

  change_percent_d: { raw: string | null; value: number | null; trend: Trend };
  volume_d: number | null;
  rel_volume_10d: number | null;
  market_cap: number | null;

  pe: number | null;
  eps_dil_ttm: number | null;
  eps_dil_growth_yoy: { raw: string | null; value: number | null; trend: Trend };

  div_yield_ttm: number | null;
  sector: string | null;
  industry: string | null;

  country: string | null;
  country_code: string | null;

  figi: string | null;
  float_shares: number | null;

  ipo_offer_date: string | null;
  ipo_offer_price_usd: number | null;

  beta_1y: number | null;
  eps_estimate: number | null;
  revenue_estimate: number | null;
  revenue_fy: number | null;
  net_income_fy: number | null;

  week_52_high: number | null;
  week_52_low: number | null;
  open: number | null;
  open_1w: number | null;
  open_1m: number | null;
  change_1w: number | null;
  change_1m: number | null;
  volatility_d: number | null;
  volatility_w: number | null;
  volatility_m: number | null;
  perf_ytd: number | null;
  volume_1m: number | null;
  change_abs: number | null;
  earnings_growth_pegy: number | null;

  indexes: Array<{ name: string; proname?: string }> | null;
  gross_profit_yoy_growth_ttm: number | null;
  number_of_employees_fy: number | null;
  average_volume_10d_calc: number | null;
  net_margin_fy: number | null;
  high_all: number | null;
  low_all: number | null;

  importance_rank: number;
  source: "tradingview";
  crawled_at: Date;
};

const DEFAULT_MARKETS = ["america"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeSpaces(s: unknown): string {
  return String(s ?? "")
    .replace(/\u202F/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripUSD(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = normalizeSpaces(value)
    .replace(/\s*USD$/i, "")
    .replace(/,/g, "")
    .trim();
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

export function parseTrendFromPercent(raw?: string | null): {
  raw: string | null;
  value: number | null;
  trend: Trend;
} {
  if (!raw) return { raw: null, value: null, trend: "flat" };

  const cleaned = normalizeSpaces(raw)
    .replace("−", "-")
    .replace("%", "")
    .trim();

  const kMatch = cleaned.match(/^(-?\d+(\.\d+)?)\s*K$/i);
  if (kMatch) {
    const num = parseFloat(kMatch[1] ?? "");
    if (Number.isNaN(num)) return { raw, value: null, trend: "flat" };
    const value = num * 1000;
    return { raw, value, trend: value > 0 ? "up" : value < 0 ? "down" : "flat" };
  }

  const num = parseFloat(cleaned);
  if (Number.isNaN(num)) return { raw, value: null, trend: "flat" };
  return { raw, value: num, trend: num > 0 ? "up" : num < 0 ? "down" : "flat" };
}

export function parseTickerView(tickerView: unknown): {
  symbol: string | null;
  name: string | null;
  logo_url: string | null;
} {
  if (!tickerView) return { symbol: null, name: null, logo_url: null };

  if (typeof tickerView === "object" && tickerView !== null) {
    const o = tickerView as Record<string, unknown>;
    const symbol = (o.short_name ?? o.name ?? o.ticker ?? null) as string | null;
    const name = (o.description ?? o.full_name ?? o.title ?? null) as string | null;
    const logoid = (o.logoid ?? o.logoId ?? null) as string | null;
    const logo_url =
      typeof o.logo_url === "string"
        ? o.logo_url
        : logoid
          ? `https://s3-symbol-logo.tradingview.com/${logoid}.svg`
          : null;

    return {
      symbol: symbol ? normalizeSpaces(symbol) : null,
      name: name ? normalizeSpaces(name) : null,
      logo_url: logo_url ? normalizeSpaces(logo_url) : null,
    };
  }

  if (typeof tickerView === "string") {
    return { symbol: normalizeSpaces(tickerView), name: null, logo_url: null };
  }

  return { symbol: null, name: null, logo_url: null };
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

async function postScan(payload: unknown, opts: { market: string; timeoutMs: number }): Promise<unknown> {
  const url = `https://scanner.tradingview.com/${opts.market}/scan?label-product=screener-stock`;

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
    opts.timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("TradingView scan error:", res.status, text.slice(0, 300));
    throw new Error(`TradingView API failed: ${res.status}`);
  }

  return res.json();
}

function buildPayload(rangeFrom: number, rangeTo: number, sortBy: string, sortOrder: "asc" | "desc"): unknown {
  return {
    columns: [
      "ticker-view",
      "close",
      "currency",
      "change",
      "volume",
      "relative_volume_10d_calc",
      "market_cap_basic",
      "price_earnings_ttm",
      "earnings_per_share_diluted_ttm",
      "earnings_per_share_diluted_yoy_growth_ttm",
      "dividends_yield_current",
      "sector.tr",
      "country.tr",
      "country_code_fund",
      "figi.exchange-level",
      "float_shares_outstanding_current",
      "industry.tr",
      "ipo_offer_date",
      "ipo_offer_price_usd",
      "beta_1_year",
      "earnings_per_share_forecast_next_fq",
      "revenue_forecast_next_fq",
      "total_revenue_fy",
      "net_income_fy",
      "price_52_week_high",
      "price_52_week_low",
      "open",
      "open|1W",
      "open|1M",
      "change|1W",
      "change|1M",
      "Volatility.D",
      "Volatility.W",
      "Volatility.M",
      "Perf.YTD",
      "volume|1M",
      "change_abs",
      "price_earnings_growth_ttm",
      "indexes.tr",
      "gross_profit_yoy_growth_ttm",
      "number_of_employees_fy",
      "average_volume_10d_calc",
      "net_margin_fy",
      "High.All",
      "Low.All",
    ],
    filter: [{ left: "is_primary", operation: "equal", right: true }],
    ignore_unknown_fields: false,
    options: { lang: "en" },
    range: [rangeFrom, rangeTo],
    sort: { sortBy, sortOrder },
    markets: ["america"],
    symbols: {},
    filter2: {
      operator: "and",
      operands: [
        {
          operation: {
            operator: "or",
            operands: [
              {
                operation: {
                  operator: "and",
                  operands: [
                    { expression: { left: "type", operation: "equal", right: "stock" } },
                    { expression: { left: "typespecs", operation: "has", right: ["common"] } },
                  ],
                },
              },
              {
                operation: {
                  operator: "and",
                  operands: [
                    { expression: { left: "type", operation: "equal", right: "stock" } },
                    { expression: { left: "typespecs", operation: "has", right: ["preferred"] } },
                  ],
                },
              },
              { operation: { operator: "and", operands: [{ expression: { left: "type", operation: "equal", right: "dr" } }] } },
              {
                operation: {
                  operator: "and",
                  operands: [
                    { expression: { left: "type", operation: "equal", right: "fund" } },
                    { expression: { left: "typespecs", operation: "has_none_of", right: ["etf"] } },
                  ],
                },
              },
            ],
          },
        },
        { expression: { left: "typespecs", operation: "has_none_of", right: ["pre-ipo"] } },
      ],
    },
  };
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeIpoDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    if (n > 1e12) return new Date(n).toISOString();
    // Unix seconds (9–10 digits, e.g. 916963200)
    if (n >= 1e8 && n < 1e12) return new Date(n * 1000).toISOString();
    return v;
  }
  if (typeof v === "number") {
    if (v > 1e12) return new Date(v).toISOString();
    if (v >= 1e8 && v < 1e12) return new Date(v * 1000).toISOString();
  }
  return typeof v === "string" ? v : v != null ? String(v) : null;
}

/**
 * TradingView `indexes.tr` is an array of `{ name, proname }`.
 * Never use String(array) — it becomes "[object Object],...".
 */
function parseIndexesTr(v: unknown): Array<{ name: string; proname?: string }> | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  const out: Array<{ name: string; proname?: string }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    const proname = typeof o.proname === "string" ? o.proname.trim() : undefined;
    out.push(proname ? { name, proname } : { name });
  }
  return out.length > 0 ? out : null;
}

function parseRow(
  r: { s?: string; d?: unknown[] },
  rank: number,
): TradingViewCrawledStock | null {
  const symbolRaw = typeof r?.s === "string" ? r.s : null;
  if (!symbolRaw) return null;
  const [exchange, symbolFromS] = symbolRaw.split(":");

  const d = Array.isArray(r?.d) ? r.d : [];
  const tickerView = d[0];
  const close = d[1];
  const currency = d[2];
  const changeRaw = d[3];
  const volume = d[4];
  const relVol = d[5];
  const marketCap = d[6];
  const pe = d[7];
  const epsDilTtm = d[8];
  const epsDilGrowthRaw = d[9];
  const divYield = d[10];
  const sector = d[11];
  const country = d[12];
  const countryCode = d[13];
  const figi = d[14];
  const floatShares = d[15];
  const industry = d[16];
  const ipoOfferDate = d[17];
  const ipoOfferPriceUsd = d[18];
  const beta1Y = d[19];
  const epsEstimate = d[20];
  const revenueEstimate = d[21];
  const revenueFy = d[22];
  const netIncomeFy = d[23];
  const high52W = d[24];
  const low52W = d[25];
  const open = d[26];
  const open1W = d[27];
  const open1M = d[28];
  const change1W = d[29];
  const change1M = d[30];
  const volatilityD = d[31];
  const volatilityW = d[32];
  const volatilityM = d[33];
  const perfYTD = d[34];
  const volume1M = d[35];
  const changeAbs = d[36];
  const earningsGrowth = d[37];
  const index = d[38];
  const grossProfitYoyGrowthTtm = d[39];
  const numberOfEmployeesFy = d[40];
  const averageVolume10dCalc = d[41];
  const netMarginFy = d[42];
  const highAll = d[43];
  const lowAll = d[44];

  const tv = parseTickerView(tickerView);
  const changeParsed = parseTrendFromPercent(String(changeRaw ?? ""));
  const epsGrowthParsed = parseTrendFromPercent(String(epsDilGrowthRaw ?? ""));

  return {
    type: "stock",
    exchange: exchange ?? null,
    symbol: tv.symbol ?? symbolFromS ?? null,
    name: tv.name ?? null,
    logo_url: tv.logo_url ?? null,
    ticker_full: symbolRaw,

    price: stripUSD(close as string | number | null) ?? toNum(close),
    currency: typeof currency === "string" ? currency : null,

    change_percent_d: changeParsed,
    volume_d: toNum(volume),
    rel_volume_10d: toNum(relVol),
    market_cap: stripUSD(marketCap as string | number | null) ?? toNum(marketCap),

    pe: toNum(pe),
    eps_dil_ttm: stripUSD(epsDilTtm as string | number | null) ?? toNum(epsDilTtm),
    eps_dil_growth_yoy: epsGrowthParsed,

    div_yield_ttm: toNum(divYield),
    sector: typeof sector === "string" ? sector : null,
    industry: typeof industry === "string" ? industry : null,

    country: typeof country === "string" ? country : null,
    country_code: typeof countryCode === "string" ? countryCode : null,

    figi: typeof figi === "string" ? figi : null,
    float_shares: toNum(floatShares),

    ipo_offer_date: normalizeIpoDate(ipoOfferDate),
    ipo_offer_price_usd: stripUSD(ipoOfferPriceUsd as string | number | null) ?? toNum(ipoOfferPriceUsd),

    beta_1y: toNum(beta1Y),
    eps_estimate: stripUSD(epsEstimate as string | number | null) ?? toNum(epsEstimate),
    revenue_estimate: stripUSD(revenueEstimate as string | number | null) ?? toNum(revenueEstimate),
    revenue_fy: stripUSD(revenueFy as string | number | null) ?? toNum(revenueFy),
    net_income_fy: stripUSD(netIncomeFy as string | number | null) ?? toNum(netIncomeFy),

    week_52_high: toNum(high52W),
    week_52_low: toNum(low52W),
    open: toNum(open),
    open_1w: toNum(open1W),
    open_1m: toNum(open1M),
    change_1w: toNum(change1W),
    change_1m: toNum(change1M),
    volatility_d: toNum(volatilityD),
    volatility_w: toNum(volatilityW),
    volatility_m: toNum(volatilityM),
    perf_ytd: toNum(perfYTD),
    volume_1m: toNum(volume1M),
    change_abs: toNum(changeAbs),
    earnings_growth_pegy: toNum(earningsGrowth),

    indexes: parseIndexesTr(index),
    gross_profit_yoy_growth_ttm: toNum(grossProfitYoyGrowthTtm),
    number_of_employees_fy: toNum(numberOfEmployeesFy),
    average_volume_10d_calc: toNum(averageVolume10dCalc),
    net_margin_fy: toNum(netMarginFy),
    high_all: toNum(highAll),
    low_all: toNum(lowAll),

    importance_rank: rank,
    source: "tradingview",
    crawled_at: new Date(),
  };
}

export async function crawlStocksFromTradingViewApi(
  options: TradingViewCrawlOptions = {},
): Promise<TradingViewCrawledStock[]> {
  const {
    batchSize = 100,
    maxItems,
    startOffset = 0,
    markets = [...DEFAULT_MARKETS],
    sortBy = "market_cap_basic",
    sortOrder = "desc",
    timeoutMs = 25_000,
    sleepMs = 250,
  } = options;

  const out: TradingViewCrawledStock[] = [];

  for (const market of markets) {
    let offset = startOffset;

    while (true) {
      const from = offset;
      const to = offset + batchSize - 1;
      const payload = buildPayload(from, to, sortBy, sortOrder);
      (payload as { markets: string[] }).markets = [market];

      let data: { data?: Array<{ s?: string; d?: unknown[] }> };
      try {
        data = (await postScan(payload, { market, timeoutMs })) as { data?: Array<{ s?: string; d?: unknown[] }> };
      } catch (error: unknown) {
        console.warn(`TradingView scan failed for market "${market}" (offset ${offset}), skipping market:`, error);
        break;
      }

      const rows = Array.isArray(data?.data) ? data.data : [];
      if (rows.length === 0) break;

      for (let i = 0; i < rows.length; i += 1) {
        const parsed = parseRow(rows[i], out.length + 1);
        if (parsed) out.push(parsed);
        if (maxItems && out.length >= maxItems) {
          return out;
        }
      }

      offset += batchSize;
      if (sleepMs > 0) await sleep(sleepMs);
    }
  }

  return out;
}
