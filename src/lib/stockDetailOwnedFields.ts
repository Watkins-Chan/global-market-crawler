/**
 * Mongo field names written by symbol-page detail crawl (`enrichmentToStockFields` in stockDetails.ts).
 * Scanner list upserts must not `$set` these so repeated list crawls never replace rich profile data.
 * Keep in sync when adding detail enrichment fields.
 */
export const STOCK_DETAIL_OWNED_FIELD_KEYS = new Set<string>([
  "description",
  "isin",
  "listing_timezone",
  "exchange_source_name",
  "exchange_source_url",
  "security_typespecs",
  "tradingview_provider_id",
  "country_code_fund",
  "ceo",
  "company_website",
  "headquarters",
  "founded",
  "detail_enriched_at",
]);

export function omitStockDetailOwnedFieldsFromSet(set: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...set };
  for (const k of STOCK_DETAIL_OWNED_FIELD_KEYS) {
    delete out[k];
  }
  return out;
}
