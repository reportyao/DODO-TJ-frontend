#!/usr/bin/env node
/**
 * DODO-TJ GitHub Webhook 自动部署服务
 *
 * 功能：监听 GitHub Webhook 推送事件，自动触发对应项目的部署脚本
 * 端口：9800
 *
 * 支持的仓库：
 *   - DODO-TJ-frontend → 触发前端部署
 *   - DODO-TJ-admin    → 触发管理后台部署
 *
 * 安全机制：
 *   - Webhook Secret 签名验证
 *   - 仅响应 main 分支的 push 事件
 *   - 部署锁防止并发（由 shell 脚本实现）
 */

const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── 配置 ────────────────────────────────────────────────────────────────
const CONFIG = {
  port: 9800,
  host: '0.0.0.0',
  webhookSecret: process.env.WEBHOOK_SECRET || 'dodo-tj-auto-deploy-2026',
  logDir: '/var/log/auto-deploy',
  deployScripts: {
    'DODO-TJ-frontend': '/root/auto-deploy/deploy_frontend.sh',
    'DODO-TJ-admin':    '/root/auto-deploy/deploy_admin.sh',
  },
  targetBranch: 'refs/heads/main',
  deployTimeout: 600000, // 10 分钟超时
};

// ─── 日志 ────────────────────────────────────────────────────────────────
function ensureLogDir() {
  if (!fs.existsSync(CONFIG.logDir)) {
    fs.mkdirSync(CONFIG.logDir, { recursive: true });
  }
}

function log(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(line);
  try {
    ensureLogDir();
    fs.appendFileSync(path.join(CONFIG.logDir, 'webhook.log'), line + '\n');
  } catch (e) { /* 忽略日志写入错误 */ }
}

// ─── 签名验证 ────────────────────────────────────────────────────────────
function verifySignature(payload, signature) {
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', CONFIG.webhookSecret);
  hmac.update(payload, 'utf8');
  const digest = 'sha256=' + hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

// ─── 部署执行器 ──────────────────────────────────────────────────────────
const deployingRepos = new Set();

// 部署历史（内存中保留最近 20 条）
const deployHistory = [];
function addHistory(entry) {
  deployHistory.unshift(entry);
  if (deployHistory.length > 20) deployHistory.pop();
}

function runDeploy(repoName, commitInfo) {
  const scriptPath = CONFIG.deployScripts[repoName];

  if (!scriptPath) {
    log('WARN', `未知仓库: ${repoName}，跳过部署`);
    return;
  }
  if (!fs.existsSync(scriptPath)) {
    log('ERROR', `部署脚本不存在: ${scriptPath}`);
    return;
  }
  if (deployingRepos.has(repoName)) {
    log('WARN', `${repoName} 正在部署中，跳过本次触发 (commit: ${commitInfo})`);
    addHistory({ repo: repoName, commit: commitInfo, status: 'skipped_concurrent', time: new Date().toISOString() });
    return;
  }

  deployingRepos.add(repoName);
  const startTime = Date.now();
  log('INFO', `开始部署 ${repoName} (提交: ${commitInfo})`);

  const child = execFile('bash', [scriptPath], {
    timeout: CONFIG.deployTimeout,
    env: {
      ...process.env,
      PNPM_HOME: '/root/.local/share/pnpm',
      PATH: '/root/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin',
      NODE_OPTIONS: '--max-old-space-size=4096',
      HOME: '/root',
    },
    maxBuffer: 10 * 1024 * 1024, // 10MB
  }, (error, stdout, stderr) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    deployingRepos.delete(repoName);

    if (error) {
      // ── 部署失败处理 ──────────────────────────────────────────────────
      const isTimeout = error.killed && error.signal === 'SIGTERM';
      const errMsg = isTimeout
        ? `部署超时（超过 ${CONFIG.deployTimeout / 1000}s）`
        : error.message;

      log('ERROR', `${repoName} 部署失败 (耗时 ${duration}s): ${errMsg}`);

      // 从 stdout 中提取关键错误行（脚本里 log_error 输出的内容）
      const errorLines = (stdout || '')
        .split('\n')
        .filter(l => l.includes('[ERROR]') || l.includes('[WARN]'))
        .slice(-10);
      if (errorLines.length > 0) {
        log('ERROR', `--- 部署脚本错误摘要 ---`);
        errorLines.forEach(l => log('ERROR', `  ${l.trim()}`));
      }

      // 读取部署状态文件，获取精确的失败阶段
      const statusKey = repoName === 'DODO-TJ-admin' ? 'deploy_status_admin.json' : 'deploy_status.json';
      try {
        const statusFile = path.join(CONFIG.logDir, statusKey);
        if (fs.existsSync(statusFile)) {
          const statusData = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
          log('ERROR', `失败阶段状态: ${statusData.status} | 原因: ${statusData.reason}`);
        }
      } catch (e) { /* 忽略 */ }

      addHistory({
        repo: repoName,
        commit: commitInfo,
        status: isTimeout ? 'timeout' : 'failed',
        duration: `${duration}s`,
        error: errMsg,
        time: new Date().toISOString(),
      });

    } else {
      // ── 部署成功 ──────────────────────────────────────────────────────
      log('INFO', `${repoName} 部署成功 (耗时 ${duration}s)`);
      addHistory({
        repo: repoName,
        commit: commitInfo,
        status: 'success',
        duration: `${duration}s`,
        time: new Date().toISOString(),
      });
    }

    // 保存完整部署输出到独立日志文件
    try {
      const outputFile = path.join(CONFIG.logDir, `${repoName}_deploy_${Date.now()}.log`);
      fs.writeFileSync(outputFile, `=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr || '(none)'}\n`);
    } catch (e) { /* 忽略 */ }
  });

  child.on('error', (err) => {
    deployingRepos.delete(repoName);
    log('ERROR', `启动部署脚本失败: ${err.message}`);
    addHistory({ repo: repoName, commit: commitInfo, status: 'launch_failed', error: err.message, time: new Date().toISOString() });
  });
}

