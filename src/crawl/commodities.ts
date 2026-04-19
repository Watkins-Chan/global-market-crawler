import { fetchYahooMarketSummary, fetchYahooRange } from "../providers/yahoo.js";
import type { CommodityPriceHistoryDocument, IngestionPayload } from "../types.js";
import {
  avgVolume,
  buildCommodityDoc,
  buildOhlcFromPoints,
  buildSparkline,
  getChangeSet,
  normalizeId,
  sortByTimestamp,
  type CommoditySeed,
  type CrawlIssue,
} from "./helpers.js";

interface IngestCommoditiesOptions {
  limit: number;
}

export async function ingestCommodities(
  payload: IngestionPayload,
  issues: CrawlIssue[],
  options: IngestCommoditiesOptions,
): Promise<void> {
  const rows = await fetchYahooMarketSummary();
  const positiveNameKeywords = ["gold", "silver", "oil", "gas", "copper", "platinum", "wheat", "corn", "soy"];
  const negativeNameKeywords = ["s&p", "dow", "nasdaq", "russell"];
  const seeds: CommoditySeed[] = rows
    .filter((row) => row.symbol.endsWith("=F"))
    .filter((row) => {
      const lower = row.shortName.toLowerCase();
      if (negativeNameKeywords.some((keyword) => lower.includes(keyword))) return false;
      return positiveNameKeywords.some((keyword) => lower.includes(keyword));
    })
    .slice(0, options.limit)
    .map((row) => ({ symbol: row.symbol, name: row.shortName }));

  for (const seed of seeds) {
    const commodityId = normalizeId("commodity", seed.symbol);
    try {
      const points = (await fetchYahooRange(seed.symbol, "1y")).chartData;
      const sorted = sortByTimestamp(points);
      if (sorted.length === 0) throw new Error("No commodity chart data");

      const changes = getChangeSet(sorted);
      const price = sorted[sorted.length - 1]?.price ?? 0;
      payload.commoditySnapshots.push({
        commodity_id: commodityId,
        price,
        change_1d: changes.d1,
        change_1w: changes.w1,
        change_1m: changes.m1,
        change_ytd: changes.ytd,
        open: sorted[0]?.price ?? price,
        high: Math.max(...sorted.map((p) => p.price)),
        low: Math.min(...sorted.map((p) => p.price)),
        close: price,
        volume: sorted[sorted.length - 1]?.volume ?? 0,
        avg_volume: avgVolume(sorted.slice(-30)),
        open_interest: undefined,
        sparkline_7d: buildSparkline(sorted, 7),
        updated_at: new Date(),
      });

      const history: CommodityPriceHistoryDocument[] = buildOhlcFromPoints(sorted, (row) => ({
        commodity_id: commodityId,
        interval: "1d",
        timestamp: row.timestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }));

      payload.commodities.push(buildCommodityDoc(seed));
      payload.commodityHistory.push(...history);
    } catch (error: unknown) {
      issues.push({ assetId: commodityId, market: "commodity", message: String(error) });
    }
  }
}
