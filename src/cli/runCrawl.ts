import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  completeIngestionJob,
  ensureIndexes,
  persistMarketPayload,
  refreshSearchIndex,
  seedContentCollections,
  startIngestionJob,
  withMongo,
} from "../db/mongo.js";
import { parseCryptoDiscoveryLimitFromEnv } from "../crawl/cryptoDiscoveryLimit.js";
import { parseStockDiscoveryLimitFromEnv } from "../crawl/stockDiscoveryLimit.js";
import { stockPersistFlushSize } from "../crawl/stocks.js";
import { countProcessedInstruments, buildRunSummary, emptyPayload, type CrawlIssue } from "../crawl/helpers.js";
import { runIngestionPipeline, type IngestionPipelineCounts } from "../crawl/pipeline.js";
import type { MarketType } from "../types.js";

export interface RunCrawlCliOptions {
  defaultMarkets: MarketType[];
  sourceLabel: string;
}

function parseMarketArg(args: string[]): MarketType[] | null {
  const marketArg = args.find((arg) => arg.startsWith("--market="));
  if (!marketArg) return null;
  const value = marketArg.split("=")[1];
  if (!value || value === "all") {
    return ["stock", "crypto", "commodity", "vietnam_gold"];
  }

  const markets = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v): v is MarketType => ["stock", "crypto", "commodity", "vietnam_gold"].includes(v));
  return markets.length > 0 ? markets : null;
}

function uniqueMarkets(markets: MarketType[]): MarketType[] {
  return [...new Set(markets)];
}

async function writeDryRunOutput(
  scopeLabel: string,
  summary: Record<string, unknown>,
): Promise<string> {
  const now = new Date();
  const pad = (v: number): string => `${v}`.padStart(2, "0");
  const fileName = `crawl-${scopeLabel}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
  const outputDir = join(process.cwd(), "outputs");
  const outputPath = join(outputDir, fileName);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(summary, null, 2), "utf-8");
  return outputPath;
}

export async function runCrawlCli(options: RunCrawlCliOptions): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const parsedMarkets = parseMarketArg(args);
  const selectedMarkets = uniqueMarkets(parsedMarkets ?? options.defaultMarkets);
  const marketScopeLabel = selectedMarkets.length === 4 ? "all" : selectedMarkets.join("_");
  const jobMarket = selectedMarkets.length === 1 ? selectedMarkets[0] : "all";
  const mongoUri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB_NAME ?? "global_market";
  const jobId = `ingest-${Date.now()}`;

  const payload = emptyPayload();
  const issues: CrawlIssue[] = [];

  const cryptoDiscoveryLimit = parseCryptoDiscoveryLimitFromEnv();
  const pipelineOpts = {
    markets: selectedMarkets,
    stockLimit: parseStockDiscoveryLimitFromEnv(),
    cryptoLimit: cryptoDiscoveryLimit,
    commodityLimit: Number(process.env.COMMODITY_DISCOVERY_LIMIT ?? "5"),
    vietnamGoldLimit: Number(process.env.VIETNAM_GOLD_DISCOVERY_LIMIT ?? "10"),
  };

  if (selectedMarkets.includes("crypto")) {
    const raw = process.env.CRYPTO_DISCOVERY_LIMIT?.trim();
    const capMsg =
      cryptoDiscoveryLimit === undefined
        ? "không giới hạn (crawl hết list coin trên TradingView)"
        : `giới hạn ${cryptoDiscoveryLimit} dòng (theo env)`;
    console.log(
      `[crawl] crypto: ${capMsg}. Để lấy full list: xóa hoặc để trống CRYPTO_DISCOVERY_LIMIT, hoặc ghi \`all\` / \`0\`. Giá trị hiện tại: ${raw === undefined || raw === "" ? "(trống)" : JSON.stringify(raw)}`,
    );
  }

  let pipelineCounts: IngestionPipelineCounts = { stockRowCount: 0 };

  if (dryRun) {
    pipelineCounts = await runIngestionPipeline(payload, issues, pipelineOpts);
    const itemsProcessed = countProcessedInstruments(payload, { stockRowCount: pipelineCounts.stockRowCount });
    console.log(`Processed ${itemsProcessed} market instruments`);
    if (issues.length > 0) {
      console.warn(`Encountered ${issues.length} crawl issue(s).`);
    }
    const summary = buildRunSummary(payload, issues);
    console.log("Dry run enabled, skip MongoDB write.");
    const full = summary as Record<string, unknown>;
    full.stocks = payload.stocks;
    full.stock_snapshots = payload.stockSnapshots;
    const outputPath = await writeDryRunOutput(marketScopeLabel, full);
    console.log(`Dry run JSON written to: ${outputPath}`);
    return;
  }

  if (!mongoUri) {
    throw new Error("MONGO_URI is required (set in environment or .env file).");
  }

  await withMongo(mongoUri, dbName, async (client) => {
    await ensureIndexes(client, dbName);
    await seedContentCollections(client, dbName);
    await startIngestionJob(client, dbName, {
      job_id: jobId,
      job_name: "veriq_markets_ingestion",
      market: jobMarket,
      source: options.sourceLabel,
    });

    try {
      pipelineCounts = await runIngestionPipeline(payload, issues, {
        ...pipelineOpts,
        stockListPersist: selectedMarkets.includes("stock")
          ? { client, dbName, flushEvery: stockPersistFlushSize() }
          : undefined,
      });

      await persistMarketPayload(client, dbName, payload);
      await refreshSearchIndex(client, dbName);

      const itemsProcessed = countProcessedInstruments(payload, { stockRowCount: pipelineCounts.stockRowCount });
      await completeIngestionJob(client, dbName, jobId, {
        status: issues.length > 0 ? "partial_success" : "success",
        items_processed: itemsProcessed,
        error_message: issues.length > 0 ? issues.map((issue) => `${issue.assetId}: ${issue.message}`).join(" | ") : undefined,
      });
    } catch (error: unknown) {
      await completeIngestionJob(client, dbName, jobId, {
        status: "failed",
        items_processed: 0,
        error_message: [...issues.map((issue) => `${issue.assetId}: ${issue.message}`), String(error)].join(" | "),
      });
      throw error;
    }
  });

  const itemsProcessed = countProcessedInstruments(payload, { stockRowCount: pipelineCounts.stockRowCount });
  console.log(`Processed ${itemsProcessed} market instruments`);
  if (issues.length > 0) {
    console.warn(`Encountered ${issues.length} crawl issue(s).`);
  }

  console.log(`Persisted market data into MongoDB (${dbName}) with job ${jobId}.`);
  if (selectedMarkets.includes("stock")) {
    console.log("Stock list đã ghi. Để enrich CEO / description / founded (phase riêng): pnpm run crawl:stocks:detail");
  }
  if (selectedMarkets.includes("crypto")) {
    console.log(
      "Crypto list (TradingView) đã ghi snapshot/scanner. Các field detail (description, website, whitepaper, explorers, community) không thuộc phase list — chạy: pnpm run crawl:crypto:detail",
    );
  }
  console.log("Suggested schedule: crypto 5-10m, stocks 5-15m market hours, commodities 15-30m, vietnam_gold 5-15m.");
}
