import {
  buildSparkline,
  computeChangePercent,
  sortByTimestamp,
  toStartOfDay,
} from "../lib/format.js";
import type {
  ChartPoint,
  CommodityDocument,
  CryptoDocument,
  IngestionPayload,
  SourceIds,
  StockDocument,
  VietnamGoldBrandDocument,
} from "../types.js";

export { buildSparkline, computeChangePercent, sortByTimestamp, toStartOfDay };

export interface CrawlIssue {
  assetId: string;
  market: "stock" | "crypto" | "commodity" | "vietnam_gold";
  message: string;
}

export interface StockSeed {
  ticker?: string;
  symbol: string;
  name: string;
  logo?: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  country?: string;
  countryCode?: string;
  countryCodeFund?: string;
  description?: string;
  isin?: string;
  listingTimezone?: string;
  exchangeSourceName?: string;
  exchangeSourceUrl?: string;
  securityTypespecs?: string[];
  tradingviewProviderId?: string;
  tradingviewSymbolSlug?: string;
  ceo?: string;
  companyWebsite?: string;
  headquarters?: string;
  founded?: string;
  currency?: string;
  nativeCurrency?: string;
  marketCap?: number;
  avgVolume10d?: number;
  avgVolume30d?: number;
  figi?: string;
  floatShares?: number;
  ipoOfferDate?: string;
  ipoOfferPriceUsd?: number;
  revenueFy?: number;
  netIncomeFy?: number;
  numberOfEmployeesFy?: number;
  grossProfitYoyGrowthTtm?: number;
  netMarginFy?: number;
  indexes?: Array<{ name: string; proname?: string }>;
  importanceRank?: number;
}

export interface CryptoSeed {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  rank?: number;
  category?: string;
  ecosystem?: string;
  consensus?: string;
  tradingviewTicker?: string;
  tradingviewSymbolSlug?: string;
}

export interface CommoditySeed {
  symbol: string;
  name: string;
}

export interface VietnamGoldSeed {
  code: string;
  name: string;
}

export function emptyPayload(): IngestionPayload {
  return {
    stocks: [],
    stockSnapshots: [],
    stockHistory: [],
    cryptos: [],
    cryptoSnapshots: [],
    cryptoHistory: [],
    commodities: [],
    commoditySnapshots: [],
    commodityHistory: [],
    vietnamGoldBrands: [],
    vietnamGoldSnapshots: [],
    vietnamGoldHistory: [],
    rawVietnamGold: [],
  };
}

export function getPriceAtOrBeforeDays(
  points: Array<{ timestamp: Date; price: number }>,
  days: number,
): number {
  const sorted = sortByTimestamp(points.map((p) => ({ ...p, volume: 0 })));
  if (sorted.length === 0) return 0;
  const latestTs = sorted[sorted.length - 1].timestamp.getTime();
  const target = latestTs - days * 24 * 60 * 60 * 1000;
  const candidate = [...sorted].reverse().find((p) => p.timestamp.getTime() <= target);
  return (candidate ?? sorted[0]).price;
}

export function getChangeSet(points: Array<{ timestamp: Date; price: number }>): {
  d1: number;
  w1: number;
  m1: number;
  ytd: number;
} {
  if (points.length === 0) return { d1: 0, w1: 0, m1: 0, ytd: 0 };
  const sorted = sortByTimestamp(points.map((p) => ({ ...p, volume: 0 })));
  const latest = sorted[sorted.length - 1].price;
  return {
    d1: computeChangePercent(latest, getPriceAtOrBeforeDays(points, 1)),
    w1: computeChangePercent(latest, getPriceAtOrBeforeDays(points, 7)),
    m1: computeChangePercent(latest, getPriceAtOrBeforeDays(points, 30)),
    ytd: computeChangePercent(latest, getPriceAtOrBeforeDays(points, 365)),
  };
}

export function buildOhlcFromPoints<T extends {
  interval: "1d";
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>(
  rows: Array<{ timestamp: Date; price: number; volume: number }>,
  build: (row: { timestamp: Date; open: number; high: number; low: number; close: number; volume: number }) => T,
): T[] {
  const sorted = sortByTimestamp(rows.map((point) => ({
    timestamp: toStartOfDay(point.timestamp),
    price: point.price,
    volume: point.volume,
  })));
  return sorted.map((point, idx, arr) => {
    const prev = arr[Math.max(0, idx - 1)];
    const open = prev ? prev.price : point.price;
    const close = point.price;
    const high = Math.max(open, close);
    const low = Math.min(open, close);
    return build({
      timestamp: point.timestamp,
      open,
      high,
      low,
      close,
      volume: point.volume,
    });
  });
}

export function avgVolume(points: Array<{ volume: number }>): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.volume, 0) / points.length;
}

