import type { MongoClient } from "mongodb";
import { omitNullUndefinedForSet } from "../lib/omitNullish.js";
import { fetchTradingViewCryptoSymbolPageEnrichment } from "../providers/tradingviewCryptoSymbolPage.js";
import type { CryptoDocument } from "../types.js";
import type { CrawlIssue } from "./helpers.js";

function decodeTvHtmlEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** When adding fields here, also add keys to `CRYPTO_DETAIL_OWNED_FIELD_KEYS` in `lib/cryptoDetailOwnedFields.ts`. */
function enrichmentToCryptoFields(
  en: Awaited<ReturnType<typeof fetchTradingViewCryptoSymbolPageEnrichment>>,
): Partial<CryptoDocument> {
  const out: Partial<CryptoDocument> = {};
  if (en.profileDescription?.trim()) out.description = decodeTvHtmlEntities(en.profileDescription.trim());
  if (en.profileCategory?.trim()) out.profile_category = en.profileCategory.trim();
  if (en.websiteUrl?.trim()) out.website_url = en.websiteUrl.trim();
  if (en.sourceCodeUrl?.trim()) out.source_code_url = en.sourceCodeUrl.trim();
  if (en.whitepaperUrl?.trim()) out.whitepaper_url = en.whitepaperUrl.trim();
  if (en.explorerUrls?.length) out.explorer_urls = [...en.explorerUrls];
  if (en.communityUrl?.trim()) out.community_url = en.communityUrl.trim();
  return out;
}

function detailBatchSize(): number {
  return Math.max(1, Number(process.env.CRYPTO_DETAIL_BATCH_SIZE ?? "500"));
}

function symbolPageSleepMs(): number {
  return Number(process.env.TRADINGVIEW_CRYPTO_SYMBOL_PAGE_SLEEP_MS ?? "250");
}

function symbolPageTimeoutMs(): number {
  return Number(process.env.TRADINGVIEW_CRYPTO_SYMBOL_PAGE_TIMEOUT_MS ?? "25000");
}

/**
 * Second phase: fetch TradingView crypto symbol HTML per `source_ids.tradingviewSymbolSlug`.
 * Skips documents that already have `detail_enriched_at` unless `CRYPTO_DETAIL_FORCE=1`.
 */
export async function enrichCryptoSymbolPages(
  client: MongoClient,
  dbName: string,
  issues: CrawlIssue[],
): Promise<void> {
  const force = process.env.CRYPTO_DETAIL_FORCE?.trim() === "1";
  const batchSize = detailBatchSize();
  const sleepMs = symbolPageSleepMs();
  const timeoutMs = symbolPageTimeoutMs();

  const col = client.db(dbName).collection<CryptoDocument>("cryptos");

  const filter = force
    ? { "source_ids.tradingviewSymbolSlug": { $exists: true, $nin: [null, ""] } }
    : {
        detail_enriched_at: { $exists: false },
        "source_ids.tradingviewSymbolSlug": { $exists: true, $nin: [null, ""] },
      };

  const totalPending = await col.countDocuments(filter);
  console.log(
    `[crypto detail] starting symbol-page enrichment (${force ? "force all with slug" : "missing detail_enriched_at"}) — ~${totalPending} document(s)`,
  );

  const cursor = col.find(filter, { projection: { crypto_id: 1, source_ids: 1 } });

  const ops: Array<{
    updateOne: {
      filter: { crypto_id: string };
      update: { $set: Record<string, unknown> };
    };
  }> = [];

  let processed = 0;

  for await (const doc of cursor) {
    const slug = doc.source_ids?.tradingviewSymbolSlug?.trim();
    if (!slug) continue;

    try {
      const en = await fetchTradingViewCryptoSymbolPageEnrichment(slug, { timeoutMs, sleepMs });
      const now = new Date();
      const fields = enrichmentToCryptoFields(en);
      const $set = omitNullUndefinedForSet({
        ...(fields as Record<string, unknown>),
        updated_at: now,
        detail_enriched_at: now,
      });

      ops.push({
        updateOne: {
          filter: { crypto_id: doc.crypto_id },
          update: { $set: $set },
        },
      });
      processed += 1;

      if (ops.length >= batchSize) {
        await col.bulkWrite(ops, { ordered: false });
        console.log(`[crypto detail] flushed ${ops.length} update(s) | processed so far: ${processed}`);
        ops.length = 0;
      }
    } catch (error: unknown) {
      issues.push({
        assetId: doc.crypto_id,
        market: "crypto",
        message: `crypto symbol page (${slug}): ${String(error)}`,
      });
    }
  }

  if (ops.length > 0) {
    await col.bulkWrite(ops, { ordered: false });
    console.log(`[crypto detail] flushed final ${ops.length} update(s)`);
  }

  console.log(`[crypto detail] done. Processed: ${processed}`);
}
