import { fetchUsdVndRate } from "../providers/exchangeRate.js";
import { fetchPhuQuySilverPrices } from "../providers/phuQuySilver.js";
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

function two(n: number): string {
  return `${n}`.padStart(2, "0");
}

function formatDetailTimestamp(dt: Date): string {
  return `${two(dt.getHours())}:${two(dt.getMinutes())} ${two(dt.getDate())}/${two(dt.getMonth() + 1)}`;
}

function toK(v: number): number {
  return Number((v / 1000).toFixed(3));
}

function computeSellStats(points: Array<{ price: number }>): {
  points: number;
  high: number | null;
  low: number | null;
  avg: number | null;
} {
  if (points.length === 0) return { points: 0, high: null, low: null, avg: null };
  const prices = points.map((p) => p.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const avg = prices.reduce((sum, v) => sum + v, 0) / prices.length;
  return { points: points.length, high, low, avg };
}

export async function ingestVietnamGold(
  payload: IngestionPayload,
  issues: CrawlIssue[],
  options: IngestVietnamGoldOptions,
): Promise<void> {
  let convertedVndPerLuong: number | null = null;
  let globalGoldUsdOz: number | null = null;
  try {
    const [usdVnd, globalGold] = await Promise.all([fetchUsdVndRate(), fetchVangTodayPrice("XAUUSD")]);
    globalGoldUsdOz = globalGold.sell;
    convertedVndPerLuong = (globalGold.sell * usdVnd * 37.5) / 31.1035;
  } catch (error: unknown) {
    issues.push({
      assetId: "vn_gold_global_reference",
      market: "vietnam_gold",
      message: `Cannot refresh global gold reference: ${String(error)}`,
    });
  }

  try {
    const brands = await discoverVangTodayBrands(options.limit);
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
        const premium = convertedVndPerLuong != null ? latest.sell - convertedVndPerLuong : null;
        const statWindow = historyPoints.slice(-30);
        const stat30d = computeSellStats(statWindow);

        payload.vietnamGoldSnapshots.push({
          brand_id: brandId,
          metal_type: "gold",
          source: "vang.today",
          detail_last_update_text: formatDetailTimestamp(latest.updatedAt),
          buy_price: latest.buy,
          sell_price: latest.sell,
          detail_price_buy_k: toK(latest.buy),
          detail_price_sell_k: toK(latest.sell),
          today_change_buy: latest.changeBuyAbs,
          today_change_sell: latest.changeSellAbs,
          spread,
          change_1d: changes.d1,
          change_1w: changes.w1,
          change_1m: changes.m1,
          change_ytd: changes.ytd,
          stat_30d_points: stat30d.points,
          stat_30d_sell_high: stat30d.high,
          stat_30d_sell_low: stat30d.low,
          stat_30d_sell_avg: stat30d.avg,
          global_gold_price_usd_oz: globalGoldUsdOz,
          converted_vnd_per_luong: convertedVndPerLuong,
          premium_vs_global: premium,
          sparkline_7d: buildSparkline(historyPoints, 7),
          updated_at: new Date(),
        });

        const history: VietnamGoldPriceHistoryDocument[] = historyPoints.map((row) => ({
          brand_id: brandId,
          metal_type: "gold",
          source: "vang.today",
          interval: "1d",
          timestamp: toStartOfDay(row.timestamp),
          buy_price: latest.buy,
          sell_price: row.price,
          spread,
          premium_vs_global: convertedVndPerLuong != null ? row.price - convertedVndPerLuong : null,
        }));

        payload.vietnamGoldBrands.push(
          buildVietnamGoldBrandDoc({
            code: brand.code,
            // Prefer canonical display name from per-type payload (detail API),
            // fallback to discovery name/code when unavailable.
            name: latest.name ?? brand.name,
            unit: "VND/luong",
            metalType: "gold",
            source: "vang.today",
          }),
        );
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
  } catch (error: unknown) {
    issues.push({ assetId: "vang_today_discovery", market: "vietnam_gold", message: String(error) });
  }

  try {
    const silverRows = await fetchPhuQuySilverPrices();
    for (const row of silverRows.slice(0, options.limit)) {
      const brandId = normalizeId("vn_gold", row.code);
      const spread = row.sell - row.buy;
      const historyPoints = [{ timestamp: row.updatedAt, price: row.sell, volume: 0 }];

      payload.vietnamGoldBrands.push(
        buildVietnamGoldBrandDoc({
          code: row.code,
          name: row.name,
          unit: row.unit,
          metalType: "silver",
          source: "phuquy",
        }),
      );

      payload.vietnamGoldSnapshots.push({
        brand_id: brandId,
        metal_type: "silver",
        source: "phuquy",
        detail_last_update_text: formatDetailTimestamp(row.updatedAt),
        buy_price: row.buy,
        sell_price: row.sell,
        detail_price_buy_k: toK(row.buy),
        detail_price_sell_k: toK(row.sell),
        today_change_buy: null,
        today_change_sell: null,
        spread,
        change_1d: 0,
        change_1w: 0,
        change_1m: 0,
        change_ytd: 0,
        stat_30d_points: null,
        stat_30d_sell_high: null,
        stat_30d_sell_low: null,
        stat_30d_sell_avg: null,
        global_gold_price_usd_oz: null,
        converted_vnd_per_luong: null,
        premium_vs_global: null,
        sparkline_7d: buildSparkline(historyPoints, 7),
        updated_at: row.updatedAt,
      });

      payload.vietnamGoldHistory.push({
        brand_id: brandId,
        metal_type: "silver",
        source: "phuquy",
        interval: "1d",
        timestamp: toStartOfDay(row.updatedAt),
        buy_price: row.buy,
        sell_price: row.sell,
        spread,
        premium_vs_global: null,
      });

      payload.rawVietnamGold.push({
        source: "phuquy",
        brand_code: row.code,
        payload: row.rawPayload,
        fetched_at: new Date(),
      });
    }
  } catch (error: unknown) {
    issues.push({ assetId: "phuquy_silver", market: "vietnam_gold", message: String(error) });
  }
}
