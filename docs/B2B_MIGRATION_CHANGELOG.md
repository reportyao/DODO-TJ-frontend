# B2B 重构 - Phase 1 & Phase 2 变更日志

> **日期**: 2026-05-06  
> **版本**: B2B Migration v1.0  
> **作者**: AI Dev Agent  
> **目标**: 将 DODO-TJ 从 ToC（一元夺宝）模式转型为 ToB（塔吉克斯坦本地 B2B 批发平台）

---

## 一、变更概述

本次变更完成了 B2B 转型的 **Phase 1（数据库层）** 和 **Phase 2（后端逻辑层）**，为后续的前端重构和 Admin 后台适配奠定了基础。

### 核心变更

| 类别 | 文件 | 变更内容 |
|------|------|---------|
| DDL 迁移 | `supabase/migrations/20260506000001_b2b_core_tables.sql` | 新增 B2B 核心表 + 修改 inventory_products |
| RPC 函数 | `supabase/migrations/20260506000002_b2b_home_feed_rpc.sql` | 新增 3 个 RPC 函数 |
| 类型定义 | `database.types.ts` | 新增 4 个表类型 + 修改 inventory_products 类型 + 新增 RPC 类型 |
| Edge Function | `supabase/functions/b2b-checkout/index.ts` | B2B 结算（购物车一键下单） |
| Edge Function | `supabase/functions/b2b-cart/index.ts` | B2B 购物车管理（增删改查） |
| Edge Function | `supabase/functions/b2b-orders/index.ts` | B2B 订单查询 + 管理后台操作 |

---

## 二、数据库变更详情

### 2.1 修改现有表: `inventory_products`

新增字段:

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cost_price` | NUMERIC(12,2) | 0 | 成本价（仅管理后台可见） |
| `wholesale_price` | NUMERIC(12,2) | 0 | 批发价（批发商可见） |
| `retail_price` | NUMERIC(12,2) | 0 | 零售价（即原 original_price 的语义映射） |
| `min_order_quantity` | INTEGER | 1 | 最小起订量 |
| `unit_measure` | VARCHAR(20) | '件' | 计量单位 |

> **注意**: `original_price` 字段保留不删除，保持向后兼容。`retail_price` 的初始值通过迁移脚本从 `original_price` 复制。

### 2.2 新建表

#### `wholesaler_profiles` - 批发商认证表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| user_id | UUID FK → users | 关联用户（一对一） |
| company_name | VARCHAR(200) | 公司/店铺名称 |
| contact_phone | VARCHAR(30) | 联系电话 |
| tax_id | VARCHAR(50) | 税务编号 |
| business_address | TEXT | 营业地址 |
| delivery_address | TEXT | 配送地址 |
| status | VARCHAR(20) | pending / approved / rejected / suspended |
| reject_reason | TEXT | 拒绝原因 |
| approved_at | TIMESTAMPTZ | 审批时间 |
| approved_by | UUID | 审批人 |
| notes | TEXT | 备注 |

#### `shopping_carts` - 购物车表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| user_id | UUID FK → users | 用户 |
| product_id | UUID FK → inventory_products | 商品 |
| quantity | INTEGER | 数量 |
| UNIQUE | (user_id, product_id) | 同一用户同一商品只有一条记录 |

#### `b2b_orders` - B2B 主订单表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| order_number | VARCHAR(30) UNIQUE | 订单号（格式: B2B + 时间戳 + 随机） |
| user_id | UUID FK → users | 下单用户 |
| total_amount | NUMERIC(12,2) | 订单总金额 |
| item_count | INTEGER | 商品种类数 |
| total_quantity | INTEGER | 商品总件数 |
| status | VARCHAR(20) | 订单状态 |
| payment_method | VARCHAR(20) | 支付方式（默认 cod） |
| payment_status | VARCHAR(20) | 支付状态 |
| estimated_delivery_date | DATE | 预计送达日期 |
| delivery_address | TEXT | 配送地址 |
| delivery_note | TEXT | 配送备注 |
| admin_note | TEXT | 管理员备注 |
| confirmed_at | TIMESTAMPTZ | 确认收款时间 |
| confirmed_by | UUID | 确认人 |

#### `b2b_order_items` - B2B 订单明细表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| order_id | UUID FK → b2b_orders | 所属订单 |
| product_id | UUID FK → inventory_products | 商品 |
| quantity | INTEGER | 购买数量 |
| unit_price | NUMERIC(12,2) | 下单时的单价 |
| subtotal | NUMERIC(12,2) | 小计 |
| snapshot_data | JSONB | 商品快照（防止改价影响历史） |

### 2.3 订单状态流转

```
pending → processing → delivering → delivered → paid (完成)
                                              ↘ cancelled
