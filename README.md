# Veriq Markets Crawler

Backend ingestion and crawler service for real market data.  
Frontend should read data from internal API/MongoDB, not third-party APIs directly.

## Collections

### Stocks
- `stocks`
- `stock_snapshots`
- `stock_price_history`

### Crypto
- `cryptos`
- `crypto_snapshots`
- `crypto_price_history`

### Commodities
- `commodities`
- `commodity_snapshots`
- `commodity_price_history`

### Vietnam Gold
- `vietnam_gold_brands`
- `vietnam_gold_snapshots`
- `vietnam_gold_price_history`
- `raw_vietnam_gold_prices`

### Shared
- `market_news`
- `market_insights`
- `search_index_cache`
- `ingestion_jobs`

## Sources

- Stocks: TradingView equity scanner + optional symbol-page detail (`pnpm run crawl:stocks:detail`).
- Crypto: TradingView coin scanner + optional symbol-page detail (`pnpm run crawl:crypto:detail`).
- Commodities: Yahoo market summary discovery + Yahoo chart history (`/v8/finance/chart`).
- Vietnam Gold: dynamic brand discovery from `vang.today` page + `vang.today/api/prices`.
- FX conversion: `open.er-api.com` for USD/VND.

No static `ASSET_CONFIGS` list is used. Universe is discovered at runtime from source data.

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill `.env` API keys and MongoDB URI.

## Run

Dry run (no DB write):

```bash
pnpm run crawl:dry
```

Dry run writes output JSON to `outputs/`.

Write to MongoDB:

```bash
pnpm run crawl
```

Run by market scope:

```bash
pnpm run crawl -- --market=crypto
pnpm run crawl -- --market=stock
pnpm run crawl -- --market=commodity
pnpm run crawl -- --market=vietnam_gold
```

## Recommended Cron

- Crypto: every 5-10 minutes
- Stocks: every 5-15 minutes during market hours
- Commodities: every 15-30 minutes
- Vietnam Gold: every 5-15 minutes
