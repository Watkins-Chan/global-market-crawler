import type { MongoClient } from "mongodb";
import { omitNullUndefinedForSet } from "../lib/omitNullish.js";
import { fetchTradingViewSymbolPageEnrichment } from "../providers/tradingviewSymbolPage.js";
import type { StockDocument } from "../types.js";
import type { CrawlIssue } from "./helpers.js";

/** Primary: `STOCK_DETAIL_CRAWL`; if unset, falls back to `TRADINGVIEW_SYMBOL_PAGE_ENRICH`. */
export function stockDetailCrawlEnabled(): boolean {
  const raw = process.env.STOCK_DETAIL_CRAWL?.trim();
  if (raw) {
    const l = raw.toLowerCase();
    return !(l === "0" || l === "false" || l === "no" || l === "off");
  }
  const v = process.env.TRADINGVIEW_SYMBOL_PAGE_ENRICH?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

function detailBatchSize(): number {
  return Math.max(1, Number(process.env.STOCK_DETAIL_BATCH_SIZE ?? "1000"));
}

function symbolPageSleepMs(): number {
  return Number(process.env.TRADINGVIEW_SYMBOL_PAGE_SLEEP_MS ?? "250");
}

function symbolPageTimeoutMs(): number {
  return Number(process.env.TRADINGVIEW_SYMBOL_PAGE_TIMEOUT_MS ?? "25000");
}

/** When adding fields here, also add the Mongo key to `STOCK_DETAIL_OWNED_FIELD_KEYS` in `lib/stockDetailOwnedFields.ts`. */
function enrichmentToStockFields(
  en: Awaited<ReturnType<typeof fetchTradingViewSymbolPageEnrichment>>,
): Partial<StockDocument> {
  const out: Partial<StockDocument> = {};
  if (en.profileDescription?.trim()) out.description = en.profileDescription.trim();
  if (en.isin) out.isin = en.isin;
  if (en.listingTimezone) out.listing_timezone = en.listingTimezone;
  if (en.exchangeSourceName) out.exchange_source_name = en.exchangeSourceName;
  if (en.exchangeSourceUrl) out.exchange_source_url = en.exchangeSourceUrl;
  if (en.typespecs?.length) out.security_typespecs = en.typespecs;
  if (en.providerId) out.tradingview_provider_id = en.providerId;
  if (en.countryCodeFund) out.country_code_fund = en.countryCodeFund;
  if (en.ceo) out.ceo = en.ceo;
  if (en.companyWebsite) out.company_website = en.companyWebsite;
  if (en.headquarters) out.headquarters = en.headquarters;
  if (en.founded) out.founded = en.founded;
  return out;
}

/**
 * Second phase: fetch TradingView symbol HTML per `tradingviewSymbolSlug` and patch `stocks`.
 * Skips documents that already have `detail_enriched_at` unless `STOCK_DETAIL_FORCE=1`.
 * Flushes Mongo `bulkWrite` every `STOCK_DETAIL_BATCH_SIZE` (default 1000).
 */
export async function enrichStockSymbolPages(
  client: MongoClient,
  dbName: string,
  issues: CrawlIssue[],
): Promise<void> {
  const force = process.env.STOCK_DETAIL_FORCE?.trim() === "1";
  const batchSize = detailBatchSize();
  const sleepMs = symbolPageSleepMs();
  const timeoutMs = symbolPageTimeoutMs();

  const col = client.db(dbName).collection<StockDocument>("stocks");

  const filter = force
    ? { "source_ids.tradingviewSymbolSlug": { $exists: true, $nin: [null, ""] } }
    : {
        detail_enriched_at: { $exists: false },
        "source_ids.tradingviewSymbolSlug": { $exists: true, $nin: [null, ""] },
      };

  const totalPending = await col.countDocuments(filter);
  console.log(
    `[stock detail] starting symbol-page enrichment (${force ? "force all with slug" : "missing detail_enriched_at"}) — ~${totalPending} document(s)`,
  );

  const cursor = col.find(filter, { projection: { stock_id: 1, source_ids: 1 } });

  const ops: Array<{
    updateOne: {
      filter: { stock_id: string };
      update: { $set: Record<string, unknown> };
    };
  }> = [];

  let processed = 0;

  for await (const doc of cursor) {
    const slug = doc.source_ids?.tradingviewSymbolSlug?.trim();
    if (!slug) continue;

    try {
      const en = await fetchTradingViewSymbolPageEnrichment(slug, { timeoutMs, sleepMs });
      const now = new Date();
      const fields = enrichmentToStockFields(en);
      const $set = omitNullUndefinedForSet({
        ...(fields as Record<string, unknown>),
        updated_at: now,
        detail_enriched_at: now,
      });

      ops.push({
        updateOne: {
          filter: { stock_id: doc.stock_id },
          update: { $set: $set },
        },
      });
      processed += 1;

      if (ops.length >= batchSize) {
        await col.bulkWrite(ops, { ordered: false });
        console.log(`[stock detail] flushed ${ops.length} update(s) | processed so far: ${processed}`);
        ops.length = 0;
      }
    } catch (error: unknown) {
      issues.push({
        assetId: doc.stock_id,
        market: "stock",
        message: `symbol page (${slug}): ${String(error)}`,
      });
    }
  }

  if (ops.length > 0) {
    await col.bulkWrite(ops, { ordered: false });
    console.log(`[stock detail] flushed final ${ops.length} update(s)`);
  }

  console.log(`[stock detail] done. Processed: ${processed}`);
}
