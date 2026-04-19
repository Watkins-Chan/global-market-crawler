import "dotenv/config";
import { runCrawlCli } from "../cli/runCrawl.js";

runCrawlCli({
  defaultMarkets: ["vietnam_gold"],
  sourceLabel: "vang_today_discovery",
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
