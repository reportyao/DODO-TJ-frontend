# Telegram Bot Token 配置指南

## ⚠️ 重要: 必须配置此项才能发送Telegram通知

---

## 配置步骤

### 方法1: 通过Supabase Dashboard (推荐)

1. **登录Supabase Dashboard**
   - 访问: https://supabase.com/dashboard
   - 登录您的账号

2. **选择项目**
   - 项目ID: `qcrcgpwlfouqslokwbzl`
   - 项目名称: luckymart-tj

3. **进入Edge Functions设置**
   - 点击左侧菜单 `Edge Functions`
   - 点击右上角 `Settings` 或 `Manage secrets`

4. **添加环境变量**
   - 点击 `Add new secret`
   - Name: `TELEGRAM_BOT_TOKEN`
   - Value: `8074258399:AAG1WdyCJe4vphx9YB3B6z60nTE3dhBBP-Q`
   - 点击 `Save`

5. **重新部署函数(可选)**
   - 环境变量会自动应用到所有Edge Functions
   - 如果通知不工作,可以尝试重新部署 `telegram-notification-sender`

---

### 方法2: 通过Supabase CLI

如果您安装了Supabase CLI,可以使用命令行配置:

```bash
# 登录Supabase CLI
supabase login

# 链接到项目
supabase link --project-ref qcrcgpwlfouqslokwbzl

# 设置环境变量
supabase secrets set TELEGRAM_BOT_TOKEN=8074258399:AAG1WdyCJe4vphx9YB3B6z60nTE3dhBBP-Q

# 验证设置
supabase secrets list
```

---

## 验证配置

### 1. 检查环境变量是否生效

在Supabase Dashboard的Edge Functions页面,点击任意函数,查看 `Secrets` 标签,应该能看到 `TELEGRAM_BOT_TOKEN`。

### 2. 测试通知发送

```bash
# 调用send-telegram-notification测试
curl -X POST "https://qcrcgpwlfouqslokwbzl.supabase.co/functions/v1/send-telegram-notification" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "your-user-uuid",
    "type": "group_buy_win",
    "data": {
      "product_name": "测试商品",
      "product_image": "https://example.com/image.jpg",
      "session_id": "test-session-123",
      "win_time": "2025-12-28T07:00:00Z"
    }
  }'
```

### 3. 检查通知队列

```sql
-- 在Supabase SQL Editor中执行
SELECT * FROM notification_queue 
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

如果看到 `status = 'sent'`,说明通知发送成功!

---

## 常见问题

### Q1: 配置后通知还是不发送?

**解决方案**:
1. 检查 `notification_queue` 表的 `status` 字段
2. 如果是 `failed`,查看 `error_message` 字段
3. 检查 `telegram-bot-cron` 是否正常运行
4. 尝试重新部署 `telegram-notification-sender`

### Q2: 如何查看通知发送日志?

**解决方案**:
1. 进入Supabase Dashboard
2. Edge Functions → `telegram-notification-sender`
3. 点击 `Logs` 标签
4. 查看最近的执行日志

### Q3: Bot Token是否正确?

**验证方法**:
```bash
# 测试Bot Token是否有效
curl "https://api.telegram.org/bot8074258399:AAG1WdyCJe4vphx9YB3B6z60nTE3dhBBP-Q/getMe"
```

应该返回Bot的信息,如:
```json
{
  "ok": true,
  "result": {
    "id": 8074258399,
    "is_bot": true,
    "first_name": "LuckyMart Bot",
    ...
  }
}
```

---

## 配置完成后

✅ 拼团中奖/未中奖通知将自动发送
✅ 充值/提现通知将自动发送
✅ 积分商城中奖通知将自动发送(集成后)

---

## 技术支持

如有问题,请检查:
1. Supabase Edge Function日志
2. `notification_queue` 表的状态
3. Telegram Bot API响应

**Bot Token**: `8074258399:AAG1WdyCJe4vphx9YB3B6z60nTE3dhBBP-Q`
**项目ID**: `qcrcgpwlfouqslokwbzl`
**Supabase URL**: `https://qcrcgpwlfouqslokwbzl.supabase.co`
