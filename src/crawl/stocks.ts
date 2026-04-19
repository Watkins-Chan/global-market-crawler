import type { MongoClient } from "mongodb";
import { persistStockBatch } from "../db/mongo.js";
import {
  convertStockAmountToUsd,
  fetchUsdQuoteRates,
  resolveStockFx,
} from "../providers/exchangeRate.js";
import { TRADINGVIEW_EQUITY_SCANNER_MARKETS } from "../providers/tradingviewEquityMarkets.js";
import {
  crawlStocksFromTradingViewApi,
  type TradingViewCrawlOptions,
} from "../providers/tradingview.js";
import { tradingViewTickerToSymbolSlug } from "../providers/tradingviewSymbolPage.js";
import type { IngestionPayload, StockPriceHistoryDocument } from "../types.js";
import {
  buildStockDoc,
  normalizeId,
  toStartOfDay,
  type CrawlIssue,
} from "./helpers.js";

export interface StockListPersistContext {
  client: MongoClient;
  dbName: string;
  /** Flush to Mongo every N rows (scanner list only, no symbol pages). Default: `STOCK_PERSIST_BATCH_SIZE` */
  flushEvery?: number;
}

interface IngestStocksOptions {
  /** Max scanner rows; `undefined` = fetch until TradingView returns no more rows */
  limit?: number;
  /** When set, list rows are written in batches instead of holding everything until final persist */
  stockListPersist?: StockListPersistContext;
}

/**
 * Default `america` only (~8k+ listings). Use `TRADINGVIEW_MARKETS=all` (or global/world/*)
 * to scan every regional equity market TradingView exposes (~tens of thousands total).
 */
function parseTradingViewMarkets(): string[] {
  const raw = process.env.TRADINGVIEW_MARKETS?.trim();
  if (!raw) return ["america"];
  const lower = raw.toLowerCase();
  if (lower === "all" || lower === "global" || lower === "world" || raw === "*") {
    return [...TRADINGVIEW_EQUITY_SCANNER_MARKETS];
  }
  return raw.split(",").map((m) => m.trim()).filter(Boolean);
}

export function stockPersistFlushSize(): number {
  return Math.max(1, Number(process.env.STOCK_PERSIST_BATCH_SIZE ?? "1000"));
}

function tradingViewCrawlOptions(limit: number | undefined): TradingViewCrawlOptions {
  const sortOrderEnv = process.env.TRADINGVIEW_SORT_ORDER;
  const sortOrder = sortOrderEnv === "asc" || sortOrderEnv === "desc" ? sortOrderEnv : "desc";

  return {
    maxItems: limit,
    batchSize: Number(process.env.TRADINGVIEW_BATCH_SIZE ?? "100"),
    startOffset: Number(process.env.TRADINGVIEW_START_OFFSET ?? "0"),
    markets: parseTradingViewMarkets(),
    sortBy: process.env.TRADINGVIEW_SORT_BY ?? "market_cap_basic",
    sortOrder,
    timeoutMs: Number(process.env.TRADINGVIEW_TIMEOUT_MS ?? "25000"),
    sleepMs: Number(process.env.TRADINGVIEW_SLEEP_MS ?? "250"),
  };
}

function optUsd(
  n: number | null | undefined,
  tvCurrency: string | null | undefined,
  rates: Record<string, number>,
): number | undefined {
  const v = convertStockAmountToUsd(n, tvCurrency, rates);
  return v === null ? undefined : v;
}

async function flushStockListBatch(
  payload: IngestionPayload,
  ctx: StockListPersistContext,
  take: number,
): Promise<void> {
  const stocksBatch = payload.stocks.splice(0, take);
  const snapBatch = payload.stockSnapshots.splice(0, take);
  const histBatch = payload.stockHistory.splice(0, take);
  await persistStockBatch(ctx.client, ctx.dbName, stocksBatch, snapBatch, histBatch);
}

