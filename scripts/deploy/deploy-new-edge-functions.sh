#!/bin/bash

PROJECT_ID="qcrcgpwlfouqslokwbzl"

echo "部署新的Edge Functions..."

# 1. 部署auto-lottery-draw
echo "1. 部署 auto-lottery-draw..."
cd /home/ubuntu/project/luckymart-tj
manus-mcp-cli tool call deploy_edge_function --server supabase --input "{
  \"project_id\": \"$PROJECT_ID\",
  \"name\": \"auto-lottery-draw\",
  \"files\": [{
    \"path\": \"index.ts\",
    \"content\": $(cat supabase/functions/auto-lottery-draw/index.ts | jq -Rs .)
  }]
}"

echo ""

# 2. 部署check-lottery-sold-out
echo "2. 部署 check-lottery-sold-out..."
manus-mcp-cli tool call deploy_edge_function --server supabase --input "{
  \"project_id\": \"$PROJECT_ID\",
  \"name\": \"check-lottery-sold-out\",
  \"files\": [{
    \"path\": \"index.ts\",
    \"content\": $(cat supabase/functions/check-lottery-sold-out/index.ts | jq -Rs .)
  }]
}"

echo ""
echo "部署完成!"
