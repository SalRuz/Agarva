/**
 * PM2 process file for the WebSocket game server.
 * Usage on VPS:  pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'agarwa-server',
      cwd: __dirname,
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'server/index.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
