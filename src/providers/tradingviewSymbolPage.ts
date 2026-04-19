/**
 * Fetch TradingView public symbol detail HTML and extract embedded JSON
 * (`window.initData.symbolInfo`, schema.org Corporation description).
 * Slug format matches the site path: `EXCHANGE-SYMBOL` e.g. `NASDAQ-NVDA` from `NASDAQ:NVDA`.
 */

export type TradingViewSymbolPageEnrichment = {
  /** From `symbolInfo.isin_displayed` */
  isin?: string;
  /** Full business profile (schema.org Corporation `description`) */
  profileDescription?: string;
  /** IANA zone e.g. America/New_York */
  listingTimezone?: string;
  /** e.g. "Nasdaq Stock Market" */
  exchangeSourceName?: string;
  /** e.g. https://www.nasdaq.com */
  exchangeSourceUrl?: string;
  /** symbolInfo.typespecs */
  typespecs?: string[];
  /** symbolInfo.provider_id */
  providerId?: string;
  /** symbolInfo.country_code_fund */
  countryCodeFund?: string;
  /** symbolInfo.local_description — often fuller than scanner name */
  localDescription?: string;
  /** From embedded symbol-page JSON (same block as sector/industry) */
  ceo?: string;
  /** `web_site_url` e.g. http://www.nvidia.com */
  companyWebsite?: string;
  /** `location` e.g. Santa Clara */
  headquarters?: string;
  /** `founded` e.g. "1993" */
  founded?: string;
};

const TV_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function tradingViewTickerToSymbolSlug(tickerFull: string): string {
  const t = tickerFull.trim();
  if (!t) return t;
  return t.replace(":", "-");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.tradingview.com/",
        "user-agent": TV_UA,
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/** Parse balanced `{...}` JSON starting at first `{` after marker (handles strings). */
function extractJsonObjectAfter(html: string, marker: string): Record<string, unknown> | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  let start = idx + marker.length;
  while (start < html.length && /\s/.test(html[start])) start += 1;
  if (html[start] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === "\"") {
        inString = false;
      }
      continue;
    }
    if (c === "\"") {
      inString = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = html.slice(start, i + 1);
        try {
          return JSON.parse(slice) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseLdJsonScripts(html: string): unknown[] {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out: unknown[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* ignore invalid blocks */
    }
  }
  return out;
}

function flattenLdNode(node: unknown): unknown[] {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(flattenLdNode);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o["@graph"])) {
      return o["@graph"].flatMap(flattenLdNode);
    }
    return [node];
  }
  return [];
}

function corporationDescriptionFromLd(roots: unknown[]): string | undefined {
  const items = roots.flatMap(flattenLdNode);
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o["@type"];
    const types = Array.isArray(type) ? type : [type];
    const isCorp = types.some((t) => t === "Corporation" || t === "Organization");
    if (!isCorp) continue;
    const desc = o["description"];
    if (typeof desc === "string" && desc.trim()) return desc.trim();
  }
  return undefined;
}

/**
 * TradingView inlines JSON with `"ceo":"..."`, `"web_site_url":"..."` next to
 * `sector` / `isin_displayed` (one occurrence per symbol page in practice).
 */
function readQuotedJsonField(html: string, field: string): string | undefined {
  const prefix = `"${field}":"`;
  const i = html.indexOf(prefix);
  if (i === -1) return undefined;
  let j = i + prefix.length;
  let out = "";
  while (j < html.length) {
    const c = html[j];
    if (c === "\\") {
      if (j + 1 >= html.length) break;
      const n = html[j + 1];
      if (n === "n") out += "\n";
      else if (n === "r") out += "\r";
      else if (n === "t") out += "\t";
      else out += n;
      j += 2;
      continue;
    }
    if (c === "\"") break;
    out += c;
    j += 1;
  }
  const t = out.trim();
  return t.length > 0 ? t : undefined;
}

function readSymbolPageFundamentals(html: string): Partial<TradingViewSymbolPageEnrichment> {
  const ceo = readQuotedJsonField(html, "ceo");
  const web = readQuotedJsonField(html, "web_site_url");
  const hq = readQuotedJsonField(html, "location");
  const founded = readQuotedJsonField(html, "founded");
  const out: Partial<TradingViewSymbolPageEnrichment> = {};
  if (ceo) out.ceo = ceo;
  if (web) out.companyWebsite = web.startsWith("http") ? web : `https://${web}`;
  if (hq) out.headquarters = hq;
  if (founded) out.founded = founded;
  return out;
}

function readSymbolInfo(html: string): Partial<TradingViewSymbolPageEnrichment> {
  const json = extractJsonObjectAfter(html, "window.initData.symbolInfo = ");
  if (!json) return {};

  const out: Partial<TradingViewSymbolPageEnrichment> = {};
  const isin = json["isin_displayed"];
  if (typeof isin === "string" && isin.trim()) out.isin = isin.trim();

  const tz = json["timezone"];
  if (typeof tz === "string" && tz.trim()) out.listingTimezone = tz.trim();

  const typespecs = json["typespecs"];
  if (Array.isArray(typespecs) && typespecs.every((x) => typeof x === "string")) {
    out.typespecs = typespecs as string[];
  }

  const pid = json["provider_id"];
  if (typeof pid === "string" && pid.trim()) out.providerId = pid.trim();

  const ccf = json["country_code_fund"];
  if (typeof ccf === "string" && ccf.trim()) out.countryCodeFund = ccf.trim();

  const loc = json["local_description"];
  if (typeof loc === "string" && loc.trim()) out.localDescription = loc.trim();

  const s2 = json["source2"];
  if (s2 && typeof s2 === "object" && !Array.isArray(s2)) {
    const src = s2 as Record<string, unknown>;
    const n = src["name"];
    const u = src["url"];
    if (typeof n === "string" && n.trim()) out.exchangeSourceName = n.trim();
    if (typeof u === "string" && u.trim()) out.exchangeSourceUrl = u.trim();
  }

  return out;
}

export type FetchTradingViewSymbolPageOptions = {
  timeoutMs?: number;
  /** Extra delay after response (politeness) */
  sleepMs?: number;
};

/**
 * GET `https://www.tradingview.com/symbols/{slug}/` and parse embedded data.
 * Returns partial enrichment; throws on network/HTTP errors.
 */
export async function fetchTradingViewSymbolPageEnrichment(
  slug: string,
  options: FetchTradingViewSymbolPageOptions = {},
): Promise<TradingViewSymbolPageEnrichment> {
  const { timeoutMs = 25_000, sleepMs = 0 } = options;
  const url = `https://www.tradingview.com/symbols/${encodeURIComponent(slug)}/`;
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) {
    throw new Error(`TradingView symbol page ${res.status}: ${slug}`);
  }
  const html = await res.text();
  if (sleepMs > 0) await sleep(sleepMs);

  const fromInfo = readSymbolInfo(html);
  const fromFund = readSymbolPageFundamentals(html);
  const ldRoots = parseLdJsonScripts(html);
  const profileDescription = corporationDescriptionFromLd(ldRoots);

  const merged: TradingViewSymbolPageEnrichment = { ...fromInfo, ...fromFund };
  if (profileDescription) merged.profileDescription = profileDescription;
  return merged;
}

/** Long description from schema.org `Corporation` / `Organization` (also used on crypto symbol pages). */
export function extractSchemaOrgCorporationDescription(html: string): string | undefined {
  return corporationDescriptionFromLd(parseLdJsonScripts(html));
}
