#!/bin/bash
##############################################################################
# DODO-TJ Admin 自动部署脚本
# 仓库: DODO-TJ-admin → https://tezbarakat.com/admin/
# 部署目录: /var/www/tezbarakat.com/admin/
# 触发: GitHub Webhook (main 分支 push)
##############################################################################

set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────────────────
PROJECT_DIR="/root/DODO-TJ-admin"
DEPLOY_DIR="/var/www/tezbarakat.com/admin"
BACKUP_DIR="/var/www/tezbarakat.com/admin_backups"
LOG_DIR="/var/log/auto-deploy"
LOCK_FILE="/tmp/deploy_admin.lock"
BRANCH="main"
MAX_BACKUPS=5

# 环境变量
export PNPM_HOME="/root/.local/share/pnpm"
export PATH="$PNPM_HOME:/usr/local/bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=4096"

# ─── 颜色 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── 日志 ────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/admin_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

log_info()    { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${RED}[ERROR]${NC} $1"; }

# ─── 状态追踪 ────────────────────────────────────────────────────────────
STAGE_GIT_PULLED=false
STAGE_BUILD_DONE=false
STAGE_DEPLOYED=false
DEPLOY_START_TIME=$(date +%s)
NEW_COMMIT="unknown"
OLD_COMMIT="unknown"

# ─── 锁机制 ──────────────────────────────────────────────────────────────
acquire_lock() {
    if [ -f "$LOCK_FILE" ]; then
        LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
            log_error "另一个管理后台部署进程正在运行 (PID: $LOCK_PID)，跳过本次部署"
            exit 1
        else
            log_warn "发现过期的锁文件，清理中..."
            rm -f "$LOCK_FILE"
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

release_lock() {
    rm -f "$LOCK_FILE"
}

# ─── 错误通知 ────────────────────────────────────────────────────────────
write_deploy_status() {
    local status="$1"
    local reason="${2:-}"
    local status_file="$LOG_DIR/deploy_status_admin.json"

    cat > "$status_file" << EOF
{
  "project": "admin",
  "status": "$status",
  "commit": "$NEW_COMMIT",
  "previous_commit": "$OLD_COMMIT",
  "reason": "$reason",
  "log_file": "$LOG_FILE",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "duration_seconds": $(($(date +%s) - DEPLOY_START_TIME))
}
EOF
    log_info "部署状态已写入: $status_file"
}

# ─── 回滚函数 ────────────────────────────────────────────────────────────
do_rollback() {
    local reason="$1"
    log_warn "=========================================="
    log_warn "开始回滚管理后台到上一个版本..."
    log_warn "失败原因: $reason"
    log_warn "=========================================="

    local latest_backup
    latest_backup=$(ls -dt "$BACKUP_DIR"/admin_backup_* 2>/dev/null | head -1 || echo "")

    if [ -z "$latest_backup" ] || [ ! -d "$latest_backup" ]; then
        log_error "没有可用的备份，无法回滚！请手动检查 $DEPLOY_DIR"
        write_deploy_status "failed_no_backup" "$reason"
        return 1
    fi

    log_warn "回滚到备份: $latest_backup"
    mkdir -p "$DEPLOY_DIR"
    find "$DEPLOY_DIR" -maxdepth 1 -mindepth 1 -exec rm -rf {} + 2>/dev/null || true
    cp -r "$latest_backup/"* "$DEPLOY_DIR/" 2>/dev/null || true
    chown -R www-data:www-data "$DEPLOY_DIR"
    chmod -R 755 "$DEPLOY_DIR"

    if [ -f "$DEPLOY_DIR/index.html" ]; then
        log_warn "回滚成功！管理后台已恢复到上一个版本"
        log_warn "回滚来源: $latest_backup"
        write_deploy_status "rolled_back" "$reason"
    else
        log_error "回滚后 index.html 不存在，管理后台可能无法访问！"
        write_deploy_status "rollback_failed" "$reason"
    fi
}

# ─── 清理函数（EXIT trap）────────────────────────────────────────────────
cleanup() {
    local exit_code=$?

    if [ $exit_code -ne 0 ]; then
        local duration=$(($(date +%s) - DEPLOY_START_TIME))
        log_error "=========================================="
        log_error "管理后台部署失败！退出码: $exit_code，耗时: ${duration}s"
        log_error "日志文件: $LOG_FILE"
        log_error "=========================================="

        if [ "$STAGE_BUILD_DONE" = "false" ]; then
            # 构建阶段失败：线上版本未被破坏，无需回滚
            log_warn "构建阶段失败，线上版本未受影响，无需回滚"
            log_warn "请检查构建错误日志: $LOG_FILE"
            write_deploy_status "build_failed" "构建失败，退出码: $exit_code"

        elif [ "$STAGE_DEPLOYED" = "false" ]; then
            # 部署阶段失败：可能已清空线上目录，需要回滚
            log_error "部署阶段失败，线上文件可能不完整，执行回滚..."
            do_rollback "部署阶段失败，退出码: $exit_code"

        else
            # 部署后验证失败
            log_error "部署验证失败，执行回滚..."
            do_rollback "部署后验证失败，退出码: $exit_code"
        fi
    fi

    release_lock
}
trap cleanup EXIT

# ─── 主流程 ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo "=========================================="
    echo "  DODO-TJ Admin 自动部署"
    echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "=========================================="
    echo ""

    acquire_lock

    # [1/9] 检查项目目录
    log_info "[1/9] 检查项目目录..."
    if [ ! -d "$PROJECT_DIR" ]; then
        log_error "项目目录不存在: $PROJECT_DIR"
        exit 1
    fi
    cd "$PROJECT_DIR"
    log_success "项目目录: $PROJECT_DIR"

    # [2/9] 拉取最新代码
    log_info "[2/9] 拉取最新代码 (分支: $BRANCH)..."
    OLD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

    if ! git fetch origin 2>&1; then
        log_error "git fetch 失败，请检查网络或 GitHub 访问权限"
        exit 1
    fi

    if ! git reset --hard "origin/$BRANCH" 2>&1; then
        log_error "git reset 失败"
        exit 1
    fi

    NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    STAGE_GIT_PULLED=true

    if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
        log_warn "代码无变化 ($OLD_COMMIT)，继续执行部署"
    else
        log_success "代码已更新: $OLD_COMMIT → $NEW_COMMIT"
        git log --oneline -3 2>/dev/null | while read line; do log_info "  $line"; done
    fi

    # [3/9] 配置生产环境变量
    log_info "[3/9] 配置生产环境变量..."
    cat > .env.production << 'EOF'
VITE_SUPABASE_URL=https://qcrcgpwlfouqslokwbzl.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjcmNncHdsZm91cXNsb2t3YnpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MzMzMzcsImV4cCI6MjA4OTUwOTMzN30.KFR8C1O0BnGWvR6GSCCq8opP2EljMwwOQrtn8snXqM0
EOF
    log_success "环境变量已配置"

    # [4/9] 安装依赖
    log_info "[4/9] 安装依赖..."
    if ! pnpm install --frozen-lockfile 2>&1; then
        log_error "依赖安装失败！可能原因：pnpm-lock.yaml 与 package.json 不一致"
        log_error "提示：请在本地运行 pnpm install 并提交更新后的 pnpm-lock.yaml"
        exit 1
    fi
    log_success "依赖安装完成"

    # [5/9] 构建项目
    log_info "[5/9] 构建管理后台（生产模式）..."
    log_info "构建命令: pnpm run build"
    log_info "Node 内存限制: 4096MB"

    # 清除旧的构建产物
    rm -rf node_modules/.vite-temp dist 2>/dev/null || true

    # 执行构建，完整捕获输出
    BUILD_OUTPUT_FILE="$LOG_DIR/admin_build_output_$(date +%Y%m%d_%H%M%S).log"
    if ! pnpm run build 2>&1 | tee "$BUILD_OUTPUT_FILE"; then
        log_error "=========================================="
        log_error "构建失败！以下是错误摘要："
        log_error "=========================================="
        grep -E "error|Error|ERROR|✗|failed|Failed" "$BUILD_OUTPUT_FILE" 2>/dev/null | tail -20 | while read line; do
            log_error "  $line"
        done
        log_error "完整构建日志: $BUILD_OUTPUT_FILE"
        log_error "线上版本未受影响，无需回滚"
        exit 1
    fi

    # 验证构建产物完整性
    if [ ! -d "dist" ]; then
        log_error "构建失败：dist 目录不存在"
        exit 1
    fi
    if [ ! -f "dist/index.html" ]; then
        log_error "构建失败：dist/index.html 不存在"
        exit 1
    fi

    JS_COUNT=$(find dist/assets -name "*.js" 2>/dev/null | wc -l)
    if [ "$JS_COUNT" -eq 0 ]; then
        log_error "构建失败：dist/assets/ 中没有 JS 文件"
        exit 1
    fi

    DIST_SIZE=$(du -sh dist 2>/dev/null | cut -f1)
    log_success "构建成功！产物大小: $DIST_SIZE，JS 文件数: $JS_COUNT"
    STAGE_BUILD_DONE=true

    # [6/9] 安全检查（防止 service_role 密钥泄露到前端）
    log_info "[6/9] 安全检查（确保无 service_role 密钥泄露）..."
    if grep -r "service_role" dist/ 2>/dev/null | grep -v "\.map$" | head -1; then
        log_error "安全检查失败：构建产物中发现 service_role 密钥！"
        log_error "这是高危安全问题，拒绝部署！"
        log_error "请检查代码中是否误将 service_role 密钥暴露给前端"
        # 构建产物有安全问题，不部署，也不需要回滚（线上版本未被破坏）
        STAGE_BUILD_DONE=false  # 阻止 cleanup 中的回滚逻辑
        exit 1
    fi
    log_success "安全检查通过 - 未发现 service_role 密钥"

    # [7/9] 备份当前部署
    log_info "[7/9] 备份当前部署..."
    mkdir -p "$BACKUP_DIR"
    if [ -d "$DEPLOY_DIR" ] && [ "$(ls -A $DEPLOY_DIR 2>/dev/null)" ]; then
        BACKUP_NAME="admin_backup_$(date +%Y%m%d_%H%M%S)"
        cp -r "$DEPLOY_DIR" "$BACKUP_DIR/$BACKUP_NAME"
        rm -f "$BACKUP_DIR/latest"
        ln -sf "$BACKUP_DIR/$BACKUP_NAME" "$BACKUP_DIR/latest"
        log_success "已备份到: $BACKUP_DIR/$BACKUP_NAME"
        # 只保留最近 N 个备份
        cd "$BACKUP_DIR"
        ls -dt admin_backup_* 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -rf
        cd "$PROJECT_DIR"
    else
        log_warn "部署目录为空，跳过备份"
    fi

    # [8/9] 部署新构建
    log_info "[8/9] 部署新构建到 $DEPLOY_DIR..."
    mkdir -p "$DEPLOY_DIR"
    find "$DEPLOY_DIR" -maxdepth 1 -mindepth 1 -exec rm -rf {} +
    cp -r dist/* "$DEPLOY_DIR/"
    chown -R www-data:www-data "$DEPLOY_DIR"
    chmod -R 755 "$DEPLOY_DIR"
    STAGE_DEPLOYED=true
    log_success "文件已部署"

    # [9/9] 验证部署
    log_info "[9/9] 验证部署..."

    if [ ! -f "$DEPLOY_DIR/index.html" ]; then
        log_error "验证失败：$DEPLOY_DIR/index.html 不存在"
        exit 1
    fi

    DEPLOYED_JS=$(find "$DEPLOY_DIR/assets" -name "*.js" 2>/dev/null | wc -l)
    if [ "$DEPLOYED_JS" -eq 0 ]; then
        log_error "验证失败：部署目录中没有 JS 文件"
        exit 1
    fi

    # 再次安全验证（确保部署目录中也没有 service_role）
    if grep -r "service_role" "$DEPLOY_DIR/" 2>/dev/null | grep -v "\.map$" | head -1; then
        log_error "部署后安全验证失败：发现 service_role 密钥，执行回滚！"
        exit 1
    fi
    log_success "安全验证通过 - 未包含 service_role 密钥"

    log_success "index.html 存在"
    log_success "JS 文件数: $DEPLOYED_JS"

    # 检查 Supabase URL 是否正确配置
    if grep -r "VITE_SUPABASE_URL\|supabase\.co" "$DEPLOY_DIR/assets/"*.js 2>/dev/null | head -1 | grep -q "qcrcgpwlfouqslokwbzl"; then
        log_success "Supabase URL 正确"
    else
        log_warn "Supabase URL 未在 JS 中找到（可能使用了内联配置）"
    fi

    # 写入成功状态
    write_deploy_status "success"

    # 输出部署摘要
    echo ""
    echo "=========================================="
    log_success "管理后台部署完成！"
    echo "=========================================="
    echo "  提交版本: $NEW_COMMIT (上一版本: $OLD_COMMIT)"
    echo "  部署时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  耗时: $(($(date +%s) - DEPLOY_START_TIME))s"
    echo "  部署目录: $DEPLOY_DIR"
    echo "  访问地址: https://tezbarakat.com/admin/"
    echo "  日志文件: $LOG_FILE"
    echo "=========================================="
    echo ""
}

main "$@"
