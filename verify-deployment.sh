#!/bin/bash

# 部署验证脚本
# 用于验证部署是否成功，并监控是否有自动回滚

set -e

echo "========================================="
echo "部署验证脚本"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 服务器信息
PROD_SERVER_IP="47.82.73.79"
PROD_SERVER_USER="root"
PROD_DOMAIN="tezbarakat.com"

echo "1. 检查服务器上的文件..."
SERVER_BUILD_TIME=$(ssh ${PROD_SERVER_USER}@${PROD_SERVER_IP} "grep 'Build:' /var/www/${PROD_DOMAIN}/html/index.html | sed 's/.*Build: //' | sed 's/ -->//'")
SERVER_JS_FILE=$(ssh ${PROD_SERVER_USER}@${PROD_SERVER_IP} "ls /var/www/${PROD_DOMAIN}/html/assets/js/index-*.js | xargs basename")

echo -e "${GREEN}✓${NC} 服务器构建时间: ${SERVER_BUILD_TIME}"
echo -e "${GREEN}✓${NC} 服务器 JS 文件: ${SERVER_JS_FILE}"
echo ""

echo "2. 检查外部访问..."
EXTERNAL_BUILD_TIME=$(curl -s https://${PROD_DOMAIN}/ | grep 'Build:' | sed 's/.*Build: //' | sed 's/ -->//')
EXTERNAL_JS_FILE=$(curl -s https://${PROD_DOMAIN}/ | grep 'index-.*\.js' | sed 's/.*src="\/assets\/js\///' | sed 's/?.*//')

echo -e "${GREEN}✓${NC} 外部构建时间: ${EXTERNAL_BUILD_TIME}"
echo -e "${GREEN}✓${NC} 外部 JS 文件: ${EXTERNAL_JS_FILE}"
echo ""

echo "3. 对比结果..."
if [ "$SERVER_BUILD_TIME" == "$EXTERNAL_BUILD_TIME" ] && [ "$SERVER_JS_FILE" == "$EXTERNAL_JS_FILE" ]; then
    echo -e "${GREEN}✓ 部署验证成功！服务器和外部访问一致。${NC}"
else
    echo -e "${RED}✗ 部署验证失败！服务器和外部访问不一致。${NC}"
    echo -e "${YELLOW}可能的原因：${NC}"
    echo "  - CDN 缓存未清除"
    echo "  - Nginx 缓存未清除"
    echo "  - 浏览器缓存问题"
    exit 1
fi

echo ""
echo "4. 检查 Git 仓库状态..."
GIT_COMMIT=$(ssh ${PROD_SERVER_USER}@${PROD_SERVER_IP} "cd /root/DODO-TJ-frontend && git log --oneline -1")
echo -e "${GREEN}✓${NC} 当前提交: ${GIT_COMMIT}"

echo ""
echo "========================================="
echo "验证完成！"
echo "========================================="
