/**
 * Mongo field names written by symbol-page detail crawl (`enrichmentToCryptoFields` in cryptoDetails.ts).
 * Scanner list upserts must not `$set` these.
 */
export const CRYPTO_DETAIL_OWNED_FIELD_KEYS = new Set<string>([
  "description",
  "profile_category",
  "website_url",
  "source_code_url",
  "whitepaper_url",
  "explorer_urls",
  "community_url",
  "detail_enriched_at",
]);

export function omitCryptoDetailOwnedFieldsFromSet(set: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...set };
  for (const k of CRYPTO_DETAIL_OWNED_FIELD_KEYS) {
    delete out[k];
  }
  return out;
}
