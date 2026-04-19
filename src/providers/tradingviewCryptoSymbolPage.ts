/**
 * TradingView crypto asset symbol page, e.g. `https://www.tradingview.com/symbols/CRYPTO-BTCUSD/`
 * (see also [BTC USD on TradingView](https://www.tradingview.com/symbols/BTCUSD/?exchange=CRYPTO)).
 */

import { extractSchemaOrgCorporationDescription } from "./tradingviewSymbolPage.js";

export type TradingViewCryptoSymbolPageEnrichment = {
  profileDescription?: string;
  profileCategory?: string;
  websiteUrl?: string;
  sourceCodeUrl?: string;
  whitepaperUrl?: string;
  explorerUrls?: string[];
  communityUrl?: string;
};

const TV_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

/** Parse "About {Name}" blocks: Category (text), Website / Source code / … (https links). */
function parseCryptoAboutSection(html: string): Partial<TradingViewCryptoSymbolPageEnrichment> {
  const start = html.indexOf('data-qa-id="company-info-id-content"');
  const chunk = start >= 0 ? html.slice(start, start + 25_000) : html;

  const labels = ["Category", "Website", "Source code", "Explorers", "Whitepaper", "Community"] as const;
  const out: Partial<TradingViewCryptoSymbolPageEnrichment> = {};
  const explorers: string[] = [];

  function firstExternalHttps(slice: string): string | undefined {
    const matches = [...slice.matchAll(/href="(https:[^"]+)"/g)].map((m) => m[1]);
    return matches.find((u) => !u.includes("tradingview.com"));
  }

  for (const label of labels) {
    const idx = chunk.indexOf(`>${label}</div>`);
    if (idx === -1) continue;
    const slice = chunk.slice(idx, idx + 2500);
    const textVal = slice.match(/value-ststB_hQ">([^<]+)</)?.[1]?.trim();
    const href = firstExternalHttps(slice);

    if (label === "Category") {
      if (textVal) out.profileCategory = textVal;
    } else if (label === "Explorers") {
      const urls = [...slice.matchAll(/href="(https:[^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => !u.includes("tradingview.com"));
      for (const u of urls) {
        if (!explorers.includes(u)) explorers.push(u);
      }
    } else if (label === "Website" && href) {
      out.websiteUrl = href;
    } else if (label === "Source code" && href) {
      out.sourceCodeUrl = href;
    } else if (label === "Whitepaper" && href) {
      out.whitepaperUrl = href;
    } else if (label === "Community" && href) {
      out.communityUrl = href;
    }
  }

  if (explorers.length > 0) out.explorerUrls = explorers;
  return out;
}

export type FetchTradingViewCryptoSymbolPageOptions = {
  timeoutMs?: number;
  sleepMs?: number;
};

/**
 * GET `https://www.tradingview.com/symbols/{slug}/` and parse About + schema.org description.
 * `slug` is typically `CRYPTO-BTCUSD` from `tradingViewTickerToSymbolSlug("CRYPTO:BTCUSD")`.
 */
export async function fetchTradingViewCryptoSymbolPageEnrichment(
  slug: string,
  options: FetchTradingViewCryptoSymbolPageOptions = {},
): Promise<TradingViewCryptoSymbolPageEnrichment> {
  const { timeoutMs = 25_000, sleepMs = 0 } = options;
  const url = `https://www.tradingview.com/symbols/${encodeURIComponent(slug)}/`;
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) {
    throw new Error(`TradingView crypto symbol page ${res.status}: ${slug}`);
  }
  const html = await res.text();
  if (sleepMs > 0) await sleep(sleepMs);

  const fromAbout = parseCryptoAboutSection(html);
  const fromSchema = extractSchemaOrgCorporationDescription(html);

  const merged: TradingViewCryptoSymbolPageEnrichment = { ...fromAbout };
  if (fromSchema?.trim()) merged.profileDescription = fromSchema.trim();
  return merged;
}
