# Admin RPC 白名单管理指引

> **重要提示（给 AI 和开发者）**：每次在 `public` schema 下创建新表后，
> **必须**同步将表名添加到以下三个 Security Definer RPC 函数的白名单中，
> 否则管理后台将无法访问该表（报错 `FORBIDDEN: 不允许访问表 xxx`）。

## 需要更新的三个函数

| 函数名 | 签名 | 用途 |
|---|---|---|
| `admin_query` | `(text, text, text, jsonb, text, boolean, integer, integer, text, boolean)` | SELECT 查询 |
| `admin_count` | `(text, text, jsonb, text)` | COUNT 计数 |
| `admin_mutate` | `(text, text, text, jsonb, jsonb, text, text)` | INSERT / UPDATE / DELETE |

## 操作步骤

### 方法一：增量补丁（推荐，适合迁移文件）

在创建新表的迁移文件末尾，追加以下 SQL 模板（替换 `your_new_table` 为实际表名）：

```sql
-- ============================================================
-- 将新表加入 admin RPC 白名单
-- ⚠️ 必须同时更新 admin_query / admin_count / admin_mutate 三个函数
-- ============================================================

-- 1. admin_query
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)'::regprocedure
  );
  IF position('your_new_table' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''your_new_table'''
    );
    EXECUTE v_def;
  END IF;
END; $$;

-- 2. admin_count
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_count(text,text,jsonb,text)'::regprocedure
  );
  IF position('your_new_table' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''your_new_table'''
    );
    EXECUTE v_def;
  END IF;
END; $$;

-- 3. admin_mutate
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_mutate(text,text,text,jsonb,jsonb,text,text)'::regprocedure
  );
  IF position('your_new_table' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''your_new_table'''
    );
    EXECUTE v_def;
  END IF;
END; $$;
```

**原理说明**：
- `pg_get_functiondef()` 获取函数的完整 `CREATE OR REPLACE FUNCTION` 定义
- `replace()` 在白名单数组的最后一个元素后面追加新表名
- `position() = 0` 确保幂等性（已存在则跳过）
- `EXECUTE v_def` 重新创建函数（相当于 `CREATE OR REPLACE`）
- 替换锚点使用白名单中**最后一个表名**（当前为 `ai_understanding_jobs`）

### 方法二：直接修改函数（适合手动操作）

通过 Supabase SQL Editor 或 Management API 直接修改函数体中的 `v_allowed_tables` 数组。

## 当前白名单（截至 2026-04-23）

```
users, admin_users, lotteries, lottery_entries, lottery_results,
orders, full_purchase_orders, prizes, deposit_requests, withdrawal_requests,
wallet_transactions, wallets, commissions, commission_settings,
banners, showoffs, showoff_likes, showoff_comments,
resales, draw_algorithms, draw_logs, payment_config,
system_config, admin_audit_logs, edge_function_logs, error_logs,
notification_queue, notifications, role_permissions,
shipment_batches, batch_order_items, shipping, shipping_history,
pickup_points, pickup_logs, pickup_staff_profiles,
promoter_profiles, promoter_teams, promoter_daily_logs,
promotion_points, managed_invite_codes, promoter_deposits,
group_buy_products, group_buy_sessions, group_buy_orders, group_buy_results,
inventory_products, inventory_transactions,
ai_chat_history, user_sessions, market_listings,
admin_sessions,
homepage_categories, homepage_tags,
product_categories, product_tags,
homepage_topics, topic_products, topic_placements,
user_behavior_events, ai_topic_generation_tasks,
ai_listing_generation_tasks,
localization_lexicon,
ai_image_tasks,          ← 2026-04-23 新增
ai_understanding_jobs    ← 2026-04-23 新增（当前最后一个，新增表应追加在此之后）
```

## 历史教训

| 日期 | 问题 | 根因 |
|---|---|---|
| 2026-04-19 | AI 上架助手任务恢复失败 | `ai_listing_generation_tasks` 未加白名单 |
| 2026-04-23 | AI 商品理解报错 + 海报状态查询失败 | `ai_image_tasks` 和 `ai_understanding_jobs` 未加白名单 |

## Checklist（创建新表时必须检查）

- [ ] 表已创建（CREATE TABLE）
- [ ] RLS 已启用（ALTER TABLE ... ENABLE ROW LEVEL SECURITY）
- [ ] RLS 策略已创建（CREATE POLICY）
- [ ] **admin_query 白名单已更新**
- [ ] **admin_count 白名单已更新**
- [ ] **admin_mutate 白名单已更新**
- [ ] 如需 Realtime：已加入 `supabase_realtime` publication
- [ ] 如需定时任务：已创建 pg_cron job