// ─── HTTP 服务器 ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // 健康检查
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'dodo-tj-auto-deploy',
      uptime: process.uptime(),
      deploying: Array.from(deployingRepos),
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // 部署状态（含历史记录）
  if (req.method === 'GET' && req.url === '/status') {
    // 读取最新的状态文件
    const statusFiles = ['deploy_status.json', 'deploy_status_admin.json'];
    const latestStatus = {};
    statusFiles.forEach(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CONFIG.logDir, f), 'utf8'));
        latestStatus[data.project] = data;
      } catch (e) { /* 忽略 */ }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      deploying: Array.from(deployingRepos),
      latestStatus,
      history: deployHistory,
    }, null, 2));
    return;
  }

  // 手动触发（仅允许本机访问）
  if (req.method === 'POST' && req.url === '/deploy/frontend') {
    const clientIP = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIP)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: local access only' }));
      return;
    }
    log('INFO', '手动触发前端部署');
    runDeploy('DODO-TJ-frontend', 'manual-trigger');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'triggered', project: 'frontend' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/deploy/admin') {
    const clientIP = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIP)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: local access only' }));
      return;
    }
    log('INFO', '手动触发管理后台部署');
    runDeploy('DODO-TJ-admin', 'manual-trigger');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'triggered', project: 'admin' }));
    return;
  }

  // Webhook 端点
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });

  req.on('end', () => {
    // 验证签名
    const signature = req.headers['x-hub-signature-256'];
    if (!verifySignature(body, signature)) {
      log('WARN', `Webhook 签名验证失败 (IP: ${req.socket.remoteAddress})`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      return;
    }

    // 解析 payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      log('WARN', 'Webhook payload 解析失败');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // 检查事件类型
    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      log('INFO', `收到非 push 事件: ${event}，忽略`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ignored', reason: `event type: ${event}` }));
      return;
    }

    // 检查分支
    const ref = payload.ref;
    if (ref !== CONFIG.targetBranch) {
      log('INFO', `收到非 main 分支推送: ${ref}，忽略`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ignored', reason: `branch: ${ref}` }));
      return;
    }

    // 获取仓库和提交信息
    const repoName   = payload.repository?.name;
    const commitSha  = payload.after?.substring(0, 7) || 'unknown';
    const pusher     = payload.pusher?.name || 'unknown';
    const commitMsg  = payload.head_commit?.message?.split('\n')[0]?.substring(0, 80) || '';

    log('INFO', `收到 push 事件: ${repoName} (${commitSha}) by ${pusher}: ${commitMsg}`);

    // 触发部署
    if (CONFIG.deployScripts[repoName]) {
      runDeploy(repoName, `${commitSha} by ${pusher}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'deploying',
        repo: repoName,
        commit: commitSha,
        pusher,
        message: commitMsg,
      }));
    } else {
      log('WARN', `未配置的仓库: ${repoName}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ignored', reason: `unknown repo: ${repoName}` }));
    }
  });
});

server.listen(CONFIG.port, CONFIG.host, () => {
  log('INFO', `Webhook 服务已启动，监听 ${CONFIG.host}:${CONFIG.port}`);
  log('INFO', `Webhook URL: http://0.0.0.0:${CONFIG.port}/webhook`);
  log('INFO', `健康检查: http://0.0.0.0:${CONFIG.port}/health`);
  log('INFO', `部署状态: GET /status`);
  log('INFO', `手动部署: POST /deploy/frontend 或 /deploy/admin（仅本机）`);
  log('INFO', `监听仓库: ${Object.keys(CONFIG.deployScripts).join(', ')}`);
  log('INFO', `目标分支: ${CONFIG.targetBranch}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  log('INFO', '收到 SIGTERM，正在关闭...');
  server.close(() => { log('INFO', '服务已关闭'); process.exit(0); });
});
process.on('SIGINT', () => {
  log('INFO', '收到 SIGINT，正在关闭...');
  server.close(() => { log('INFO', '服务已关闭'); process.exit(0); });
});
process.on('uncaughtException', (err) => {
  log('ERROR', `未捕获的异常: ${err.message}\n${err.stack}`);
});
process.on('unhandledRejection', (reason) => {
  log('ERROR', `未处理的 Promise 拒绝: ${reason}`);
});
