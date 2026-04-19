import { MongoClient } from "mongodb";
import { omitNullUndefinedForSet } from "../lib/omitNullish.js";
import { omitCryptoDetailOwnedFieldsFromSet } from "../lib/cryptoDetailOwnedFields.js";
import { omitStockDetailOwnedFieldsFromSet } from "../lib/stockDetailOwnedFields.js";
import type {
  CommodityDocument,
  CommodityPriceHistoryDocument,
  CommoditySnapshotDocument,
  CryptoDocument,
  CryptoPriceHistoryDocument,
  CryptoSnapshotDocument,
  IngestionJobDocument,
  IngestionPayload,
  RawVietnamGoldDocument,
  StockDocument,
  StockPriceHistoryDocument,
  StockSnapshotDocument,
  VietnamGoldBrandDocument,
  VietnamGoldPriceHistoryDocument,
  VietnamGoldSnapshotDocument,
} from "../types.js";

export async function withMongo<T>(mongoUri: string, dbName: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function ensureIndexes(client: MongoClient, dbName: string): Promise<void> {
  const db = client.db(dbName);
  const stocks = db.collection<StockDocument>("stocks");
  const stockSnapshots = db.collection<StockSnapshotDocument>("stock_snapshots");
  const stockHistory = db.collection<StockPriceHistoryDocument>("stock_price_history");

  const cryptos = db.collection<CryptoDocument>("cryptos");
  const cryptoSnapshots = db.collection<CryptoSnapshotDocument>("crypto_snapshots");
  const cryptoHistory = db.collection<CryptoPriceHistoryDocument>("crypto_price_history");

  const commodities = db.collection<CommodityDocument>("commodities");
  const commoditySnapshots = db.collection<CommoditySnapshotDocument>("commodity_snapshots");
  const commodityHistory = db.collection<CommodityPriceHistoryDocument>("commodity_price_history");

  const vietnamGoldBrands = db.collection<VietnamGoldBrandDocument>("vietnam_gold_brands");
  const vietnamGoldSnapshots = db.collection<VietnamGoldSnapshotDocument>("vietnam_gold_snapshots");
  const vietnamGoldHistory = db.collection<VietnamGoldPriceHistoryDocument>("vietnam_gold_price_history");

  const news = db.collection("market_news");
  const insights = db.collection("market_insights");
  const searchIndex = db.collection("search_index_cache");
  const jobs = db.collection<IngestionJobDocument>("ingestion_jobs");
  const rawVietnamGold = db.collection<RawVietnamGoldDocument>("raw_vietnam_gold_prices");

  await stocks.createIndex({ slug: 1 }, { unique: true });
  await stocks.createIndex({ symbol: 1 });
  await stocks.createIndex({ detail_enriched_at: 1 }, { sparse: true });
  await stockSnapshots.createIndex({ stock_id: 1 }, { unique: true });
  await stockSnapshots.createIndex({ market_cap: -1 });
  await stockSnapshots.createIndex({ volume: -1 });
  await stockSnapshots.createIndex({ change_1d: -1 });
  await stockHistory.createIndex({ stock_id: 1, interval: 1, timestamp: -1 });

  await cryptos.createIndex({ slug: 1 }, { unique: true });
  await cryptos.createIndex({ symbol: 1 });
  await cryptos.createIndex({ detail_enriched_at: 1 }, { sparse: true });
  await cryptoSnapshots.createIndex({ crypto_id: 1 }, { unique: true });
  await cryptoSnapshots.createIndex({ market_cap: -1 });
  await cryptoSnapshots.createIndex({ volume_24h: -1 });
  await cryptoSnapshots.createIndex({ change_24h: -1 });
  await cryptoHistory.createIndex({ crypto_id: 1, interval: 1, timestamp: -1 });

  await commodities.createIndex({ slug: 1 }, { unique: true });
  await commodities.createIndex({ symbol: 1 });
  await commoditySnapshots.createIndex({ commodity_id: 1 }, { unique: true });
  await commoditySnapshots.createIndex({ volume: -1 });
  await commoditySnapshots.createIndex({ change_1d: -1 });
  await commodityHistory.createIndex({ commodity_id: 1, interval: 1, timestamp: -1 });

  await vietnamGoldBrands.createIndex({ slug: 1 }, { unique: true });
  await vietnamGoldBrands.createIndex({ brand_code: 1 }, { unique: true });
  await vietnamGoldSnapshots.createIndex({ brand_id: 1 }, { unique: true });
  await vietnamGoldSnapshots.createIndex({ premium_vs_global: -1 });
  await vietnamGoldHistory.createIndex({ brand_id: 1, interval: 1, timestamp: -1 });

  await news.createIndex({ published_at: -1 });
  await news.createIndex({ market: 1, published_at: -1 });
  await news.createIndex({ related_type: 1, related_ids: 1 });
  await insights.createIndex({ is_featured: -1, published_at: -1 });
  await insights.createIndex({ market: 1, is_featured: -1, published_at: -1 });
  await searchIndex.createIndex({ ref_type: 1, ref_id: 1 }, { unique: true });
  await searchIndex.createIndex({ market: 1, symbol: 1 });
  await searchIndex.createIndex({ slug: 1 });
  await jobs.createIndex({ started_at: -1, market: 1 });
  await rawVietnamGold.createIndex({ brand_code: 1, fetched_at: -1 });
}

/**
 * List / merge upserts: `$set` only defined (non-nullish) fields + `updated_at`,
 * so re-crawls do not wipe detail fields (CEO, long description, …) with null/short placeholders.
 */
function upsertSetWithCreatedAt<T extends { created_at: Date }>(doc: T): {
  $set: Record<string, unknown>;
  $setOnInsert: { created_at: Date };
} {
  const { created_at, ...rest } = doc;
  const $set = omitNullUndefinedForSet(rest as Record<string, unknown>);
  $set.updated_at = new Date();
  return { $set, $setOnInsert: { created_at } };
}

/** Scanner list writes: same as `upsertSetWithCreatedAt` but never `$set` symbol-page–owned fields. */
function upsertStockFromList(doc: StockDocument): {
  $set: Record<string, unknown>;
  $setOnInsert: { created_at: Date };
} {
  const { created_at, ...rest } = doc;
  let $set = omitNullUndefinedForSet(rest as Record<string, unknown>);
  $set = omitStockDetailOwnedFieldsFromSet($set);
  $set.updated_at = new Date();
  return { $set, $setOnInsert: { created_at } };
}

function upsertCryptoFromList(doc: CryptoDocument): {
  $set: Record<string, unknown>;
  $setOnInsert: { created_at: Date };
} {
  const { created_at, ...rest } = doc;
  let $set = omitNullUndefinedForSet(rest as Record<string, unknown>);
  $set = omitCryptoDetailOwnedFieldsFromSet($set);
  $set.updated_at = new Date();
  return { $set, $setOnInsert: { created_at } };
}

function snapshotCryptoUpdateSet(doc: CryptoSnapshotDocument): Record<string, unknown> {
  const $set = omitNullUndefinedForSet({ ...doc } as Record<string, unknown>);
  $set.updated_at = new Date();
  return $set;
}

function snapshotUpdateSet(doc: StockSnapshotDocument): Record<string, unknown> {
  const $set = omitNullUndefinedForSet({ ...doc } as Record<string, unknown>);
  $set.updated_at = new Date();
  return $set;
}

/** Per-stock console progress when persisting (slower). Off: `CRAWL_STOCK_PROGRESS=0`. */
function crawlStockProgressEnabled(): boolean {
  const v = process.env.CRAWL_STOCK_PROGRESS?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

async function persistStocksSnapshotsHistorySequential(
  client: MongoClient,
  dbName: string,
  stockDocs: StockDocument[],
  snapshotDocs: StockSnapshotDocument[],
  historyDocs: StockPriceHistoryDocument[],
): Promise<void> {
  const db = client.db(dbName);
  const stocks = db.collection<StockDocument>("stocks");
  const stockSnapshots = db.collection<StockSnapshotDocument>("stock_snapshots");
  const stockHistory = db.collection<StockPriceHistoryDocument>("stock_price_history");

  let totalInDb = await stocks.countDocuments();

  const n = stockDocs.length;
  for (let i = 0; i < n; i += 1) {
    const doc = stockDocs[i];
    const snap = snapshotDocs[i];
    const hist = historyDocs[i];

    const r = await stocks.updateOne({ stock_id: doc.stock_id }, upsertStockFromList(doc), { upsert: true });
    if (r.upsertedCount) totalInDb += 1;

    if (snap) {
      await stockSnapshots.updateOne({ stock_id: snap.stock_id }, { $set: snapshotUpdateSet(snap) }, { upsert: true });
    }
    if (hist) {
      try {
        await stockHistory.insertOne(hist);
      } catch (e: unknown) {
        const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: number }).code : undefined;
        if (code !== 11000) throw e;
      }
    }

    const tv = doc.source_ids?.tradingviewTicker ?? doc.symbol;
    console.log(`[stock] ${tv} — ${doc.name} | tổng trong DB: ${totalInDb}`);
  }
}

