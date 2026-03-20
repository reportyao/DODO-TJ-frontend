#!/bin/bash

# 批量部署Edge Functions脚本

PROJECT_ID="qcrcgpwlfouqslokwbzl"
FUNCTIONS_DIR="/home/ubuntu/project/luckymart-tj/supabase/functions"

# 要部署的函数列表
FUNCTIONS=(
  "withdraw-request"
  "exchange-currency"
  "get-payment-config"
  "approve-deposit"
  "approve-withdrawal"
)

echo "开始部署Edge Functions..."

for FUNC_NAME in "${FUNCTIONS[@]}"; do
  echo "========================================"
  echo "部署函数: $FUNC_NAME"
  echo "========================================"
  
  FUNC_DIR="$FUNCTIONS_DIR/$FUNC_NAME"
  
  if [ ! -f "$FUNC_DIR/index.ts" ]; then
    echo "错误: 未找到 $FUNC_DIR/index.ts"
    continue
  fi
  
  # 准备函数内容
  CONTENT=$(cat "$FUNC_DIR/index.ts" | jq -Rs .)
  
  # 部署函数
  manus-mcp-cli tool call deploy_edge_function --server supabase --input "{\"project_id\": \"$PROJECT_ID\", \"name\": \"$FUNC_NAME\", \"files\": [{\"name\": \"index.ts\", \"content\": $CONTENT}]}" 2>&1 | head -20
  
  if [ $? -eq 0 ]; then
    echo "✅ $FUNC_NAME 部署成功"
  else
    echo "❌ $FUNC_NAME 部署失败"
  fi
  
  echo ""
  sleep 2
done

echo "========================================"
echo "所有函数部署完成!"
echo "========================================"
