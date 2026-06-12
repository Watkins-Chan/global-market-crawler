/**
 * PM2 config for the crawler cron scheduler.
 *
 * Start:   pm2 start ecosystem.config.cjs
 * Persist: pm2 save && pm2 startup   (auto-start on boot)
 * Logs:    pm2 logs crawler-cron
 */
module.exports = {
  apps: [
    {
      name: "crawler-cron",
      cwd: __dirname,
      script: "node_modules/.bin/tsx",
      args: "src/scheduler.ts",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
    },
  ],
};
