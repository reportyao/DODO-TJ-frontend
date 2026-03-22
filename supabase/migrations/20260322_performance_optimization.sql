-- ============================================================
-- 性能优化迁移 - 补充关键缺失索引
-- 日期: 2026-03-22
-- 风险等级: 低（仅添加索引，不修改数据和逻辑）
-- 
-- 所有索引使用 CREATE INDEX CONCURRENTLY 避免锁表
-- 使用 IF NOT EXISTS 确保幂等性
-- ============================================================

-- ============================================================
-- 1. users 表 - 三级邀请关系查询优化
-- 场景: handle-purchase-commission / referral-reward 遍历三级推荐链
-- 每次佣金计算需要递归查询 referred_by_id 最多3次
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_referred_by_id 
ON public.users (referred_by_id) 
WHERE referred_by_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_referrer_id 
ON public.users (referrer_id) 
WHERE referrer_id IS NOT NULL;

-- 注意: users 表没有 whatsapp_phone 列，WhatsApp 登录使用 phone_number 字段
-- phone_number 已有索引 idx_users_phone_number，无需额外添加

-- ============================================================
-- 2. wallet_transactions 表 - 钱包流水查询优化
-- 场景: 用户查看钱包交易记录（分页查询，按时间倒序）
-- 原有索引: wallet_id(单列), type(单列), created_at(单列)
-- 缺少: 复合索引用于高效分页
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_transactions_wallet_created 
ON public.wallet_transactions (wallet_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_transactions_status 
ON public.wallet_transactions (status) 
WHERE status != 'COMPLETED';

-- ============================================================
-- 3. commissions 表 - 佣金查询优化
-- 场景: 管理后台查看佣金记录、用户查看自己的佣金
-- 原有索引: user_id(单列), from_user_id(单列), status(单列)
-- 缺少: 复合索引用于防重复检查
-- ============================================================
-- 注意: commissions 表使用 order_type 而非 transaction_type
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_dedup 
ON public.commissions (from_user_id, user_id, order_type, level);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_user_created 
ON public.commissions (user_id, created_at DESC);

-- ============================================================
-- 4. prizes 表 - 奖品查询优化
-- 场景: 抽奖开奖后查询某期所有奖品
-- 原有索引: user_id+id, batch_id, pickup_code 等
-- 缺少: lottery_id 索引
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prizes_lottery_id 
ON public.prizes (lottery_id);

-- ============================================================
-- 5. shipping_requests 表 - 发货查询优化
-- 场景: 管理后台查看某个奖品的发货状态
-- 原有索引: user_id, status
-- 缺少: prize_id 索引
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipping_requests_prize_id 
ON public.shipping_requests (prize_id) 
WHERE prize_id IS NOT NULL;

-- ============================================================
-- 6. user_sessions 表 - 会话验证优化
-- 场景: 每个API请求都需要验证 session_token + is_active
-- 原有索引: session_token(单列), user_id(单列)
-- 优化: 复合索引覆盖常见查询模式
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_active 
ON public.user_sessions (session_token, is_active) 
WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user_active 
ON public.user_sessions (user_id, is_active) 
WHERE is_active = true;

-- ============================================================
-- 7. lotteries 表 - 商品关联查询优化
-- 场景: 查看某个商品的所有抽奖期次
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lotteries_product_id 
ON public.lotteries (product_id) 
WHERE product_id IS NOT NULL;

-- ============================================================
-- 8. notification_queue 表 - 通知发送队列优化
-- 场景: 定时任务扫描待发送通知
-- 原有索引: status, priority, user_id, phone_number
-- 优化: 复合索引用于队列扫描
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_queue_pending 
ON public.notification_queue (status, scheduled_at) 
WHERE status = 'pending';

-- ============================================================
-- 9. exchange_records 表 - 兑换记录查询优化
-- 场景: 查看某个钱包的兑换历史
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exchange_records_created_at 
ON public.exchange_records (created_at DESC);

-- ============================================================
-- 10. 过期数据清理优化索引
-- 场景: 定期清理过期会话、过期通知
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_expires 
ON public.user_sessions (expires_at) 
WHERE is_active = true;

-- ============================================================
-- 完成提示
-- ============================================================
-- 注意: CONCURRENTLY 索引创建不会锁表，但需要更长时间
-- 如果某个索引创建失败（如表不存在某列），不影响其他索引
-- 可以通过 \di 命令验证索引是否创建成功
