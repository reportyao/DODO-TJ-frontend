#!/usr/bin/env python3
import subprocess
import json

project_id = "qcrcgpwlfouqslokwbzl"

# 分步执行SQL语句
sqls = [
    # 1. 更新lotteries表
    "ALTER TABLE lotteries ADD COLUMN IF NOT EXISTS winning_ticket_number INTEGER",
    "ALTER TABLE lotteries ADD COLUMN IF NOT EXISTS winning_user_id UUID",
    "ALTER TABLE lotteries ADD COLUMN IF NOT EXISTS vrf_proof TEXT",
    "ALTER TABLE lotteries ADD COLUMN IF NOT EXISTS vrf_timestamp BIGINT",
    "ALTER TABLE lotteries ADD COLUMN IF NOT EXISTS draw_time TIMESTAMP WITH TIME ZONE",
    
    # 2. 创建prizes表
    """CREATE TABLE IF NOT EXISTS prizes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lottery_id UUID NOT NULL,
        user_id UUID NOT NULL,
        ticket_id UUID,
        winning_code VARCHAR(50) NOT NULL,
        prize_name VARCHAR(255) NOT NULL,
        prize_image TEXT,
        prize_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        won_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )""",
    
    # 3. 创建prizes索引
    "CREATE INDEX IF NOT EXISTS idx_prizes_user_id ON prizes(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_prizes_lottery_id ON prizes(lottery_id)",
    "CREATE INDEX IF NOT EXISTS idx_prizes_status ON prizes(status)",
    "CREATE INDEX IF NOT EXISTS idx_prizes_won_at ON prizes(won_at DESC)",
    
    # 4. 创建shipping表
    """CREATE TABLE IF NOT EXISTS shipping (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        prize_id UUID NOT NULL,
        user_id UUID NOT NULL,
        recipient_name VARCHAR(100) NOT NULL,
        recipient_phone VARCHAR(20) NOT NULL,
        recipient_address TEXT NOT NULL,
        recipient_city VARCHAR(100),
        recipient_region VARCHAR(100),
        recipient_postal_code VARCHAR(20),
        recipient_country VARCHAR(50) DEFAULT 'Tajikistan',
        shipping_method VARCHAR(50),
        tracking_number VARCHAR(100),
        shipping_company VARCHAR(100),
        shipping_cost DECIMAL(10, 2) DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        shipped_at TIMESTAMP WITH TIME ZONE,
        delivered_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        admin_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )""",
    
    # 5. 创建shipping索引
    "CREATE INDEX IF NOT EXISTS idx_shipping_prize_id ON shipping(prize_id)",
    "CREATE INDEX IF NOT EXISTS idx_shipping_user_id ON shipping(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_shipping_status ON shipping(status)",
    "CREATE INDEX IF NOT EXISTS idx_shipping_requested_at ON shipping(requested_at DESC)",
]

print("开始执行数据库迁移...")
print(f"总共 {len(sqls)} 条SQL语句\n")

success_count = 0
failed_count = 0

for i, sql in enumerate(sqls, 1):
    print(f"[{i}/{len(sqls)}] 执行: {sql[:60]}...")
    
    input_json = json.dumps({
        "project_id": project_id,
        "query": sql
    })
    
    try:
        result = subprocess.run(
            ["manus-mcp-cli", "tool", "call", "execute_sql", "--server", "supabase", "--input", input_json],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0:
            print(f"✅ 成功\n")
            success_count += 1
        else:
            print(f"❌ 失败: {result.stderr}\n")
            failed_count += 1
    except Exception as e:
        print(f"❌ 异常: {e}\n")
        failed_count += 1

print("\n" + "="*50)
print(f"迁移完成!")
print(f"成功: {success_count}/{len(sqls)}")
print(f"失败: {failed_count}/{len(sqls)}")
print("="*50)
