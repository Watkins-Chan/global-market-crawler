import { fetchUsdVndRate } from "../providers/exchangeRate.js";
import { discoverVangTodayBrands, fetchVangTodayHistory, fetchVangTodayPrice } from "../providers/vangToday.js";
import type { IngestionPayload, VietnamGoldPriceHistoryDocument } from "../types.js";
import {
  buildSparkline,
  buildVietnamGoldBrandDoc,
  getChangeSet,
  normalizeId,
  sortByTimestamp,
  toStartOfDay,
  type CrawlIssue,
} from "./helpers.js";

interface IngestVietnamGoldOptions {
  limit: number;
}

export async function ingestVietnamGold(
  payload: IngestionPayload,
  issues: CrawlIssue[],
  options: IngestVietnamGoldOptions,
): Promise<void> {
  const brands = await discoverVangTodayBrands(options.limit);
  const [usdVnd, globalGold] = await Promise.all([
    fetchUsdVndRate(),
    fetchVangTodayPrice("XAUUSD"),
  ]);
  const convertedVndPerLuong = (globalGold.sell * usdVnd * 37.5) / 31.1035;

  for (const brand of brands) {
    const brandId = normalizeId("vn_gold", brand.code);
    try {
      const [latest, historyRaw] = await Promise.all([
        fetchVangTodayPrice(brand.code),
        fetchVangTodayHistory(brand.code, 365),
      ]);

      const historyPoints = sortByTimestamp(
        historyRaw.map((p) => ({ timestamp: p.timestamp, price: p.price, volume: 0 })),
      );
      const changes = getChangeSet(historyPoints);
      const spread = latest.sell - latest.buy;
      const premium = latest.sell - convertedVndPerLuong;

      payload.vietnamGoldSnapshots.push({
        brand_id: brandId,
        buy_price: latest.buy,
        sell_price: latest.sell,
        spread,
        change_1d: changes.d1,
        change_1w: changes.w1,
        change_1m: changes.m1,
        change_ytd: changes.ytd,
        global_gold_price_usd_oz: globalGold.sell,
        converted_vnd_per_luong: convertedVndPerLuong,
        premium_vs_global: premium,
        sparkline_7d: buildSparkline(historyPoints, 7),
        updated_at: new Date(),
      });

      const history: VietnamGoldPriceHistoryDocument[] = historyPoints.map((row) => ({
        brand_id: brandId,
        interval: "1d",
        timestamp: toStartOfDay(row.timestamp),
        buy_price: latest.buy,
        sell_price: row.price,
        spread,
        premium_vs_global: row.price - convertedVndPerLuong,
      }));

      payload.vietnamGoldBrands.push(buildVietnamGoldBrandDoc({ code: brand.code, name: brand.name }));
      payload.vietnamGoldHistory.push(...history);
      payload.rawVietnamGold.push({
        source: "vang.today",
        brand_code: brand.code,
        payload: latest.rawPayload,
        fetched_at: new Date(),
      });
    } catch (error: unknown) {
      issues.push({ assetId: brandId, market: "vietnam_gold", message: String(error) });
    }
  }
}
