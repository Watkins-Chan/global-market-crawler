export interface TradingEconomicsCommodityQuote {
  symbol: string;
  name: string;
  slug: string;
  group: string | null;
  unit: string | null;
  price: number;
  day_change_abs: number;
  day_change_pct: number;
  week_change_pct: number;
  month_change_pct: number;
  ytd_change_pct: number;
  yoy_change_pct: number;
  date_label: string | null;
}

export interface TradingEconomicsCommodityDetail {
  actual: number | null;
  previous: number | null;
  highest: number | null;
  lowest: number | null;
  unit: string | null;
  frequency: string | null;
  description: string | null;
}

const TE_HEADERS = {
  // TradingEconomics blocks generic bot-like UA strings; use browser-like default.
  "user-agent":
    process.env.TRADINGECONOMICS_USER_AGENT ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://tradingeconomics.com/",
};

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toNum(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[^\d.+-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export async function fetchTradingEconomicsCommodities(limit?: number): Promise<TradingEconomicsCommodityQuote[]> {
  const url = "https://tradingeconomics.com/commodities";
  const res = await fetch(url, { headers: TE_HEADERS });
  if (!res.ok) throw new Error(`TradingEconomics commodities failed: ${res.status}`);
  const html = await res.text();
  const out: TradingEconomicsCommodityQuote[] = [];
  const tables = [...html.matchAll(/<table[^>]*table-hover[^>]*table-heatmap[^>]*>[\s\S]*?<\/table>/gi)].map((m) => m[0]);

  for (const table of tables) {
    const group =
      decodeEntities((table.match(/<th[^>]*>([^<]+)<\/th>\s*<th[^>]*>Price<\/th>/i)?.[1] ?? "").trim()) || null;

    const rows = [...table.matchAll(/<tr[^>]*data-symbol="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const row of rows) {
      const symbol = (row[1] ?? "").trim();
      const body = row[2] ?? "";
      const link = body.match(/<a href="(\/commodity\/[^"]+)">\s*<b>([^<]+)<\/b>/i);
      const href = link?.[1]?.trim();
      const name = decodeEntities((link?.[2] ?? "").trim());
      if (!symbol || !href || !name) continue;

      const slug = href.replace(/^\/commodity\//i, "");
      const unit = decodeEntities((body.match(/<div style='font-size:\s*10px;'>([^<]+)<\/div>/i)?.[1] ?? "").trim()) || null;
      const price = toNum(body.match(/<td[^>]*id="p"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? null);

      const dataValues = [...body.matchAll(/data-value="([^"]+)"/gi)].map((m) => toNum(m[1]) ?? 0);
      // Expected order from row markup:
      // [day_abs, day_pct, week_pct, month_pct, ytd_pct, yoy_pct]
      const dayAbs = dataValues[0] ?? 0;
      const dayPct = dataValues[1] ?? 0;
      const weekPct = dataValues[2] ?? 0;
      const monthPct = dataValues[3] ?? 0;
      const ytdPct = dataValues[4] ?? 0;
      const yoyPct = dataValues[5] ?? 0;

      const tdCells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decodeEntities(stripTags(m[1] ?? "")));
      const dateLabel = tdCells.length > 0 ? (tdCells[tdCells.length - 1] ?? null) : null;
      if (price === null) continue;

      out.push({
        symbol,
        name,
        slug,
        group,
        unit,
        price,
        day_change_abs: dayAbs,
        day_change_pct: dayPct,
        week_change_pct: weekPct,
        month_change_pct: monthPct,
        ytd_change_pct: ytdPct,
        yoy_change_pct: yoyPct,
        date_label: dateLabel,
      });
    }
  }

  return typeof limit === "number" && limit > 0 ? out.slice(0, limit) : out;
}

export async function fetchTradingEconomicsCommodityDetail(slug: string): Promise<TradingEconomicsCommodityDetail> {
  const url = `https://tradingeconomics.com/commodity/${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: TE_HEADERS });
  if (!res.ok) throw new Error(`TradingEconomics commodity detail failed (${slug}): ${res.status}`);
  const html = await res.text();

  const tableMatch = html.match(/<table class="table" style="margin-bottom:\s*0px;">([\s\S]*?)<\/table>/i);
  let actual: number | null = null;
  let previous: number | null = null;
  let highest: number | null = null;
  let lowest: number | null = null;
  let unit: string | null = null;
  let frequency: string | null = null;

  if (tableMatch) {
    const row = tableMatch[1].match(
      /<tr>\s*<td><\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>/i,
    );
    if (row) {
      actual = toNum(row[1]);
      previous = toNum(row[2]);
      highest = toNum(row[3]);
      lowest = toNum(row[4]);
      unit = decodeEntities((row[6] ?? "").trim()) || null;
      frequency = decodeEntities((row[7] ?? "").trim()) || null;
    }
  }

  const metaDescRaw = html.match(/<meta id="metaDesc" name="description" content="([^"]+)"/i)?.[1] ?? null;
  const description = metaDescRaw ? decodeEntities(metaDescRaw).trim() : null;

  return { actual, previous, highest, lowest, unit, frequency, description };
}