export async function ingestStocks(
  payload: IngestionPayload,
  issues: CrawlIssue[],
  options: IngestStocksOptions,
): Promise<number> {
  const persist = options.stockListPersist;
  const flushEvery = persist?.flushEvery ?? stockPersistFlushSize();
  let rowCount = 0;

  console.log(
    `[stocks] list crawl (scanner only; symbol-page details run in a later phase if enabled). Flush every ${flushEvery} row(s)${persist ? " → Mongo" : " (dry-run / deferred persist)"}.`,
  );

  let rates: Record<string, number>;
  try {
    rates = await fetchUsdQuoteRates();
  } catch (error: unknown) {
    issues.push({ assetId: "stocks_discovery", market: "stock", message: `FX rates: ${String(error)}` });
    return 0;
  }

  let rows: Awaited<ReturnType<typeof crawlStocksFromTradingViewApi>>;
  try {
    rows = await crawlStocksFromTradingViewApi(tradingViewCrawlOptions(options.limit));
  } catch (error: unknown) {
    issues.push({ assetId: "stocks_discovery", market: "stock", message: String(error) });
    return 0;
  }

  for (const row of rows) {
    const stockId = normalizeId("stock", row.ticker_full);
    try {
      if (row.price === null || row.price === undefined) {
        issues.push({ assetId: stockId, market: "stock", message: "TradingView row missing price" });
        continue;
      }

      const tvCur = row.currency;
      const { rateKey } = resolveStockFx(tvCur);
      if (rateKey !== "USD" && (rates[rateKey] === undefined || !Number.isFinite(rates[rateKey]) || rates[rateKey] <= 0)) {
        issues.push({
          assetId: stockId,
          market: "stock",
          message: `No FX rate for ${rateKey} (ticker ${row.ticker_full}); skipping USD normalization`,
        });
        continue;
      }

      const priceUsd = convertStockAmountToUsd(row.price, tvCur, rates);
      if (priceUsd === null) {
        issues.push({ assetId: stockId, market: "stock", message: "FX conversion failed for price" });
        continue;
      }

      const symbol = row.symbol ?? row.ticker_full.split(":").pop() ?? row.ticker_full;
      const name = row.name ?? symbol;
      const tvSlug = tradingViewTickerToSymbolSlug(row.ticker_full);

      const openUsd = optUsd(row.open, tvCur, rates) ?? priceUsd;
      const closeUsd = priceUsd;
      const dayHigh = Math.max(openUsd, closeUsd);
      const dayLow = Math.min(openUsd, closeUsd);

      payload.stockSnapshots.push({
        stock_id: stockId,
        quote_currency: "USD",
        price: priceUsd,
        change_1d: row.change_percent_d.value ?? 0,
        change_1w: row.change_1w ?? 0,
        change_1m: row.change_1m ?? 0,
        change_ytd: row.perf_ytd ?? 0,
        market_cap: optUsd(row.market_cap, tvCur, rates),
        volume: row.volume_d ?? 0,
        open: openUsd,
        high: dayHigh,
        low: dayLow,
        close: closeUsd,
        avg_volume: row.average_volume_10d_calc ?? undefined,
        week_52_high: optUsd(row.week_52_high, tvCur, rates),
        week_52_low: optUsd(row.week_52_low, tvCur, rates),
        high_all: optUsd(row.high_all, tvCur, rates),
        low_all: optUsd(row.low_all, tvCur, rates),
        rel_volume_10d: row.rel_volume_10d ?? undefined,
        volume_1m: row.volume_1m ?? undefined,
        volatility_d: row.volatility_d ?? undefined,
        volatility_w: row.volatility_w ?? undefined,
        volatility_m: row.volatility_m ?? undefined,
        open_1w: optUsd(row.open_1w, tvCur, rates),
        open_1m: optUsd(row.open_1m, tvCur, rates),
        change_abs: optUsd(row.change_abs, tvCur, rates),
        eps_growth_yoy: row.eps_dil_growth_yoy.value,
        earnings_growth_pegy: row.earnings_growth_pegy,
        pe_ratio: row.pe,
        eps: optUsd(row.eps_dil_ttm, tvCur, rates) ?? null,
        dividend_yield: row.div_yield_ttm,
        beta: row.beta_1y,
        sparkline_7d: [priceUsd],
        updated_at: new Date(),
      });

      const history: StockPriceHistoryDocument[] = [{
        stock_id: stockId,
        interval: "1d",
        timestamp: toStartOfDay(new Date()),
        open: openUsd,
        high: dayHigh,
        low: dayLow,
        close: closeUsd,
        volume: row.volume_d ?? 0,
      }];

      payload.stocks.push(buildStockDoc({
        ticker: row.ticker_full,
        symbol,
        name,
        logo: row.logo_url ?? undefined,
        exchange: row.exchange ?? undefined,
        sector: row.sector ?? undefined,
        industry: row.industry ?? undefined,
        country: row.country ?? undefined,
        countryCode: row.country_code ?? undefined,
        tradingviewSymbolSlug: tvSlug,
        currency: "USD",
        nativeCurrency: tvCur ?? undefined,
        marketCap: optUsd(row.market_cap, tvCur, rates),
        avgVolume10d: row.average_volume_10d_calc ?? undefined,
        figi: row.figi ?? undefined,
        floatShares: row.float_shares ?? undefined,
        ipoOfferDate: row.ipo_offer_date ?? undefined,
        ipoOfferPriceUsd: row.ipo_offer_price_usd ?? undefined,
        revenueFy: optUsd(row.revenue_fy, tvCur, rates),
        netIncomeFy: optUsd(row.net_income_fy, tvCur, rates),
        numberOfEmployeesFy: row.number_of_employees_fy ?? undefined,
        grossProfitYoyGrowthTtm: row.gross_profit_yoy_growth_ttm ?? undefined,
        netMarginFy: row.net_margin_fy ?? undefined,
        indexes: row.indexes ?? undefined,
        importanceRank: row.importance_rank,
      }));
      payload.stockHistory.push(...history);
      rowCount += 1;

      if (persist && payload.stocks.length >= flushEvery) {
        await flushStockListBatch(payload, persist, flushEvery);
      }
    } catch (error: unknown) {
      issues.push({ assetId: stockId, market: "stock", message: String(error) });
    }
  }

  if (persist && payload.stocks.length > 0) {
    await flushStockListBatch(payload, persist, payload.stocks.length);
  }

  return rowCount;
}
