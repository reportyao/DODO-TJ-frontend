import os
#!/usr/bin/env python3
"""
通过 Supabase Management API 执行数据库迁移 SQL。
"""
import json
import sys
import requests
import re

SUPABASE_PROJECT_REF = "qcrcgpwlfouqslokwbzl"
SUPABASE_ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
API_URL = f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_REF}/database/query"

HEADERS = {
    "Authorization": f"Bearer {SUPABASE_ACCESS_TOKEN}",
    "Content-Type": "application/json",
}

def execute_sql(sql: str) -> dict:
    """执行 SQL 语句并返回结果。"""
    payload = {"query": sql}
    resp = requests.post(API_URL, headers=HEADERS, json=payload, timeout=60)
    try:
        result = resp.json()
    except Exception:
        result = {"raw": resp.text}
    return {"status": resp.status_code, "result": result}

def split_sql_statements(sql: str) -> list[str]:
    """
    将 SQL 文件分割成独立的语句。
    对于包含 $$ 块的 PL/pgSQL，需要特殊处理。
    """
    # 使用简单的分割策略：按 $$ 块分割
    # 找到所有 CREATE OR REPLACE FUNCTION 语句的边界
    statements = []
    
    # 策略：整个文件作为一个语句执行（Management API 支持多语句）
    return [sql]

def main():
    migration_file = "/home/ubuntu/DODO-TJ-frontend/supabase/migrations/20260519000001_multi_gift_checkout.sql"
    
    print(f"读取迁移文件: {migration_file}")
    with open(migration_file, "r", encoding="utf-8") as f:
        sql = f.read()
    
    print(f"SQL 文件大小: {len(sql)} 字节")
    print("执行迁移 SQL...")
    
    result = execute_sql(sql)
    print(f"HTTP 状态: {result['status']}")
    print(f"响应: {json.dumps(result['result'], ensure_ascii=False, indent=2)[:2000]}")
    
    if result['status'] in (200, 201):
        print("\n✅ 迁移执行成功！")
        return 0
    else:
        print(f"\n❌ 迁移执行失败！")
        return 1

if __name__ == "__main__":
    sys.exit(main())
