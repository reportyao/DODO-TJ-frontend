# B2B 订单实时同步与消息推送设计方案

## 问题描述
管理后台更新B2B订单状态后，批发商前端页面不会实时同步更新，也不会收到消息通知。

## 技术方案

### 方案选择：Supabase Realtime (Postgres Changes)
- 利用 Supabase 内置的 Realtime 功能监听 `b2b_orders` 表变更
- 无需额外部署 WebSocket 服务器
- 前端通过 supabase-js 的 channel.on('postgres_changes') 订阅

### 实现步骤

#### 1. 数据库层
- 将 `b2b_orders` 和 `notifications` 表加入 `supabase_realtime` publication
- 创建触发器：当 b2b_orders 的 fulfillment_status/payment_status 变更时，
  自动向 notifications 表插入通知记录

#### 2. 前端实时订阅 (B2BOrdersPage)
- 使用 Supabase Realtime 订阅 `b2b_orders` 表的 UPDATE 事件
- 过滤条件：`user_id = 当前用户ID`
- 收到变更时自动刷新订单列表 + 显示 toast 提示

#### 3. 消息推送
- 触发器自动写入 notifications 表
- 通知类型：B2B_ORDER_CONFIRMED, B2B_ORDER_SHIPPING, B2B_ORDER_DELIVERED, 
  B2B_ORDER_CANCELLED, B2B_PAYMENT_CONFIRMED
- 支持 i18n (title_i18n, message_i18n)

### 状态变更 → 通知映射

| 管理员操作 | fulfillment_status 变化 | 通知类型 | 批发商看到的消息 |
|-----------|------------------------|---------|---------------|
| 确认订单 | pending → confirmed | B2B_ORDER_CONFIRMED | 您的订单已确认，正在备货 |
| 开始配送 | → shipping | B2B_ORDER_SHIPPING | 您的订单已发货，正在配送中 |
| 确认送达 | → delivered | B2B_ORDER_DELIVERED | 您的订单已送达 |
| 取消订单 | → cancelled | B2B_ORDER_CANCELLED | 您的订单已取消 |
| 确认收款 | payment_status 变化 | B2B_PAYMENT_CONFIRMED | 收款已确认 |