```

- **pending**: 刚下单，等待仓库处理
- **processing**: 仓库备货中
- **delivering**: 已出库，配送中（此时设置 estimated_delivery_date）
- **delivered**: 已送达，等待收款
- **paid**: 已确认收款，订单完成
- **cancelled**: 已取消

---

## 三、RPC 函数说明

### 3.1 `rpc_get_b2b_home_feed(p_lang, p_limit, p_category_id)`

**用途**: B2B 首页 Feed 流，直接从 `inventory_products` 获取商品数据

**参数**:
- `p_lang` (text, 默认 'zh'): 语言偏好
- `p_limit` (int, 默认 100): 返回商品数量上限
- `p_category_id` (uuid, 可选): 分类过滤

**返回结构**:
```json
{
  "banners": [...],
  "categories": [...],
  "products": [
    {
      "type": "product",
      "item_id": "uuid",
      "data": {
        "product_id": "uuid",
        "name_i18n": {"zh": "...", "ru": "...", "tg": "..."},
        "image_url": "...",
        "wholesale_price": 100,
        "retail_price": 150,
        "currency": "TJS",
        "stock": 500,
        "min_order_quantity": 10,
        "unit_measure": "件"
      }
    }
  ],
  "total_count": 42
}
```

### 3.2 `rpc_get_b2b_product_detail(p_product_id)`

**用途**: 获取单个商品详情 + 门店列表（前端计算距离）

### 3.3 `rpc_b2b_search_products(p_query, p_limit)`

**用途**: 多语言商品搜索（支持中文、俄语、塔吉克语）

---

## 四、Edge Functions 说明

### 4.1 `b2b-cart` - 购物车管理

| Action | 说明 | 必需参数 |
|--------|------|---------|
| `get` | 获取购物车列表 | 无 |
| `add` | 添加商品 | product_id, quantity |
| `update` | 更新数量 | product_id, quantity |
| `remove` | 移除商品 | product_id |
| `clear` | 清空购物车 | 无 |

**权限**: 仅已认证的批发商（wholesaler_profiles.status = 'approved'）

### 4.2 `b2b-checkout` - 结算下单

**请求体**:
```json
{
  "delivery_address": "杜尚别市xxx路xxx号",
  "delivery_note": "请在工作日送达"
}
```

**业务流程**: 验证身份 → 读取购物车 → 校验库存 → 创建订单 → 扣减库存 → 清空购物车 → 通知

### 4.3 `b2b-orders` - 订单管理

**批发商操作**:
| Action | 说明 |
|--------|------|
| `list` | 我的订单列表 |
| `detail` | 订单详情 |

**管理后台操作**:
| Action | 说明 |
|--------|------|
| `admin_list` | 所有订单列表 |
| `admin_confirm_payment` | 确认收款 |
| `admin_set_delivery` | 设置预计送达时间 |
| `admin_update_status` | 更新订单状态 |

---

## 五、部署步骤

### 5.1 数据库迁移

在 Supabase Dashboard 的 SQL Editor 中，按顺序执行:

1. `20260506000001_b2b_core_tables.sql` - 创建表和修改字段
2. `20260506000002_b2b_home_feed_rpc.sql` - 创建 RPC 函数

> **重要**: 执行前请先在测试环境验证，确保不影响现有数据。

### 5.2 Edge Functions 部署

```bash
# 部署 B2B 购物车
supabase functions deploy b2b-cart --project-ref <your-project-ref>

# 部署 B2B 结算
supabase functions deploy b2b-checkout --project-ref <your-project-ref>

# 部署 B2B 订单管理
supabase functions deploy b2b-orders --project-ref <your-project-ref>
```

### 5.3 验证清单

- [ ] `inventory_products` 表新增字段已生效
- [ ] `wholesaler_profiles` 表已创建
- [ ] `shopping_carts` 表已创建
- [ ] `b2b_orders` 表已创建
- [ ] `b2b_order_items` 表已创建
- [ ] `rpc_get_b2b_home_feed` 可正常调用
- [ ] `rpc_get_b2b_product_detail` 可正常调用
- [ ] `rpc_b2b_search_products` 可正常调用
- [ ] `b2b-cart` Edge Function 可正常响应
- [ ] `b2b-checkout` Edge Function 可正常响应
- [ ] `b2b-orders` Edge Function 可正常响应

---

## 六、后续开发计划（Phase 3-5）

| Phase | 内容 | 依赖 |
|-------|------|------|
| Phase 3 | Admin 后台适配（商品表单新字段、批发商审核页、B2B 订单管理页） | Phase 1-2 |
| Phase 4 | 前端重构（B2BHomePage、B2BProductDetailPage、CartPage、SearchPage） | Phase 1-2 |
| Phase 5 | 前端交易链路（B2BCheckoutPage、B2BOrderListPage、权限控制） | Phase 3-4 |

---

## 七、注意事项

1. **向后兼容**: 所有旧表和 Edge Functions 保持不动，不删除不修改。B2B 功能通过新增表和新增 Edge Functions 实现。
2. **旧版 rpc_get_home_feed**: 保留不动，未来如果需要同时运行 ToC 和 ToB 模式可以并存。
3. **cost_price 安全**: 成本价仅存储在数据库中，所有面向前端的 RPC 和 Edge Functions 都不返回此字段。
4. **EventType.NEW_ORDER**: 如果 `_shared/eventQueue.ts` 中没有定义此事件类型，需要在部署前添加，或使用字符串 `'new_order'` 替代。
