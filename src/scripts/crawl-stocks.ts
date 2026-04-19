import "dotenv/config";
import { runCrawlCli } from "../cli/runCrawl.js";

runCrawlCli({
  defaultMarkets: ["stock"],
  sourceLabel: "tradingview_global_scan",
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
