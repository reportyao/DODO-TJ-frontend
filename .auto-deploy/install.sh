#!/bin/bash
##############################################################################
# DODO-TJ 自动部署系统 - 一键安装脚本
# 
# 功能：
#   1. 部署 Webhook 监听服务到服务器
#   2. 配置 PM2 管理 Webhook 服务
#   3. 配置 Nginx 反向代理 Webhook 端点
#   4. 输出 GitHub Webhook 配置指引
#
# 使用方法：在本地运行此脚本
##############################################################################

set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────────────────
PROD_SERVER_IP="47.82.73.79"
PROD_SERVER_USER="root"
PROD_SERVER_PASS="Lingjiu123@"
PROD_DOMAIN="tezbarakat.com"
WEBHOOK_PORT=9800
WEBHOOK_SECRET="dodo-tj-auto-deploy-2026"
REMOTE_DEPLOY_DIR="/root/auto-deploy"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── 颜色 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()    { echo -e "${CYAN}[STEP]${NC} $1"; }

# ─── SSH 命令封装 ────────────────────────────────────────────────────────
remote_exec() {
    sshpass -p "$PROD_SERVER_PASS" ssh -o StrictHostKeyChecking=no \
        "$PROD_SERVER_USER@$PROD_SERVER_IP" "$@"
}

remote_copy() {
    sshpass -p "$PROD_SERVER_PASS" scp -o StrictHostKeyChecking=no "$@"
}

# ─── 主流程 ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo "=========================================="
    echo "  DODO-TJ 自动部署系统 - 安装程序"
    echo "=========================================="
    echo ""

    # 检查 sshpass
    if ! command -v sshpass &> /dev/null; then
        log_error "sshpass 未安装，请先安装: sudo apt-get install sshpass"
        exit 1
    fi

    # [1/6] 测试服务器连接
    log_step "[1/6] 测试服务器连接..."
    if remote_exec "echo 'connected'" &>/dev/null; then
        log_success "服务器连接成功"
    else
        log_error "无法连接到服务器 $PROD_SERVER_IP"
        exit 1
    fi

    # [2/6] 上传部署文件
    log_step "[2/6] 上传部署文件到服务器..."
    remote_exec "mkdir -p $REMOTE_DEPLOY_DIR /var/log/auto-deploy"
    
    remote_copy "$SCRIPT_DIR/webhook-server.js" "$PROD_SERVER_USER@$PROD_SERVER_IP:$REMOTE_DEPLOY_DIR/"
    remote_copy "$SCRIPT_DIR/deploy_frontend.sh" "$PROD_SERVER_USER@$PROD_SERVER_IP:$REMOTE_DEPLOY_DIR/"
    remote_copy "$SCRIPT_DIR/deploy_admin.sh" "$PROD_SERVER_USER@$PROD_SERVER_IP:$REMOTE_DEPLOY_DIR/"
    remote_copy "$SCRIPT_DIR/ecosystem.config.cjs" "$PROD_SERVER_USER@$PROD_SERVER_IP:$REMOTE_DEPLOY_DIR/"
    
    remote_exec "chmod +x $REMOTE_DEPLOY_DIR/deploy_frontend.sh $REMOTE_DEPLOY_DIR/deploy_admin.sh"
    log_success "文件已上传"

    # [3/6] 配置 Nginx 反向代理
    log_step "[3/6] 配置 Nginx Webhook 反向代理..."
    remote_exec "
        # 检查是否已配置 webhook location
        if grep -q 'webhook' /etc/nginx/sites-enabled/tezbarakat.com 2>/dev/null; then
            echo 'Webhook location 已存在于 Nginx 配置中'
        else
            echo 'Webhook location 不存在，需要手动添加'
        fi
    "
    
    # 创建 webhook 的 Nginx 配置片段
    remote_exec "cat > /etc/nginx/snippets/webhook.conf << 'NGINXEOF'
# ─── GitHub Webhook 自动部署端点 ─────────────────────────────────────
location /webhook {
    proxy_pass http://127.0.0.1:${WEBHOOK_PORT}/webhook;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
    
    # 限制请求体大小
    client_max_body_size 1m;
}

location /deploy/ {
    proxy_pass http://127.0.0.1:${WEBHOOK_PORT}/deploy/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    
    # 仅允许本机访问手动触发端点
    allow 127.0.0.1;
    allow ${PROD_SERVER_IP};
    deny all;
}

