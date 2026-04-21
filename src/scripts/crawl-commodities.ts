import "dotenv/config";
import { runCrawlCli } from "../cli/runCrawl.js";

runCrawlCli({
  defaultMarkets: ["commodity"],
  sourceLabel: "tradingeconomics_commodities",
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
