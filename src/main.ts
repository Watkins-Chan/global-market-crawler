import "dotenv/config";
import { runCrawlCli } from "./cli/runCrawl.js";

runCrawlCli({
  defaultMarkets: ["stock", "crypto", "commodity", "vietnam_gold"],
  sourceLabel: "tradingview_global_scan,tradingview_coin_scan,yahoo_market_summary,vang_today_discovery",
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
