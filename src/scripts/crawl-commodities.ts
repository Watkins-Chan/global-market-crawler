import "dotenv/config";
import { runCrawlCli } from "../cli/runCrawl.js";

runCrawlCli({
  defaultMarkets: ["commodity"],
  sourceLabel: "yahoo_market_summary",
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