location = /webhook-health {
    proxy_pass http://127.0.0.1:${WEBHOOK_PORT}/health;
    proxy_http_version 1.1;
}
NGINXEOF
    "
    log_success "Nginx 配置片段已创建"

    # 检查并注入 webhook 配置到主站点配置
    remote_exec "
        NGINX_CONF='/etc/nginx/sites-enabled/tezbarakat.com'
        if [ ! -f \"\$NGINX_CONF\" ]; then
            NGINX_CONF='/etc/nginx/sites-available/tezbarakat.com'
        fi
        
        if grep -q 'webhook' \"\$NGINX_CONF\" 2>/dev/null; then
            echo 'Webhook 配置已存在，跳过注入'
        else
            # 在 '# Deny hidden files' 之前插入 include
            sed -i '/# Deny hidden files/i\\    # Auto-deploy webhook\\n    include snippets/webhook.conf;\\n' \"\$NGINX_CONF\"
            echo 'Webhook 配置已注入到 Nginx'
        fi
        
        # 测试 Nginx 配置
        nginx -t 2>&1
    "
    log_success "Nginx 配置已更新"

    # [4/6] 启动 Webhook 服务
    log_step "[4/6] 启动 Webhook 服务..."
    remote_exec "
        cd $REMOTE_DEPLOY_DIR
        
        # 停止旧的 webhook 服务（如果存在）
        pm2 delete dodo-webhook 2>/dev/null || true
        
        # 启动新服务
        pm2 start ecosystem.config.cjs
        
        # 保存 PM2 配置
        pm2 save
        
        # 等待服务启动
        sleep 2
        
        # 检查服务状态
        pm2 status dodo-webhook
    "
    log_success "Webhook 服务已启动"

    # [5/6] 重载 Nginx
    log_step "[5/6] 重载 Nginx..."
    remote_exec "
        nginx -t && systemctl reload nginx
    "
    log_success "Nginx 已重载"

    # [6/6] 验证安装
    log_step "[6/6] 验证安装..."
    
    # 检查 webhook 服务健康状态
    HEALTH_CHECK=$(remote_exec "curl -s http://127.0.0.1:${WEBHOOK_PORT}/health" 2>/dev/null)
    if echo "$HEALTH_CHECK" | grep -q '"status":"ok"'; then
        log_success "Webhook 服务运行正常"
    else
        log_warn "Webhook 服务可能未正常启动，请检查日志"
    fi

    echo ""
    echo "=========================================="
    echo -e "${GREEN}  安装完成！${NC}"
    echo "=========================================="
    echo ""
    echo "接下来需要在 GitHub 上配置 Webhook："
    echo ""
    echo -e "${CYAN}=== DODO-TJ-frontend 仓库 ===${NC}"
    echo "  1. 打开: https://github.com/reportyao/DODO-TJ-frontend/settings/hooks/new"
    echo "  2. Payload URL: https://${PROD_DOMAIN}/webhook"
    echo "  3. Content type: application/json"
    echo "  4. Secret: ${WEBHOOK_SECRET}"
    echo "  5. 事件: Just the push event"
    echo "  6. Active: 勾选"
    echo ""
    echo -e "${CYAN}=== DODO-TJ-admin 仓库 ===${NC}"
    echo "  1. 打开: https://github.com/reportyao/DODO-TJ-admin/settings/hooks/new"
    echo "  2. Payload URL: https://${PROD_DOMAIN}/webhook"
    echo "  3. Content type: application/json"
    echo "  4. Secret: ${WEBHOOK_SECRET}"
    echo "  5. 事件: Just the push event"
    echo "  6. Active: 勾选"
    echo ""
    echo -e "${YELLOW}手动触发部署（测试用）：${NC}"
    echo "  前端: curl -X POST http://127.0.0.1:${WEBHOOK_PORT}/deploy/frontend"
    echo "  后台: curl -X POST http://127.0.0.1:${WEBHOOK_PORT}/deploy/admin"
    echo ""
    echo -e "${YELLOW}查看部署日志：${NC}"
    echo "  Webhook 日志: tail -f /var/log/auto-deploy/webhook.log"
    echo "  前端部署日志: ls -lt /var/log/auto-deploy/frontend_*"
    echo "  后台部署日志: ls -lt /var/log/auto-deploy/admin_*"
    echo "  PM2 日志:     pm2 logs dodo-webhook"
    echo ""
    echo -e "${YELLOW}服务管理：${NC}"
    echo "  查看状态: pm2 status dodo-webhook"
    echo "  重启服务: pm2 restart dodo-webhook"
    echo "  停止服务: pm2 stop dodo-webhook"
    echo ""
}

main "$@"
