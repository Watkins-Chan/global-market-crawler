/**
 * Chỉ chạy phase 2: đọc collection `stocks` trong MongoDB, fetch trang symbol TradingView,
 * cập nhật description, CEO, founded, ISIN, … (và `detail_enriched_at`).
 *
 * Yêu cầu: document đã có `source_ids.tradingviewSymbolSlug` (từ crawl list trước đó).
 *
 * Env: `STOCK_DETAIL_FORCE=1` để enrich lại cả mã đã có `detail_enriched_at`.
 *      `STOCK_DETAIL_BATCH_SIZE`, `TRADINGVIEW_SYMBOL_PAGE_SLEEP_MS`, … giống crawl đầy đủ.
 */
import "dotenv/config";
import { ensureIndexes, refreshSearchIndex, withMongo } from "../db/mongo.js";
import { enrichStockSymbolPages } from "../crawl/stockDetails.js";
import type { CrawlIssue } from "../crawl/helpers.js";

async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB_NAME ?? "global_market";
  if (!mongoUri?.trim()) {
    console.error("MONGO_URI is required (set in .env).");
    process.exit(1);
  }

  const issues: CrawlIssue[] = [];

  await withMongo(mongoUri, dbName, async (client) => {
    await ensureIndexes(client, dbName);
    await enrichStockSymbolPages(client, dbName, issues);
    await refreshSearchIndex(client, dbName);
  });

  if (issues.length > 0) {
    console.warn(`Hoàn tất với ${issues.length} cảnh báo/lỗi (hiển thị tối đa 30 dòng đầu).`);
    for (const issue of issues.slice(0, 30)) {
      console.warn(`  [${issue.assetId}] ${issue.message}`);
    }
  }

  console.log("Stock detail crawl xong.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
