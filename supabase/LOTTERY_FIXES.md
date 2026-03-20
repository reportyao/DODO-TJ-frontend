# 积分商城流程修复说明

## 修复日期
2025-11-26

## 修复内容总结

### 1. Session Token 验证修复
**问题**: Edge Functions 使用 Supabase Auth JWT token，但前端传递的是自定义 session token

**修复的 Edge Functions**:
- `lottery-purchase` (v5)
- 其他需要用户验证的 Edge Functions

**修复方式**:
```typescript
// 查询 user_sessions 表验证自定义 session token
const { data: session, error: sessionError } = await supabaseClient
  .from('user_sessions')
  .select('*')
  .eq('token', token)
  .single();

// 检查 session 是否过期
if (new Date(session.expires_at) < new Date()) {
  throw new Error('Session expired');
}
```

---

### 2. 数据库表名和字段映射修复
**问题**: `auto-lottery-draw` 使用不存在的 `tickets` 表

**修复**:
- 使用 `lottery_entries` 表替代 `tickets`
- 使用 `numbers` 字段作为中奖号码
- 创建 `lottery_results` 记录
- 更新 `is_winning` 字段

---

### 3. 180 秒倒计时机制实现
**实现方式**:

#### 后端逻辑
1. **lottery-purchase**: 售罄后设置 `draw_time = 当前时间 + 180秒`
2. **check-lottery-sold-out**: 更新状态为 `SOLD_OUT`，设置开奖时间
3. **scheduled-lottery-draw**: 定时检查并开奖（pg_cron 每分钟执行）
4. **auto-lottery-draw**: 执行开奖逻辑

#### 前端组件
- `CountdownTimer.tsx`: 显示倒计时，根据剩余时间改变颜色
- `LotteryDetailPage.tsx`: 集成倒计时组件

---

### 4. 移除活动结束时间倒计时
**修改**:
- 数据库: `end_time` 和 `draw_time` 改为可空
- 前端: 移除活动结束倒计时显示
- 只保留售罄后的 180 秒开奖倒计时

---

## 数据库迁移

### 迁移脚本
1. `20251126_wallet_functions.sql` - 钱包功能 RPC 函数
   - `exchange_real_to_bonus_balance` - 余额兑换为积分
   - `approve_withdrawal_request` - 提现审批通过
   - `reject_withdrawal_request` - 提现审批拒绝

2. `20251126_remove_lottery_time_constraints.sql` - 移除时间约束
   - `end_time` 改为可空
   - `draw_time` 改为可空
   - `period` 改为可空

3. `20251126_setup_lottery_cron.sql` - 配置定时任务
   - 创建 pg_cron 定时任务
   - 每分钟调用 `scheduled-lottery-draw`

### 应用迁移
```bash
# 使用 Supabase CLI
supabase db push

# 或使用 MCP
manus-mcp-cli tool call apply_migration --server supabase \
  --input '{"project_id": "qcrcgpwlfouqslokwbzl", "name": "migration_name", "query": "..."}'
```

---

## Edge Functions

### 修复的 Edge Functions
| Function | Version | 文件路径 | 说明 |
|----------|---------|---------|------|
| lottery-purchase | 5 | `functions/lottery-purchase/index.ts` | Session token 验证、售罄检测 |
| auto-lottery-draw | 4 | `functions/auto-lottery-draw/index.ts` | 表名修复、VRF 算法 |
| check-lottery-sold-out | 4 | `functions/check-lottery-sold-out/index.ts` | 180秒倒计时设置 |
| scheduled-lottery-draw | 1 | `functions/scheduled-lottery-draw/index.ts` | 定时开奖检查（新创建） |

### 部署 Edge Functions
```bash
# 使用 Supabase CLI
supabase functions deploy lottery-purchase
supabase functions deploy auto-lottery-draw
supabase functions deploy check-lottery-sold-out
supabase functions deploy scheduled-lottery-draw

# 或使用 MCP
manus-mcp-cli tool call deploy_edge_function --server supabase \
  --input '{"project_id": "qcrcgpwlfouqslokwbzl", "name": "function-name", "files": [...]}'
```

---

## 定时任务配置

### pg_cron 配置
定时任务已通过 `20251126_setup_lottery_cron.sql` 配置：

```sql
SELECT cron.schedule(
  'lottery-draw-check',
  '* * * * *',  -- 每分钟执行一次
  $$
  SELECT net.http_post(
    url := 'https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/scheduled-lottery-draw',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

### 查看定时任务状态
```sql
SELECT * FROM cron.job WHERE jobname = 'lottery-draw-check';
```

### 查看定时任务执行历史
```sql
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'lottery-draw-check')
ORDER BY start_time DESC 
LIMIT 10;
```

---

## 完整流程

### 用户购买流程
1. 用户进入积分商城详情页
2. 选择购买数量
3. 点击"立即参与"
4. `lottery-purchase` 验证 session、扣款、创建记录
5. 如果售罄，调用 `check-lottery-sold-out`

### 售罄后流程
6. `check-lottery-sold-out` 设置状态为 `SOLD_OUT`，设置 `draw_time = 当前时间 + 180秒`
7. 前端显示 180 秒倒计时（CountdownTimer 组件）

### 自动开奖流程
8. pg_cron 每分钟调用 `scheduled-lottery-draw`
9. `scheduled-lottery-draw` 检查是否有到达开奖时间的活动
10. 调用 `auto-lottery-draw` 执行开奖
11. 使用 VRF 算法生成中奖号码
12. 创建 `lottery_results` 和 `prizes` 记录
13. 发送中奖通知

### 中奖查看流程
14. 用户进入"我的奖品"页面
15. 查看中奖记录和奖品信息

---

## 测试建议

### 前端测试
- [ ] 积分商城列表页显示正常
- [ ] 积分商城详情页显示正常
- [ ] 购买功能正常（扣款、创建记录）
- [ ] 售罄后显示 180 秒倒计时
- [ ] 倒计时颜色变化正常（蓝色 → 黄色 → 红色）
- [ ] 倒计时结束后自动刷新
- [ ] 开奖后显示中奖信息

### 后端测试
- [ ] Session token 验证正常
- [ ] 购买后余额正确扣除
- [ ] 售罄检测正常
- [ ] 180秒倒计时设置正确
- [ ] 定时任务正常触发开奖
- [ ] VRF 算法生成中奖号码
- [ ] 中奖记录创建正常
- [ ] 通知发送正常

---

## 注意事项

1. **Session Token**: 所有需要用户验证的 Edge Functions 都应使用自定义 session token 验证
2. **定时任务**: pg_cron 定时任务已配置，无需手动触发
3. **开奖时间**: 售罄后 180 秒自动开奖，不可手动修改
4. **VRF 算法**: 使用可验证随机函数确保开奖公平性

---

## 相关文件

### 前端
- `src/pages/LotteryDetailPage.tsx` - 积分商城详情页
- `src/components/CountdownTimer.tsx` - 倒计时组件

### 后端
- `supabase/functions/lottery-purchase/` - 购买功能
- `supabase/functions/auto-lottery-draw/` - 开奖功能
- `supabase/functions/check-lottery-sold-out/` - 售罄检测
- `supabase/functions/scheduled-lottery-draw/` - 定时开奖检查

### 数据库
- `supabase/migrations/20251126_wallet_functions.sql`
- `supabase/migrations/20251126_remove_lottery_time_constraints.sql`
- `supabase/migrations/20251126_setup_lottery_cron.sql`

---

## 联系方式
如有问题，请联系开发团队。
