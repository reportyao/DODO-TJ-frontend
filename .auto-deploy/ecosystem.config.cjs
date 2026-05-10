module.exports = {
  apps: [
    {
      name: 'dodo-webhook',
      script: '/root/auto-deploy/webhook-server.js',
      cwd: '/root/auto-deploy',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        WEBHOOK_SECRET: 'dodo-tj-auto-deploy-2026',
      },
      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/auto-deploy/pm2-webhook-error.log',
      out_file: '/var/log/auto-deploy/pm2-webhook-out.log',
      merge_logs: true,
      // 重启策略
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
    },
  ],
};
