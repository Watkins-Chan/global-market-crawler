/**
 * Phase 2: enrich `cryptos` from TradingView crypto symbol pages (About + schema.org description).
 * Requires `source_ids.tradingviewSymbolSlug` from TradingView list crawl.
 *
 * Env: `CRYPTO_DETAIL_FORCE=1` to re-enrich documents that already have `detail_enriched_at`.
 */
import "dotenv/config";
import { ensureIndexes, refreshSearchIndex, withMongo } from "../db/mongo.js";
import { enrichCryptoSymbolPages } from "../crawl/cryptoDetails.js";
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
    await enrichCryptoSymbolPages(client, dbName, issues);
    await refreshSearchIndex(client, dbName);
  });

  if (issues.length > 0) {
    console.warn(`Completed with ${issues.length} issue(s) (showing first 30).`);
    for (const issue of issues.slice(0, 30)) {
      console.warn(`  [${issue.assetId}] ${issue.message}`);
    }
  }

  console.log("Crypto detail crawl finished.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
