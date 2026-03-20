#!/bin/bash

# LuckyMart-TJ 测试服务器部署脚本
# 通过GitHub拉取最新代码并部署

set -e  # 遇到错误立即退出

echo "=========================================="
echo "LuckyMart-TJ 测试服务器部署"
echo "开始时间: $(date)"
echo "=========================================="

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目路径
FRONTEND_PATH="/root/projects/luckymart-tj-frontend"
ADMIN_PATH="/root/projects/luckymart-tj-admin"

# 测试环境Supabase配置
SUPABASE_URL="https://qcrcgpwlfouqslokwbzl.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjcmNncHdsZm91cXNsb2t3YnpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MzMzMzcsImV4cCI6MjA4OTUwOTMzN30.KFR8C1O0BnGWvR6GSCCq8opP2EljMwwOQrtn8snXqM0"

echo ""
echo -e "${YELLOW}步骤 1/5: 更新前端代码${NC}"
echo "----------------------------------------"
cd "$FRONTEND_PATH"
echo "当前目录: $(pwd)"

# 保存本地修改（如果有）
if [[ -n $(git status -s) ]]; then
    echo "保存本地修改..."
    git stash
fi

# 拉取最新代码
echo "拉取最新代码..."
git fetch origin
git reset --hard origin/main
git pull origin main

# 创建/更新环境配置文件
echo "配置环境变量..."
cat > .env.production << EOF
EXPO_PUBLIC_SUPABASE_URL=$SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EXPO_PUBLIC_TELEGRAM_BOT_USERNAME=LuckyMart_TJ_Bot
EXPO_PUBLIC_API_URL=https://test.tezbarakat.com/api
EOF

echo -e "${GREEN}✓ 前端代码更新完成${NC}"

echo ""
echo -e "${YELLOW}步骤 2/5: 更新后端管理代码${NC}"
echo "----------------------------------------"
cd "$ADMIN_PATH"
echo "当前目录: $(pwd)"

# 保存本地修改（如果有）
if [[ -n $(git status -s) ]]; then
    echo "保存本地修改..."
    git stash
fi

# 拉取最新代码
echo "拉取最新代码..."
git fetch origin
git reset --hard origin/main
git pull origin main

# 创建/更新环境配置文件
echo "配置环境变量..."
cat > .env.production << EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EOF

echo -e "${GREEN}✓ 后端管理代码更新完成${NC}"

echo ""
echo -e "${YELLOW}步骤 3/5: 安装前端依赖并构建${NC}"
echo "----------------------------------------"
cd "$FRONTEND_PATH"

# 检查是否需要安装依赖
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "安装依赖..."
    pnpm install --prod
else
    echo "依赖已是最新，跳过安装"
fi

# 构建前端
echo "构建前端应用..."
if [ -f "package.json" ]; then
    # 检查是否有build脚本
    if grep -q '"build"' package.json; then
        pnpm run build
        echo -e "${GREEN}✓ 前端构建完成${NC}"
    else
        echo -e "${YELLOW}⚠ 未找到build脚本，跳过构建${NC}"
    fi
fi

echo ""
echo -e "${YELLOW}步骤 4/5: 安装后端依赖并构建${NC}"
echo "----------------------------------------"
cd "$ADMIN_PATH"

# 检查是否需要安装依赖
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "安装依赖..."
    pnpm install --prod
else
    echo "依赖已是最新，跳过安装"
fi

# 构建后端
echo "构建后端管理应用..."
if [ -f "package.json" ]; then
    if grep -q '"build"' package.json; then
        pnpm run build
        echo -e "${GREEN}✓ 后端构建完成${NC}"
    else
        echo -e "${YELLOW}⚠ 未找到build脚本，跳过构建${NC}"
    fi
fi

echo ""
echo -e "${YELLOW}步骤 5/5: 重启服务${NC}"
echo "----------------------------------------"

# 检查PM2是否安装
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}✗ PM2 未安装，请先安装 PM2: npm install -g pm2${NC}"
    exit 1
fi

# 重启前端服务
echo "重启前端服务..."
cd "$FRONTEND_PATH"
if pm2 list | grep -q "luckymart-frontend"; then
    pm2 restart luckymart-frontend
    echo -e "${GREEN}✓ 前端服务已重启${NC}"
else
    echo -e "${YELLOW}⚠ 前端服务未在PM2中运行，尝试启动...${NC}"
    pm2 start npm --name "luckymart-frontend" -- start
fi

# 重启后端服务
echo "重启后端管理服务..."
cd "$ADMIN_PATH"
if pm2 list | grep -q "luckymart-admin"; then
    pm2 restart luckymart-admin
    echo -e "${GREEN}✓ 后端管理服务已重启${NC}"
else
    echo -e "${YELLOW}⚠ 后端管理服务未在PM2中运行，尝试启动...${NC}"
    pm2 start npm --name "luckymart-admin" -- start
fi

# 保存PM2配置
pm2 save

echo ""
echo "=========================================="
echo -e "${GREEN}✓ 部署完成！${NC}"
echo "=========================================="
echo "部署信息:"
echo "  - 前端路径: $FRONTEND_PATH"
echo "  - 后端路径: $ADMIN_PATH"
echo "  - Supabase URL: $SUPABASE_URL"
echo ""
echo "访问地址:"
echo "  - 前端: https://test.tezbarakat.com"
echo "  - 后端管理: https://test.tezbarakat.com/admin"
echo ""
echo "PM2 服务状态:"
pm2 list
echo ""
echo "完成时间: $(date)"
echo "=========================================="
