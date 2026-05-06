# DODO B2B 批发模块开发者指南

本文档由 **Manus AI** 生成，旨在帮助后续接手的 AI 开发者或人类工程师快速理解 DODO 项目的 B2B 批发模块架构、代码结构及业务逻辑。

## 1. 架构概述

B2B 批发模块是 DODO 平台的重要扩展，允许审核通过的“批发商”用户以批发价批量采购商品。架构上分为以下几个部分：

- **数据库层 (Supabase PostgreSQL)**：新增 B2B 核心表（购物车、订单等），扩充商品表（新增批发价、起批量等字段）。
- **RPC 函数 (Supabase RPC)**：使用 SQL 函数处理复杂的查询逻辑（如首页 Feed 流、商品详情聚合），利用 PostgreSQL 的性能优势。
- **Edge Functions (Deno)**：处理需要安全校验和外部交互的写操作（如购物车管理、结算下单）。
- **Admin 后台 (React + Vite)**：提供商品 B2B 字段管理、批发商资质审核、B2B 订单发货与收款功能。
- **Frontend 前端 (React + Vite + PWA)**：为批发商提供专属的“进货”入口、独立的 B2B 首页、商品详情页、购物车和订单管理。

## 2. 数据库设计 (Phase 1)

### 2.1 核心表结构

- `wholesaler_profiles`: 批发商档案表，包含公司信息、税务信息、联系方式和审核状态（`pending`, `approved`, `rejected`）。
- `shopping_carts`: B2B 专属购物车表，记录 `user_id`, `product_id`, `quantity`。
- `b2b_orders`: B2B 订单主表，包含订单号、总金额、状态（`PENDING`, `PAID`, `DELIVERING`, `COMPLETED`, `CANCELLED`）及收货信息。
- `b2b_order_items`: B2B 订单明细表，记录购买时的商品快照（单价、数量）。

### 2.2 现有表扩充

`inventory_products` 表新增了以下 B2B 专属字段：
- `cost_price`: 成本价
- `wholesale_price`: 批发价
- `retail_price`: 建议零售价
- `min_order_quantity`: 起批量（默认 1）
- `unit_measure`: 计量单位（默认 '件'）

### 2.3 RLS 策略与安全性

所有新增表均启用了 RLS（Row Level Security）：
- `wholesaler_profiles`: 用户可读写自己的档案，Admin 可读写所有。
- `shopping_carts`: 用户仅可读写自己的购物车记录。
- `b2b_orders` / `b2b_order_items`: 用户仅可读自己的订单，Admin 可读写所有。

> **注意**：Admin 查询使用 `service_role` key，不受 RLS 限制。前端必须使用 `anon` key 配合 JWT。

## 3. 后端逻辑层 (Phase 2)

### 3.1 RPC 函数

为了优化前端加载性能，我们将复杂的读取操作封装为 RPC 函数：
- `rpc_get_b2b_home_feed`: 获取 B2B 首页商品列表，支持分页和分类过滤。仅返回有库存且设置了批发价的商品。
- `rpc_get_b2b_product_detail`: 获取单个商品的完整详情，包含多语言描述、规格和库存状态。
- `rpc_b2b_search_products`: B2B 专属商品搜索，匹配多语言名称和 SKU。

### 3.2 Edge Functions

所有的写操作和核心交易逻辑通过 Supabase Edge Functions 处理，确保安全性：
- `b2b-cart`: 购物车管理（list, upsert, remove, clear）。处理了起批量（MOQ）和库存上限的校验。
- `b2b-checkout`: 结算下单核心逻辑。使用事务（Transaction）确保扣减库存、清空购物车和生成订单的原子性。
- `b2b-orders`: 订单查询与状态更新（主要供前端用户取消订单或确认收货）。

## 4. Admin 后台实现 (Phase 3)

Admin 后台代码位于 `DODO-TJ-admin` 仓库。

### 4.1 侧边栏与路由 (`App.tsx`)
- 隐藏了废弃的模块（如地推指挥室、核销等）。
- 新增了 **B2B 批发管理** 区块。

### 4.2 核心页面
- **`InventoryProductManagementPage.tsx`**: 商品表单被扩展，在原有的价格输入区域附近增加了 B2B 定价字段的输入框。
- **`WholesalerManagementPage.tsx`** (新建): 用于审核批发商资质。列表展示 `wholesaler_profiles` 数据，支持审批通过或拒绝。
- **`B2BOrderManagementPage.tsx`** (新建): 极简订单管理。支持设置预计送达时间（状态变 `DELIVERING`）和一键确认收款（状态变 `COMPLETED`，支付状态变 `PAID`）。

## 5. Frontend 前端实现 (Phase 4)

前端代码位于 `DODO-TJ-frontend` 仓库。

### 5.1 路由与入口隔离
- 所有的 B2B 页面路径均以 `/b2b` 开头（如 `/b2b`, `/b2b/cart`）。
- **`Layout.tsx`**: 当路由以 `/b2b` 开头时，隐藏默认的 Header，并渲染专属的 `B2BBottomNavigation`。
- **`BottomNavigation.tsx`**: 通过 `useWholesalerProfile` hook 检查当前用户是否为审核通过的批发商。如果是，将底部的“种树”入口替换为“进货”（跳转至 `/b2b`）。

### 5.2 数据获取 (`useB2B.ts`)
所有的 B2B 数据请求被集中封装在 `src/hooks/useB2B.ts` 中，使用 `React Query` 进行状态管理和缓存。
> **维护注意**：由于 Supabase 的 TypeScript 类型文件（`database.types.ts`）需要通过 CLI 从数据库重新生成，目前在 `useB2B.ts` 中使用了 `(supabase as any)` 断言来绕过类型检查。后续执行 `supabase gen types` 更新类型文件后，可以移除这些断言。

### 5.3 核心页面组件
- **`B2BHomePage.tsx`**: 进货大厅。包含搜索框、分类筛选和商品网格。使用 `react-intersection-observer` 实现无限滚动加载。
- **`B2BProductDetailPage.tsx`**: 商品详情页。展示多语言详情，提供数量选择器（自动遵循起批量和库存限制），支持加入购物车。
- **`B2BCartPage.tsx`**: 购物车页面。支持修改数量、删除商品，并提供一键结算功能（调用 `b2b-checkout`）。
- **`B2BOrdersPage.tsx`**: 订单列表页。支持按状态筛选，展示订单明细和总价。

## 6. 国际化 (i18n)

B2B 模块的所有文案均已支持中 (`zh`)、俄 (`ru`)、塔 (`tg`) 三语。新增的翻译键值位于 `locales/[lang].json` 的 `b2b` 对象下。

## 7. 维护建议

1. **类型生成**: 如果修改了数据库表结构，请务必在前端和 Admin 项目中运行 `supabase gen types` 更新类型定义。
2. **Edge Function 本地调试**: 可以使用 `supabase functions serve` 在本地运行 Edge Functions 进行联调。
3. **旧代码清理**: 许多旧的 C 端复杂功能（如拼团、夺宝）已被标记为 `@deprecated` 并从路由中隐藏。**请勿在旧代码上继续堆砌 if/else**，如有新需求，请参考 B2B 模块的做法，创建独立的新页面。
