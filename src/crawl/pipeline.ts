import type { IngestionPayload, MarketType } from "../types.js";
import type { CrawlIssue } from "./helpers.js";
import { ingestCommodities } from "./commodities.js";
import { ingestCrypto } from "./crypto.js";
import { ingestStocks, stockPersistFlushSize, type StockListPersistContext } from "./stocks.js";
import { ingestVietnamGold } from "./vietnamGold.js";

export interface RunPipelineOptions {
  markets: MarketType[];
  /** `undefined` = no cap (full TradingView scanner run for configured markets) */
  stockLimit: number | undefined;
  /** `undefined` = no cap (full coin list until TradingView returns no more rows) */
  cryptoLimit: number | undefined;
  commodityLimit: number;
  vietnamGoldLimit: number;
  /** When crawling stocks to MongoDB, flush list rows every N items (see `STOCK_PERSIST_BATCH_SIZE`) */
  stockListPersist?: StockListPersistContext;
}

export interface IngestionPipelineCounts {
  /** Scanner rows ingested (may differ from `payload.stocks.length` after DB flush) */
  stockRowCount: number;
}

export async function runIngestionPipeline(
  payload: IngestionPayload,
  issues: CrawlIssue[],
  options: RunPipelineOptions,
): Promise<IngestionPipelineCounts> {
  const selected = new Set(options.markets);
  let stockRowCount = 0;

  if (selected.has("stock")) {
    const listPersist = options.stockListPersist;
    stockRowCount = await ingestStocks(payload, issues, {
      limit: options.stockLimit,
      stockListPersist: listPersist
        ? {
            client: listPersist.client,
            dbName: listPersist.dbName,
            flushEvery: listPersist.flushEvery ?? stockPersistFlushSize(),
          }
        : undefined,
    });
  }

  if (selected.has("crypto")) {
    await ingestCrypto(payload, issues, { limit: options.cryptoLimit });
  }

  if (selected.has("commodity")) {
    await ingestCommodities(payload, issues, { limit: options.commodityLimit });
  }

  if (selected.has("vietnam_gold")) {
    await ingestVietnamGold(payload, issues, { limit: options.vietnamGoldLimit });
  }

  return { stockRowCount };
}
