export interface PhuQuySilverQuote {
  code: string;
  name: string;
  unit: "VND/luong" | "VND/kg";
  buy: number;
  sell: number;
  group: string | null;
  updatedAt: Date;
  rawPayload: unknown;
}

const PHU_QUY_URL = "https://giabac.phuquygroup.vn/PhuQuyPrice/SilverPricePartial";

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

function parseVnNumber(s: string): number | null {
  const cleaned = s.replace(/[^\d,.-]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeUnit(unitText: string): "VND/luong" | "VND/kg" {
  const u = unitText.toLowerCase();
  if (u.includes("/kg")) return "VND/kg";
  return "VND/luong";
}

function slugCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseUpdatedAtFromHtml(html: string): Date {
  const m = html.match(/class="time">\s*([^<]+)\s*<\/div>[\s\S]*?class="date">\s*([^<]+)\s*<\/div>/i);
  if (!m) return new Date();
  const timeText = stripTags(m[1] ?? "");
  const dateText = stripTags(m[2] ?? "");
  const full = `${timeText} ${dateText}`.trim();
  // expected: HH:mm DD/MM/YYYY
  const parts = full.match(/^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!parts) return new Date();
  const hour = Number(parts[1]);
  const minute = Number(parts[2]);
  const day = Number(parts[3]);
  const month = Number(parts[4]) - 1;
  const year = Number(parts[5]);
  return new Date(year, month, day, hour, minute, 0, 0);
}

export async function fetchPhuQuySilverPrices(): Promise<PhuQuySilverQuote[]> {
  const response = await fetch(PHU_QUY_URL, {
    headers: {
      "user-agent": process.env.USER_AGENT ?? "Mozilla/5.0 (compatible; veriq-markets-crawler/1.0)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "x-requested-with": "XMLHttpRequest",
    },
  });
  if (!response.ok) throw new Error(`phuquy silver partial failed: ${response.status}`);
  const html = await response.text();
  const updatedAt = parseUpdatedAtFromHtml(html);

  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((m) => m[1] ?? "");
  const out: PhuQuySilverQuote[] = [];
  let currentGroup: string | null = null;
  const codeCount = new Map<string, number>();

  for (const row of rows) {
    const groupMatch = row.match(/class="branch_title"[^>]*>([\s\S]*?)<\/p>/i);
    if (groupMatch) {
      currentGroup = decodeEntities(stripTags(groupMatch[1] ?? ""));
      continue;
    }

    const cellMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length < 4) continue;

    const product = decodeEntities(stripTags(cellMatches[0]?.[1] ?? ""));
    const unitRaw = decodeEntities(stripTags(cellMatches[1]?.[1] ?? ""));
    const buyRaw = decodeEntities(stripTags(cellMatches[2]?.[1] ?? ""));
    const sellRaw = decodeEntities(stripTags(cellMatches[3]?.[1] ?? ""));
    if (!product || !unitRaw) continue;

    const buy = parseVnNumber(buyRaw);
    const sell = parseVnNumber(sellRaw);
    if (buy === null || sell === null) continue;

    const unit = normalizeUnit(unitRaw);
    const baseCode = `PQS_${slugCode(product)}`;
    const seen = codeCount.get(baseCode) ?? 0;
    codeCount.set(baseCode, seen + 1);
    const code = seen === 0 ? baseCode : `${baseCode}_${seen + 1}`;

    out.push({
      code,
      name: product,
      unit,
      buy,
      sell,
      group: currentGroup,
      updatedAt,
      rawPayload: {
        source: PHU_QUY_URL,
        group: currentGroup,
        row_html: row,
      },
    });
  }

  return out;
}
