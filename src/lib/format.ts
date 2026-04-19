import type { ChartPoint } from "../types.js";

export function computeChangePercent(current: number, previous: number): number {
  if (!Number.isFinite(previous) || previous === 0) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

export function toStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function sortByTimestamp(points: ChartPoint[]): ChartPoint[] {
  return [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export function buildSparkline(points: ChartPoint[], maxPoints = 7): number[] {
  if (points.length <= maxPoints) return points.map((p) => Number(p.price.toFixed(4)));
  const step = Math.max(1, Math.floor(points.length / maxPoints));
  return points
    .filter((_, idx) => idx % step === 0)
    .slice(-maxPoints)
    .map((p) => Number(p.price.toFixed(4)));
}
