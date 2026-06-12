import "dotenv/config";
import { spawn } from "node:child_process";
import { join } from "node:path";
import cron from "node-cron";

/**
 * Long-running cron scheduler for the crawler.
 *
 * Schedules (overridable via env):
 * - stocks:      every 12h (list only — stock detail is NOT crawled)
 * - crypto:      every 1h
 * - commodities: every 1h
 * - vietnam-gold: every 1h
 *
 * Usage:
 *   pnpm run cron                       # start the scheduler
 *   pnpm run cron -- --run-now          # also run every job immediately on start
 *   pnpm run cron -- --run-now=crypto   # run a single job immediately, then keep schedule
 */

const STOCKS_SCHEDULE = process.env.STOCKS_CRON_SCHEDULE ?? "0 */12 * * *";
const HOURLY_SCHEDULE = process.env.HOURLY_CRON_SCHEDULE ?? "0 * * * *";

interface CronJobDef {
  name: string;
  script: string;
}

const STOCKS_JOB: CronJobDef = { name: "stocks", script: "src/scripts/crawl-stocks.ts" };

const HOURLY_JOBS: CronJobDef[] = [
  { name: "crypto", script: "src/scripts/crawl-crypto.ts" },
  { name: "commodities", script: "src/scripts/crawl-commodities.ts" },
  { name: "vietnam-gold", script: "src/scripts/crawl-vietnam-gold.ts" },
];

const ALL_JOBS: CronJobDef[] = [STOCKS_JOB, ...HOURLY_JOBS];

const running = new Set<string>();

function log(message: string): void {
  console.log(`[cron ${new Date().toISOString()}] ${message}`);
}

function runJob(job: CronJobDef): Promise<void> {
  if (running.has(job.name)) {
    log(`${job.name}: lần chạy trước chưa kết thúc, bỏ qua lượt này.`);
    return Promise.resolve();
  }
  running.add(job.name);
  log(`${job.name}: bắt đầu crawl (${job.script}).`);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
    const child = spawn(tsxBin, [job.script], { stdio: "inherit", env: process.env });

    child.on("error", (error) => {
      running.delete(job.name);
      log(`${job.name}: không spawn được process — ${String(error)}`);
      resolve();
    });

    child.on("exit", (code) => {
      running.delete(job.name);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      log(`${job.name}: kết thúc sau ${seconds}s với exit code ${code ?? "null"}.`);
      resolve();
    });
  });
}

/** Run hourly jobs sequentially to avoid hammering sources/DB at the same time. */
async function runHourlyJobs(): Promise<void> {
  for (const job of HOURLY_JOBS) {
    await runJob(job);
  }
}

function parseRunNowArg(args: string[]): "all" | string[] | null {
  const arg = args.find((a) => a === "--run-now" || a.startsWith("--run-now="));
  if (!arg) return null;
  if (arg === "--run-now") return "all";
  const names = arg
    .split("=")[1]
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return names.length > 0 ? names : "all";
}

cron.schedule(STOCKS_SCHEDULE, () => {
  void runJob(STOCKS_JOB);
});

cron.schedule(HOURLY_SCHEDULE, () => {
  void runHourlyJobs();
});

log("Scheduler đã khởi động.");
log(`- stocks (list only, không crawl detail): "${STOCKS_SCHEDULE}"`);
log(`- crypto, commodities, vietnam-gold (chạy tuần tự): "${HOURLY_SCHEDULE}"`);

const runNow = parseRunNowArg(process.argv.slice(2));
if (runNow) {
  const jobs =
    runNow === "all"
      ? ALL_JOBS
      : ALL_JOBS.filter((job) => runNow.includes(job.name));
  const unknown = runNow === "all" ? [] : runNow.filter((name) => !ALL_JOBS.some((job) => job.name === name));
  for (const name of unknown) {
    log(`Không có job tên "${name}". Các job hợp lệ: ${ALL_JOBS.map((j) => j.name).join(", ")}.`);
  }
  void (async () => {
    for (const job of jobs) {
      await runJob(job);
    }
    log("Hoàn tất các job --run-now, tiếp tục chạy theo lịch.");
  })();
}
