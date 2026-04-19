import { crawlCryptocurrenciesFromTradingViewApi } from "../providers/tradingviewCrypto.js";
import { tradingViewTickerToSymbolSlug } from "../providers/tradingviewSymbolPage.js";
import type { IngestionPayload } from "../types.js";
import {
  buildCryptoDoc,
  normalizeId,
  toStartOfDay,
  type CrawlIssue,
  type CryptoSeed,
} from "./helpers.js";

interface IngestCryptoOptions {
  /** Max rows; omit or `undefined` = fetch entire TradingView coin list (same as stocks `stockLimit`). */
  limit?: number | undefined;
}

export async function ingestCrypto(
  payload: IngestionPayload,
  issues: CrawlIssue[],
  options: IngestCryptoOptions,
): Promise<void> {
  const batchSize = Math.max(1, Number(process.env.TRADINGVIEW_CRYPTO_BATCH_SIZE ?? "100"));
  const timeoutMs = Number(process.env.TRADINGVIEW_CRYPTO_TIMEOUT_MS ?? "25000");
  const sleepMs = Number(process.env.TRADINGVIEW_CRYPTO_SLEEP_MS ?? "250");
  const startOffset = Number(process.env.TRADINGVIEW_CRYPTO_START_OFFSET ?? "0");
  const sortBy = process.env.TRADINGVIEW_CRYPTO_SORT_BY ?? "crypto_total_rank";
  const sortOrderEnv = process.env.TRADINGVIEW_CRYPTO_SORT_ORDER;
  const sortOrder = sortOrderEnv === "asc" || sortOrderEnv === "desc" ? sortOrderEnv : "asc";

  let rows: Awaited<ReturnType<typeof crawlCryptocurrenciesFromTradingViewApi>>;
  try {
    rows = await crawlCryptocurrenciesFromTradingViewApi({
      maxItems: options.limit != null && options.limit > 0 ? options.limit : undefined,
      batchSize,
      startOffset,
      sortBy,
      sortOrder,
      timeoutMs,
      sleepMs,
    });
  } catch (error: unknown) {
    issues.push({ assetId: "crypto_discovery", market: "crypto", message: String(error) });
    return;
  }

  for (const row of rows) {
    if (row.price === null || row.price === undefined) {
      issues.push({ assetId: row.ticker_full, market: "crypto", message: "TradingView coin row missing price" });
      continue;
    }

    const cryptoId = normalizeId("crypto", row.ticker_full);
    const slug = tradingViewTickerToSymbolSlug(row.ticker_full);
    const catJoin = row.crypto_common_categories?.join(", ") ?? undefined;
    const ecoJoin = row.crypto_blockchain_ecosystems?.join(", ") ?? undefined;
    const consJoin = row.crypto_consensus_algorithms?.join(", ") ?? undefined;

    const seed: CryptoSeed = {
      id: row.ticker_full,
      symbol: row.symbol ?? row.ticker_full.split(":").pop() ?? "?",
      name: row.name ?? row.symbol ?? row.ticker_full,
      image: row.logo_url ?? undefined,
      rank: row.crypto_rank ?? undefined,
      category: catJoin,
      ecosystem: ecoJoin,
      consensus: consJoin,
      tradingviewTicker: row.ticker_full,
      tradingviewSymbolSlug: slug,
    };

    try {
      const price = row.price;
      const spark = Number.isFinite(price) ? [price] : [0];

      payload.cryptoSnapshots.push({
        crypto_id: cryptoId,
        price,
        change_24h: row.change_24h_pct ?? 0,
        change_7d: row.perf_w_pct ?? 0,
        change_30d: row.perf_1m_pct ?? 0,
        change_ytd: row.perf_ytd_pct ?? 0,
        market_cap: row.market_cap ?? 0,
        volume_24h: row.volume_24h ?? 0,
        circulating_supply: row.circulating_supply ?? undefined,
        total_supply: row.total_supply ?? null,
        max_supply: row.max_supply ?? null,
        ath: row.week_52_high ?? undefined,
        atl: row.low_all ?? row.week_52_low ?? undefined,
        dominance: undefined,
        rank: row.crypto_rank ?? undefined,
        sparkline_7d: spark,
        tradingview_scan: row.tradingview_scan,
        updated_at: new Date(),
      });

      payload.cryptos.push(buildCryptoDoc(seed));

      const day = toStartOfDay(new Date());
      payload.cryptoHistory.push({
        crypto_id: cryptoId,
        interval: "1d",
        timestamp: day,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: row.volume_24h ?? 0,
      });
    } catch (error: unknown) {
      issues.push({ assetId: cryptoId, market: "crypto", message: String(error) });
    }
  }
}
