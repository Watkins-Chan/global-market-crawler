export type MarketType = "stock" | "crypto" | "commodity" | "vietnam_gold";

export type AssetSourceType = "yahoo" | "crawler";

export type PriceInterval = "1h" | "1d" | "1w" | "1m";

export interface SourceIds {
  /** Legacy: old ingestions may still have this field */
  alphaVantageSymbol?: string;
  yahooSymbol?: string;
  /** Legacy: documents ingested via CoinGecko may still have this field */
  coingeckoId?: string;
  vietnamGoldCode?: string;
  tradingviewTicker?: string;
  /** Path segment for `tradingview.com/symbols/{slug}/` e.g. `NASDAQ-NVDA` */
  tradingviewSymbolSlug?: string;
}

export interface StockDocument {
  stock_id: string;
  symbol: string;
  name: string;
  slug: string;
  logo?: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  country?: string;
  country_code?: string;
  /** ISO country for fund listings when present on symbol page */
  country_code_fund?: string;
  description?: string;
  /** ISIN from TradingView symbol page (`isin_displayed`) */
  isin?: string;
  /** Exchange listing timezone (IANA), e.g. America/New_York */
  listing_timezone?: string;
  /** Exchange metadata from symbol page `source2` */
  exchange_source_name?: string;
  exchange_source_url?: string;
  /** symbolInfo.typespecs e.g. common */
  security_typespecs?: string[];
  /** Data vendor id on symbol page e.g. ice */
  tradingview_provider_id?: string;
  /** From TradingView symbol page fundamentals JSON */
  ceo?: string;
  company_website?: string;
  headquarters?: string;
  /** Year or label as returned by TradingView e.g. "1993" */
  founded?: string;
  /** Quote / stored monetary values in USD when `native_currency` is set */
  currency?: string;
  /** TradingView quote currency before FX normalization */
  native_currency?: string;
  market_cap?: number;
  /** TradingView `average_volume_10d_calc` when using scanner crawl */
  avg_volume_10d?: number;
  avg_volume_30d?: number;
  figi?: string;
  float_shares?: number;
  ipo_offer_date?: string;
  ipo_offer_price_usd?: number;
  revenue_fy?: number;
  net_income_fy?: number;
  number_of_employees_fy?: number;
  gross_profit_yoy_growth_ttm?: number;
  net_margin_fy?: number;
  /** TradingView `indexes.tr` — memberships (e.g. S&P 500, NASDAQ 100) */
  indexes?: Array<{ name: string; proname?: string }>;
  importance_rank?: number;
  /** Set when symbol-page detail crawl has successfully updated this document */
  detail_enriched_at?: Date;
  source_ids: SourceIds;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StockSnapshotDocument {
  stock_id: string;
  /** Usually `USD` when FX normalization is applied */
  quote_currency?: string;
  price: number;
  change_1d: number;
  change_1w: number;
  change_1m: number;
  change_ytd: number;
  market_cap?: number;
  volume: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  avg_volume?: number;
  week_52_high?: number;
  week_52_low?: number;
  high_all?: number;
  low_all?: number;
  rel_volume_10d?: number;
  volume_1m?: number;
  volatility_d?: number;
  volatility_w?: number;
  volatility_m?: number;
  open_1w?: number;
  open_1m?: number;
  change_abs?: number;
  eps_growth_yoy?: number | null;
  earnings_growth_pegy?: number | null;
  pe_ratio?: number | null;
  eps?: number | null;
  dividend_yield?: number | null;
  beta?: number | null;
  sparkline_7d: number[];
  updated_at: Date;
}

export interface StockPriceHistoryDocument {
  stock_id: string;
  interval: PriceInterval;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CryptoDocument {
  crypto_id: string;
  symbol: string;
  name: string;
  slug: string;
  logo?: string;
  rank?: number;
  category?: string;
  ecosystem?: string;
  consensus?: string;
  description?: string;
  /** "Category" label from symbol-page About section (detail crawl) */
  profile_category?: string;
  website_url?: string;
  source_code_url?: string;
  whitepaper_url?: string;
  explorer_urls?: string[];
  community_url?: string;
  /** Set when TradingView crypto symbol-page crawl has updated this document */
  detail_enriched_at?: Date;
  source_ids: SourceIds;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CryptoSnapshotDocument {
  crypto_id: string;
  price: number;
  change_24h: number;
  change_7d: number;
  change_30d: number;
  change_ytd: number;
  market_cap: number;
  volume_24h: number;
  circulating_supply?: number;
  total_supply?: number | null;
  max_supply?: number | null;
  ath?: number;
  atl?: number;
  dominance?: number;
  rank?: number;
  sparkline_7d: number[];
  /** Full TradingView coin scanner row (normalized); see `cryptoScanSchema.ts`. Percents are `number`, not `{ raw, value, trend }`. */
  tradingview_scan?: Record<string, unknown>;
  updated_at: Date;
}

export interface CryptoPriceHistoryDocument {
  crypto_id: string;
  interval: PriceInterval;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CommodityDocument {
  commodity_id: string;
  symbol: string;
  name: string;
  slug: string;
  category?: string;
  benchmark?: string;
  unit?: string;
  description?: string;
  source_ids: SourceIds;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CommoditySnapshotDocument {
  commodity_id: string;
  price: number;
  change_1d: number;
  change_1w: number;
  change_1m: number;
  change_ytd: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  avg_volume?: number;
  open_interest?: number;
  sparkline_7d: number[];
  updated_at: Date;
}

export interface CommodityPriceHistoryDocument {
  commodity_id: string;
  interval: PriceInterval;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VietnamGoldBrandDocument {
  brand_id: string;
  brand_code: string;
  name: string;
  slug: string;
  logo?: string;
  unit: "VND/luong" | "VND/kg";
  metal_type: "gold" | "silver";
  source: string;
  description?: string;
  source_ids: SourceIds;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface VietnamGoldSnapshotDocument {
  brand_id: string;
  metal_type: "gold" | "silver";
  source: string;
  /** Display-friendly timestamp from source, e.g. `09:00 20/04`. */
  detail_last_update_text?: string | null;
  buy_price: number;
  sell_price: number;
  /** Display value in K VND, e.g. 168300. */
  detail_price_buy_k?: number | null;
  /** Display value in K VND, e.g. 171300. */
  detail_price_sell_k?: number | null;
  /** Absolute VND change vs previous update from source (detail page "↓ -700.000"). */
  today_change_buy?: number | null;
  today_change_sell?: number | null;
  spread: number;
  change_1d: number;
  change_1w: number;
  change_1m: number;
  change_ytd: number;
  /** 30-day statistics mirrored from detail view (computed from source history). */
  stat_30d_points?: number | null;
  stat_30d_sell_high?: number | null;
  stat_30d_sell_low?: number | null;
  stat_30d_sell_avg?: number | null;
  global_gold_price_usd_oz?: number | null;
  converted_vnd_per_luong?: number | null;
  premium_vs_global?: number | null;
  sparkline_7d: number[];
  updated_at: Date;
}

export interface VietnamGoldPriceHistoryDocument {
  brand_id: string;
  metal_type: "gold" | "silver";
  source: string;
  interval: PriceInterval;
  timestamp: Date;
  buy_price: number;
  sell_price: number;
  spread: number;
  premium_vs_global?: number | null;
}

export interface IngestionJobDocument {
  job_id: string;
  job_name: string;
  market: MarketType | "all";
  source: string;
  started_at: Date;
  finished_at?: Date;
  status: "running" | "success" | "partial_success" | "failed";
  items_processed: number;
  error_message?: string;
}

export interface RawVietnamGoldDocument {
  source: string;
  brand_code: string;
  payload: unknown;
  fetched_at: Date;
}

export interface ChartPoint {
  timestamp: Date;
  price: number;
  volume: number;
}

export interface IngestionPayload {
  stocks: StockDocument[];
  stockSnapshots: StockSnapshotDocument[];
  stockHistory: StockPriceHistoryDocument[];
  cryptos: CryptoDocument[];
  cryptoSnapshots: CryptoSnapshotDocument[];
  cryptoHistory: CryptoPriceHistoryDocument[];
  commodities: CommodityDocument[];
  commoditySnapshots: CommoditySnapshotDocument[];
  commodityHistory: CommodityPriceHistoryDocument[];
  vietnamGoldBrands: VietnamGoldBrandDocument[];
  vietnamGoldSnapshots: VietnamGoldSnapshotDocument[];
  vietnamGoldHistory: VietnamGoldPriceHistoryDocument[];
  rawVietnamGold: RawVietnamGoldDocument[];
}
