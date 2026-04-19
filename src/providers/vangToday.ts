import type { ChartPoint } from "../types.js";
import { computeChangePercent } from "../lib/format.js";

interface VangTodaySingleResponse {
  success: boolean;
  timestamp: number;
  type: string;
  buy: number;
  sell: number;
  change_sell?: number;
}

interface VangTodayHistoryResponse {
  success: boolean;
  history: Array<{
    date: string;
    prices: Record<string, { buy: number; sell: number }>;
  }>;
}

export interface VangTodayPrice {
  typeCode: string;
  buy: number;
  sell: number;
  spread: number;
  change24h: number;
  updatedAt: Date;
  rawPayload: unknown;
}

export interface VangTodayBrand {
  code: string;
  name: string;
}

const VANG_TODAY_HEADERS = {
  "user-agent": process.env.USER_AGENT ?? "Mozilla/5.0 (compatible; veriq-markets-crawler/1.0)",
  accept: "application/json,text/html,*/*",
};

export async function discoverVangTodayBrands(limit = 20): Promise<VangTodayBrand[]> {
  const response = await fetch("https://www.vang.today/", { headers: VANG_TODAY_HEADERS });
  if (!response.ok) throw new Error(`vang.today discovery failed: ${response.status}`);
  const html = await response.text();

  const matches = html.matchAll(/data-code="([A-Z0-9]+)"[\s\S]*?<div class="list-name gold-name">([^<]+)<\/div>/g);
  const byCode = new Map<string, VangTodayBrand>();
  for (const match of matches) {
    const code = (match[1] ?? "").trim();
    const name = (match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!code || code === "XAUUSD") continue;
    if (!byCode.has(code)) byCode.set(code, { code, name: name || code });
  }

  return [...byCode.values()].slice(0, limit);
}

export async function fetchVangTodayPrice(typeCode: string): Promise<VangTodayPrice> {
  const url = new URL("https://www.vang.today/api/prices");
  url.searchParams.set("type", typeCode);
  const response = await fetch(url, { headers: VANG_TODAY_HEADERS });
  if (!response.ok) throw new Error(`vang.today failed for ${typeCode}: ${response.status}`);
  const payload = (await response.json()) as VangTodaySingleResponse;
  if (!payload.success || !payload.type) throw new Error(`vang.today empty payload for ${typeCode}`);

  const previousSell = payload.change_sell != null ? payload.sell - payload.change_sell : payload.sell;
  return {
    typeCode: payload.type,
    buy: payload.buy,
    sell: payload.sell,
    spread: payload.sell - payload.buy,
    change24h: computeChangePercent(payload.sell, previousSell),
    updatedAt: new Date(payload.timestamp * 1000),
    rawPayload: payload,
  };
}

export async function fetchVangTodayHistory(typeCode: string, days: number): Promise<ChartPoint[]> {
  const url = new URL("https://www.vang.today/api/prices");
  url.searchParams.set("type", typeCode);
  url.searchParams.set("days", `${days}`);
  const response = await fetch(url, { headers: VANG_TODAY_HEADERS });
  if (!response.ok) throw new Error(`vang.today history failed for ${typeCode}: ${response.status}`);
  const payload = (await response.json()) as VangTodayHistoryResponse;
  if (!payload.success || !payload.history?.length) throw new Error(`vang.today history empty for ${typeCode}`);

  return payload.history
    .map((item) => {
      const row = item.prices?.[typeCode];
      if (!row) return null;
      return {
        timestamp: new Date(`${item.date}T00:00:00.000Z`),
        price: Number(row.sell.toFixed(2)),
        volume: 0,
      } as ChartPoint;
    })
    .filter((x): x is ChartPoint => x !== null)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
