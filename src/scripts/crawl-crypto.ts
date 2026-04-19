import "dotenv/config";
import { runCrawlCli } from "../cli/runCrawl.js";

runCrawlCli({
  defaultMarkets: ["crypto"],
  sourceLabel: "tradingview_coin_scan",
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