/** List-crawl batch write (stocks + snapshots + history). Uses bulkWrite unless `CRAWL_STOCK_PROGRESS=1`. */
export async function persistStockBatch(
  client: MongoClient,
  dbName: string,
  stockDocs: StockDocument[],
  snapshotDocs: StockSnapshotDocument[],
  historyDocs: StockPriceHistoryDocument[],
): Promise<void> {
  if (stockDocs.length === 0) return;

  if (crawlStockProgressEnabled()) {
    await persistStocksSnapshotsHistorySequential(client, dbName, stockDocs, snapshotDocs, historyDocs);
    return;
  }

  const db = client.db(dbName);
  const stocks = db.collection<StockDocument>("stocks");
  const stockSnapshots = db.collection<StockSnapshotDocument>("stock_snapshots");
  const stockHistory = db.collection<StockPriceHistoryDocument>("stock_price_history");

  await stocks.bulkWrite(
    stockDocs.map((doc) => ({
      updateOne: {
        filter: { stock_id: doc.stock_id },
        update: upsertStockFromList(doc),
        upsert: true,
      },
    })),
    { ordered: false },
  );
  await stockSnapshots.bulkWrite(
    snapshotDocs.map((doc) => ({
      updateOne: {
        filter: { stock_id: doc.stock_id },
        update: { $set: snapshotUpdateSet(doc) },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  if (historyDocs.length > 0) {
    await stockHistory.insertMany(historyDocs, { ordered: false });
  }

  const totalInDb = await stocks.countDocuments();
  console.log(`[stocks] flushed ${stockDocs.length} row(s) to DB | tổng trong DB (collection stocks): ${totalInDb}`);
}

export async function startIngestionJob(
  client: MongoClient,
  dbName: string,
  seed: Pick<IngestionJobDocument, "job_id" | "job_name" | "market" | "source">,
): Promise<void> {
  const jobs = client.db(dbName).collection<IngestionJobDocument>("ingestion_jobs");
  await jobs.insertOne({
    ...seed,
    started_at: new Date(),
    status: "running",
    items_processed: 0,
  });
}

export async function completeIngestionJob(
  client: MongoClient,
  dbName: string,
  jobId: string,
  update: Pick<IngestionJobDocument, "status" | "items_processed" | "error_message">,
): Promise<void> {
  const jobs = client.db(dbName).collection<IngestionJobDocument>("ingestion_jobs");
  await jobs.updateOne(
    { job_id: jobId },
    {
      $set: {
        ...update,
        finished_at: new Date(),
      },
    },
  );
}

export async function persistMarketPayload(
  client: MongoClient,
  dbName: string,
  payload: IngestionPayload,
): Promise<void> {
  const db = client.db(dbName);

  const stocks = db.collection<StockDocument>("stocks");
  const stockSnapshots = db.collection<StockSnapshotDocument>("stock_snapshots");
  const stockHistory = db.collection<StockPriceHistoryDocument>("stock_price_history");

  const cryptos = db.collection<CryptoDocument>("cryptos");
  const cryptoSnapshots = db.collection<CryptoSnapshotDocument>("crypto_snapshots");
  const cryptoHistory = db.collection<CryptoPriceHistoryDocument>("crypto_price_history");

  const commodities = db.collection<CommodityDocument>("commodities");
  const commoditySnapshots = db.collection<CommoditySnapshotDocument>("commodity_snapshots");
  const commodityHistory = db.collection<CommodityPriceHistoryDocument>("commodity_price_history");

  const vietnamGoldBrands = db.collection<VietnamGoldBrandDocument>("vietnam_gold_brands");
  const vietnamGoldSnapshots = db.collection<VietnamGoldSnapshotDocument>("vietnam_gold_snapshots");
  const vietnamGoldHistory = db.collection<VietnamGoldPriceHistoryDocument>("vietnam_gold_price_history");
  const rawVietnamGold = db.collection<RawVietnamGoldDocument>("raw_vietnam_gold_prices");

  if (payload.stocks.length > 0) {
    await persistStockBatch(client, dbName, payload.stocks, payload.stockSnapshots, payload.stockHistory);
  }

  if (payload.cryptos.length > 0) {
    await cryptos.bulkWrite(
      payload.cryptos.map((doc) => ({
        updateOne: {
          filter: { crypto_id: doc.crypto_id },
          update: upsertCryptoFromList(doc),
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (payload.cryptoSnapshots.length > 0) {
    await cryptoSnapshots.bulkWrite(
      payload.cryptoSnapshots.map((doc) => ({
        updateOne: {
          filter: { crypto_id: doc.crypto_id },
          update: { $set: snapshotCryptoUpdateSet(doc) },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (payload.cryptoHistory.length > 0) {
    await cryptoHistory.insertMany(payload.cryptoHistory, { ordered: false });
  }

  if (payload.commodities.length > 0) {
    await commodities.bulkWrite(
      payload.commodities.map((doc) => ({
        updateOne: {
          filter: { commodity_id: doc.commodity_id },
          update: upsertSetWithCreatedAt(doc),
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (payload.commoditySnapshots.length > 0) {
    await commoditySnapshots.bulkWrite(
      payload.commoditySnapshots.map((doc) => ({
        updateOne: {
          filter: { commodity_id: doc.commodity_id },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (payload.commodityHistory.length > 0) {
    await commodityHistory.insertMany(payload.commodityHistory, { ordered: false });
  }

  if (payload.vietnamGoldBrands.length > 0) {
    await vietnamGoldBrands.bulkWrite(
      payload.vietnamGoldBrands.map((doc) => ({
        updateOne: {
          filter: { brand_id: doc.brand_id },
          update: upsertSetWithCreatedAt(doc),
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (payload.vietnamGoldSnapshots.length > 0) {
    await vietnamGoldSnapshots.bulkWrite(
      payload.vietnamGoldSnapshots.map((doc) => ({
        updateOne: {
          filter: { brand_id: doc.brand_id },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (payload.vietnamGoldHistory.length > 0) {
    await vietnamGoldHistory.insertMany(payload.vietnamGoldHistory, { ordered: false });
  }

  if (payload.rawVietnamGold.length > 0) {
    await rawVietnamGold.insertMany(payload.rawVietnamGold, { ordered: false });
  }
}

export async function refreshSearchIndex(client: MongoClient, dbName: string): Promise<void> {
  const db = client.db(dbName);
  const searchIndex = db.collection("search_index_cache");
  const stocks = db.collection<StockDocument>("stocks");
  const cryptos = db.collection<CryptoDocument>("cryptos");
  const commodities = db.collection<CommodityDocument>("commodities");
  const vietnamGoldBrands = db.collection<VietnamGoldBrandDocument>("vietnam_gold_brands");

  const stockDocs = await stocks.find({}, { projection: { stock_id: 1, symbol: 1, name: 1, slug: 1, logo: 1 } }).toArray();
  const cryptoDocs = await cryptos.find({}, { projection: { crypto_id: 1, symbol: 1, name: 1, slug: 1, logo: 1 } }).toArray();
  const commodityDocs = await commodities.find({}, { projection: { commodity_id: 1, symbol: 1, name: 1, slug: 1 } }).toArray();
  const goldDocs = await vietnamGoldBrands.find({}, { projection: { brand_id: 1, brand_code: 1, name: 1, slug: 1, logo: 1 } }).toArray();

  const docs = [
    ...stockDocs.map((d) => ({
      ref_id: d.stock_id,
      ref_type: "stock",
      market: "stock",
      symbol: d.symbol,
      name: d.name,
      slug: d.slug,
      logo: d.logo,
      search_blob: `${d.symbol} ${d.name} ${d.slug}`.toLowerCase(),
    })),
    ...cryptoDocs.map((d) => ({
      ref_id: d.crypto_id,
      ref_type: "crypto",
      market: "crypto",
      symbol: d.symbol,
      name: d.name,
      slug: d.slug,
      logo: d.logo,
      search_blob: `${d.symbol} ${d.name} ${d.slug}`.toLowerCase(),
    })),
    ...commodityDocs.map((d) => ({
      ref_id: d.commodity_id,
      ref_type: "commodity",
      market: "commodity",
      symbol: d.symbol,
      name: d.name,
      slug: d.slug,
      logo: undefined,
      search_blob: `${d.symbol} ${d.name} ${d.slug}`.toLowerCase(),
    })),
    ...goldDocs.map((d) => ({
      ref_id: d.brand_id,
      ref_type: "vietnam_gold",
      market: "vietnam_gold",
      symbol: d.brand_code,
      name: d.name,
      slug: d.slug,
      logo: d.logo,
      search_blob: `${d.brand_code} ${d.name} ${d.slug}`.toLowerCase(),
    })),
  ];

  if (docs.length > 0) {
    await searchIndex.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { ref_type: doc.ref_type, ref_id: doc.ref_id },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
}

export async function seedContentCollections(client: MongoClient, dbName: string): Promise<void> {
  const db = client.db(dbName);
  const news = db.collection("market_news");
  const insights = db.collection("market_insights");

  await news.updateOne(
    { slug: "veriq-market-placeholder-news" },
    {
      $set: {
        slug: "veriq-market-placeholder-news",
        title: "Veriq Markets ingestion online",
        summary: "Market snapshots and histories are now updated in MongoDB.",
        content: "This seeded item validates collection shape for market news queries.",
        market: "all",
        related_type: "mixed",
        related_ids: [],
        source_name: "system",
        source_url: "",
        published_at: new Date(),
      },
    },
    { upsert: true },
  );

  await insights.updateOne(
    { slug: "veriq-market-placeholder-insight" },
    {
      $set: {
        slug: "veriq-market-placeholder-insight",
        title: "Cross-market momentum watch",
        summary: "Template insight row for homepage featured card.",
        content: "Use this as baseline structure for AI-generated insight content.",
        market: "all",
        insight_type: "macro",
        related_type: "mixed",
        related_ids: [],
        is_featured: true,
        published_at: new Date(),
      },
    },
    { upsert: true },
  );
}