export function normalizeId(prefix: string, raw: string): string {
  return `${prefix}_${raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

export function buildSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildStockDoc(seed: StockSeed): StockDocument {
  const now = new Date();
  return {
    stock_id: normalizeId("stock", seed.ticker ?? seed.symbol),
    symbol: seed.symbol,
    name: seed.name,
    slug: buildSlug(seed.ticker ?? seed.symbol),
    logo: seed.logo,
    exchange: seed.exchange,
    sector: seed.sector,
    industry: seed.industry,
    country: seed.country,
    country_code: seed.countryCode,
    country_code_fund: seed.countryCodeFund,
    description: seed.description,
    isin: seed.isin,
    listing_timezone: seed.listingTimezone,
    exchange_source_name: seed.exchangeSourceName,
    exchange_source_url: seed.exchangeSourceUrl,
    security_typespecs: seed.securityTypespecs,
    tradingview_provider_id: seed.tradingviewProviderId,
    ceo: seed.ceo,
    company_website: seed.companyWebsite,
    headquarters: seed.headquarters,
    founded: seed.founded,
    currency: seed.currency,
    native_currency: seed.nativeCurrency,
    market_cap: seed.marketCap,
    avg_volume_10d: seed.avgVolume10d,
    avg_volume_30d: seed.avgVolume30d,
    figi: seed.figi,
    float_shares: seed.floatShares,
    ipo_offer_date: seed.ipoOfferDate,
    ipo_offer_price_usd: seed.ipoOfferPriceUsd,
    revenue_fy: seed.revenueFy,
    net_income_fy: seed.netIncomeFy,
    number_of_employees_fy: seed.numberOfEmployeesFy,
    gross_profit_yoy_growth_ttm: seed.grossProfitYoyGrowthTtm,
    net_margin_fy: seed.netMarginFy,
    indexes: seed.indexes,
    importance_rank: seed.importanceRank,
    source_ids: {
      tradingviewTicker: seed.ticker,
      tradingviewSymbolSlug: seed.tradingviewSymbolSlug,
    },
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

export function buildCryptoDoc(seed: CryptoSeed): CryptoDocument {
  const now = new Date();
  const source_ids: SourceIds = {};
  if (seed.tradingviewTicker) source_ids.tradingviewTicker = seed.tradingviewTicker;
  if (seed.tradingviewSymbolSlug) source_ids.tradingviewSymbolSlug = seed.tradingviewSymbolSlug;

  return {
    crypto_id: normalizeId("crypto", seed.id),
    symbol: seed.symbol.toUpperCase(),
    name: seed.name,
    slug: buildSlug(seed.id),
    logo: seed.image,
    rank: seed.rank,
    category: seed.category,
    ecosystem: seed.ecosystem,
    consensus: seed.consensus,
    source_ids,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

export function buildCommodityDoc(seed: CommoditySeed): CommodityDocument {
  const now = new Date();
  return {
    commodity_id: normalizeId("commodity", seed.symbol),
    symbol: seed.symbol,
    name: seed.name,
    slug: buildSlug(seed.symbol),
    category: "Commodity",
    benchmark: "Yahoo market summary discovery",
    source_ids: { yahooSymbol: seed.symbol },
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

export function buildVietnamGoldBrandDoc(seed: VietnamGoldSeed): VietnamGoldBrandDocument {
  const now = new Date();
  return {
    brand_id: normalizeId("vn_gold", seed.code),
    brand_code: seed.code,
    name: seed.name,
    slug: buildSlug(seed.code),
    unit: "VND/luong",
    source_ids: { vietnamGoldCode: seed.code },
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

export function countProcessedInstruments(
  payload: IngestionPayload,
  options?: { stockRowCount?: number },
): number {
  const stockN = options?.stockRowCount ?? payload.stocks.length;
  return (
    stockN +
    payload.cryptos.length +
    payload.commodities.length +
    payload.vietnamGoldBrands.length
  );
}

export function buildRunSummary(payload: IngestionPayload, issues: CrawlIssue[]): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    totalIssues: issues.length,
    issues,
    counts: {
      stocks: payload.stocks.length,
      stock_snapshots: payload.stockSnapshots.length,
      stock_price_history: payload.stockHistory.length,
      cryptos: payload.cryptos.length,
      crypto_snapshots: payload.cryptoSnapshots.length,
      crypto_price_history: payload.cryptoHistory.length,
      commodities: payload.commodities.length,
      commodity_snapshots: payload.commoditySnapshots.length,
      commodity_price_history: payload.commodityHistory.length,
      vietnam_gold_brands: payload.vietnamGoldBrands.length,
      vietnam_gold_snapshots: payload.vietnamGoldSnapshots.length,
      vietnam_gold_price_history: payload.vietnamGoldHistory.length,
      raw_vietnam_gold_prices: payload.rawVietnamGold.length,
    },
    sample: {
      stock: payload.stocks[0] ?? null,
      stock_snapshot: payload.stockSnapshots[0] ?? null,
      crypto_snapshot: payload.cryptoSnapshots[0] ?? null,
      commodity_snapshot: payload.commoditySnapshots[0] ?? null,
      vietnam_gold_snapshot: payload.vietnamGoldSnapshots[0] ?? null,
    },
  };
}

export function toChartPoints(rows: Array<{ timestamp: Date; price: number }>): ChartPoint[] {
  return rows.map((row) => ({ timestamp: row.timestamp, price: row.price, volume: 0 }));
}
