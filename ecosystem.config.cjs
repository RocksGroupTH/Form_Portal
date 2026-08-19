/** PM2 process config — used by .AutoDeploy.bat on the Windows host. */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "form-portal",
      cwd: __dirname,
      // Run the Next.js CLI JS directly via node. Spawning `npm` / `next`
      // (which resolve to .cmd on Windows) throws `spawn EINVAL` on recent
      // Node (CVE-2024-27980 hardening), so PM2 could never launch the app.
      // Pointing PM2 at the Next binary's JS entrypoint with the node
      // interpreter avoids the .cmd spawn entirely.
      script: path.join(__dirname, "node_modules", "next", "dist", "bin", "next"),
      args: "start -p 3081",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        PORT: "3081",
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
