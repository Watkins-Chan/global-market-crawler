import { fetchTradingEconomicsCommodities, fetchTradingEconomicsCommodityDetail } from "../providers/tradingEconomics.js";
import type { CommodityPriceHistoryDocument, IngestionPayload } from "../types.js";
import {
  buildSparkline,
  buildCommodityDoc,
  normalizeId,
  sortByTimestamp,
  toStartOfDay,
  type CommoditySeed,
  type CrawlIssue,
} from "./helpers.js";

interface IngestCommoditiesOptions {
  limit: number | undefined;
}

function parseTradingEconomicsDateLabel(label: string | null | undefined, now = new Date()): Date | null {
  if (!label) return null;
  const shortMonths: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const m = label.trim().toLowerCase().match(/^([a-z]{3})\/(\d{1,2})$/);
  if (!m) return null;
  const month = shortMonths[m[1] ?? ""];
  const day = Number(m[2]);
  if (month === undefined || !Number.isFinite(day) || day < 1 || day > 31) return null;
  let year = now.getUTCFullYear();
  // If parsed date lands too far in the future, treat it as previous year boundary.
  const tentative = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  if (tentative.getTime() - now.getTime() > 36 * 60 * 60 * 1000) {
    year -= 1;
  }
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

function impliedPreviousPrice(current: number, pct: number): number | null {
  const factor = 1 + pct / 100;
  if (!Number.isFinite(factor) || factor === 0) return null;
  const prev = current / factor;
  return Number.isFinite(prev) ? prev : null;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export async function ingestCommodities(
  payload: IngestionPayload,
  issues: CrawlIssue[],
  options: IngestCommoditiesOptions,
): Promise<void> {
  const rows = await fetchTradingEconomicsCommodities(options.limit);
  const seeds: CommoditySeed[] = rows.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    group: row.group ?? undefined,
    benchmark: "TradingEconomics commodities page",
    unit: row.unit ?? undefined,
    tradingEconomicsCommoditySlug: row.slug,
  }));

  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i]!;
    const row = rows[i]!;
    const commodityId = normalizeId("commodity", seed.symbol);
    try {
      const detail = await fetchTradingEconomicsCommodityDetail(row.slug);
      const price = detail.actual ?? row.price;
      const open = detail.previous ?? (price - row.day_change_abs);
      const high = detail.highest ?? Math.max(open, price);
      const low = detail.lowest ?? Math.min(open, price);
      const asOf = parseTradingEconomicsDateLabel(row.date_label) ?? new Date();

      const prevDay = price - row.day_change_abs;
      const prevWeek = impliedPreviousPrice(price, row.week_change_pct);
      const prevMonth = impliedPreviousPrice(price, row.month_change_pct);
      const prevYtd = impliedPreviousPrice(price, row.ytd_change_pct);
      const prevYoy = impliedPreviousPrice(price, row.yoy_change_pct);

      const timeline: Array<{ timestamp: Date; price: number }> = [];
      if (prevYoy !== null) {
        timeline.push({ timestamp: new Date(asOf.getTime() - 365 * 24 * 60 * 60 * 1000), price: prevYoy });
      }
      if (prevYtd !== null) {
        timeline.push({ timestamp: new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1, 0, 0, 0, 0)), price: prevYtd });
      }
      if (prevMonth !== null) {
        timeline.push({ timestamp: new Date(asOf.getTime() - 30 * 24 * 60 * 60 * 1000), price: prevMonth });
      }
      if (prevWeek !== null) {
        timeline.push({ timestamp: new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000), price: prevWeek });
      }
      timeline.push({ timestamp: new Date(asOf.getTime() - 24 * 60 * 60 * 1000), price: prevDay });
      timeline.push({ timestamp: asOf, price });

      const orderedTimeline = sortByTimestamp(
        timeline.map((p) => ({
          timestamp: toStartOfDay(p.timestamp),
          price: p.price,
          volume: 0,
        })),
      );

      const perStepMoves: number[] = [];
      for (let j = 1; j < orderedTimeline.length; j += 1) {
        const delta = Math.abs((orderedTimeline[j]?.price ?? 0) - (orderedTimeline[j - 1]?.price ?? 0));
        if (Number.isFinite(delta)) perStepMoves.push(delta);
      }
      const volume = Math.abs(row.day_change_abs);
      const avgVolume = perStepMoves.length > 0 ? avg(perStepMoves) : volume;

      const history: CommodityPriceHistoryDocument[] = orderedTimeline.map((p, idx) => {
        const prev = idx > 0 ? orderedTimeline[idx - 1] : p;
        const o = prev?.price ?? p.price;
        const c = p.price;
        return {
          commodity_id: commodityId,
          interval: "1d",
          timestamp: p.timestamp,
          open: o,
          high: Math.max(o, c),
          low: Math.min(o, c),
          close: c,
          volume: Math.abs(c - o),
        };
      });

      payload.commoditySnapshots.push({
        commodity_id: commodityId,
        price,
        change_1d: row.day_change_pct,
        change_1w: row.week_change_pct,
        change_1m: row.month_change_pct,
        change_ytd: row.ytd_change_pct,
        open,
        high,
        low,
        close: price,
        volume,
        avg_volume: avgVolume,
        open_interest: undefined,
        sparkline_7d: buildSparkline(orderedTimeline, 7),
        updated_at: asOf,
      });

      payload.commodities.push(
        buildCommodityDoc({
          ...seed,
          unit: detail.unit ?? seed.unit,
          description: detail.description ?? seed.description,
        }),
      );
      payload.commodityHistory.push(...history);
    } catch (error: unknown) {
      issues.push({ assetId: commodityId, market: "commodity", message: String(error) });
    }
  }
}
