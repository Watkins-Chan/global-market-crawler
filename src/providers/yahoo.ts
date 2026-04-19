import type { ChartPoint } from "../types.js";
import { computeChangePercent } from "../lib/format.js";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }>;
      };
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
    }>;
  };
}

interface YahooMarketSummaryResponse {
  marketSummaryResponse?: {
    result?: Array<{
      symbol?: string;
      shortName?: string;
      regularMarketPrice?: { raw?: number };
      regularMarketChangePercent?: { raw?: number };
      regularMarketVolume?: { raw?: number };
    }>;
  };
}

export interface YahooRangeData {
  price: number;
  change24h: number;
  chartData: ChartPoint[];
}

export interface YahooMarketSummaryItem {
  symbol: string;
  shortName: string;
  price: number;
  changePercent: number;
  volume: number;
}

export async function fetchYahooMarketSummary(): Promise<YahooMarketSummaryItem[]> {
  const url = new URL("https://query1.finance.yahoo.com/v6/finance/quote/marketSummary");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; veriq-markets-crawler/1.0)",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Yahoo market summary failed: ${response.status}`);
  }

  const payload = (await response.json()) as YahooMarketSummaryResponse;
  const rows = payload.marketSummaryResponse?.result ?? [];
  return rows
    .filter((row) => row.symbol)
    .map((row) => ({
      symbol: row.symbol as string,
      shortName: row.shortName ?? (row.symbol as string),
      price: row.regularMarketPrice?.raw ?? 0,
      changePercent: row.regularMarketChangePercent?.raw ?? 0,
      volume: row.regularMarketVolume?.raw ?? 0,
    }));
}

export async function fetchYahooRange(symbol: string, range: "1mo" | "1y"): Promise<YahooRangeData> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", range);

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; veriq-markets-crawler/1.0)",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Yahoo request failed for ${symbol}/${range}: ${response.status}`);
  }

  const payload = (await response.json()) as YahooChartResponse;
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo result missing for ${symbol}/${range}`);

  const ts = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  const close = quote?.close ?? [];
  const vol = quote?.volume ?? [];
  const chartData: ChartPoint[] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const price = close[i];
    if (price == null) continue;
    chartData.push({
      timestamp: new Date(ts[i] * 1000),
      price: Number(price.toFixed(4)),
      volume: Number.isFinite(vol[i] as number) ? Number(vol[i]) : 0,
    });
  }

  const latestPrice = result.meta?.regularMarketPrice ?? chartData[chartData.length - 1]?.price ?? 0;
  const previousClose = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? latestPrice;

  return {
    price: Number(latestPrice.toFixed(4)),
    change24h: computeChangePercent(latestPrice, previousClose),
    chartData,
  };
}
