<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# 积分商城管理页面 - 创建/编辑积分商城商品功能完善，这个要考虑三种语言的切换，需要人工上传不同语言的简介内容

用户充值银行参数录入功能缺失，这个你理解错了，我说的是前端用户点击充值，所看到的银行信息部分，在管理后台这里要对应有可以填写的地方
增加一个多层级用户管理的页面，要配合现在前端的UI页面，支持多层级的返利设置等等对应功能，在管理后台要有对应设置入口
增加现在开奖算法的管理后台管理入口，和现在前端开奖部分配合

根据我上面的内容，再生成对应的开发文档，给ai看

基于你的补充说明，我重新生成更精准、更细致的技术开发文档：

***

# TezBarakat 管理后台功能补全开发文档（修订版）

**目标受众**：AI 开发工程师 / Manus AI
**部署环境**：47.243.83.253 服务器
**前端参考**：tezbarakat-tj-frontend（支持中文/俄语/塔吉克语三语言）
**数据库**：Supabase (qcrcgpwlfouqslokwbzl.supabase.co)

***

## 1. 积分商城管理 - 创建/编辑积分商城（多语言内容管理）

### 需求描述

管理员创建/编辑积分商城商品时，需要为**三种语言（zh/ru/tg）分别上传内容**：

- 商品名称
- 商品描述
- 商品详情（富文本）

用户在前端切换语言时，显示对应语言版本的内容。

***

### 数据库表结构设计

#### 表：`lotteries`

```sql
CREATE TABLE lotteries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- 基本信息
  status lottery_status NOT NULL DEFAULT 'CREATED',
  total_shares INTEGER NOT NULL,
  price_per_share NUMERIC(10,2) NOT NULL,
  sold_shares INTEGER DEFAULT 0,
  
  -- 多语言内容（JSON 字段）
  name_i18n JSONB NOT NULL,
  -- 示例: {"zh": "iPhone 15 Pro", "ru": "iPhone 15 Pro", "tg": "iPhone 15 Pro"}
  
  description_i18n JSONB NOT NULL,
  -- 示例: {"zh": "全新未拆封", "ru": "Новый запечатанный", "tg": "Нави бастабандӣ"}
  
  details_i18n JSONB,
  -- 示例: {"zh": "<p>详细介绍...</p>", "ru": "<p>Подробное описание...</p>", ...}
  
  -- 图片（多语言可共用或分开）
  images JSONB NOT NULL,
  -- 示例: ["https://cdn.example.com/img1.jpg", "https://cdn.example.com/img2.jpg"]
  -- 如需多语言图片: {"zh": ["url1"], "ru": ["url2"], "tg": ["url3"]}
  
  -- 时间
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  draw_time TIMESTAMP WITH TIME ZONE,
  
  -- 算法相关
  algorithm_type VARCHAR(50) DEFAULT 'standard',
  algorithm_params JSONB,
  
  -- 中奖信息
  winner_user_id UUID REFERENCES users(id),
  winning_number INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 枚举类型（确保包含所有状态）
CREATE TYPE lottery_status AS ENUM (
  'CREATED',      -- 已创建
  'STARTED',      -- 进行中
  'PAUSED',       -- 已暂停
  'SOLD_OUT',     -- 已售罄
  'DRAWING',      -- 开奖中
  'FINISHED'      -- 已完成
);
```


***

### 管理后台 UI 设计

#### 创建/编辑积分商城表单（分 Tab 切换）

```tsx
// 表单结构示例
interface LotteryFormData {
  // 基本信息
  totalShares: number
  pricePerShare: number
  startTime: string
  endTime: string
  algorithmType: 'standard' | 'vrf' | 'hash'
  
  // 多语言内容（Tab 切换）
  nameZh: string
  nameRu: string
  nameTg: string
  
  descriptionZh: string
  descriptionRu: string
  descriptionTg: string
  
  detailsZh: string  // 富文本编辑器
  detailsRu: string
  detailsTg: string
  
  // 图片上传
  images: string[]  // 通用图片 URL 数组
}
```


#### UI 布局示例

```
┌─────────────────────────────────────────────────┐
│  创建积分商城                                        │
├─────────────────────────────────────────────────┤
│  基本信息                                        │
│  ├─ 总份数: [____]                              │
│  ├─ 每份价格: [____]                            │
│  ├─ 开始时间: [日期选择器]                       │
│  ├─ 结束时间: [日期选择器]                       │
│  └─ 开奖算法: [下拉选择: 标准/VRF/哈希]          │
├─────────────────────────────────────────────────┤
│  商品信息 (多语言)                               │
│  ┌─ Tabs: [中文] [Русский] [Тоҷикӣ] ─┐        │
│  │                                      │        │
│  │  商品名称: [________________]        │        │
│  │  简短描述: [________________]        │        │
│  │            [________________]        │        │
│  │  详细介绍: [富文本编辑器______]      │        │
│  │            [________________]        │        │
│  │            [________________]        │        │
│  └──────────────────────────────────────┘        │
├─────────────────────────────────────────────────┤
│  商品图片                                        │
│  [上传图片] [图片1] [图片2] [图片3]             │
├─────────────────────────────────────────────────┤
│  [取消]                           [保存并发布]   │
└─────────────────────────────────────────────────┘
```


***

### 后端 API 实现

#### 创建积分商城接口

```typescript
// POST /api/admin/lotteries
async function createLottery(req, res) {
  const {
    totalShares,
    pricePerShare,
    startTime,
    endTime,
    algorithmType,
    
    // 多语言内容
    nameZh, nameRu, nameTg,
    descriptionZh, descriptionRu, descriptionTg,
    detailsZh, detailsRu, detailsTg,
    
    images
  } = req.body

  // 校验
  if (!nameZh || !nameRu || !nameTg) {
    return res.status(400).json({ error: '所有语言的商品名称必填' })
  }

  // 组装多语言 JSON
  const nameI18n = { zh: nameZh, ru: nameRu, tg: nameTg }
  const descriptionI18n = { zh: descriptionZh, ru: descriptionRu, tg: descriptionTg }
  const detailsI18n = { zh: detailsZh, ru: detailsRu, tg: detailsTg }

  // 写入数据库
  const { data, error } = await supabase
    .from('lotteries')
    .insert({
      status: 'CREATED',
      total_shares: totalShares,
      price_per_share: pricePerShare,
      name_i18n: nameI18n,
      description_i18n: descriptionI18n,
      details_i18n: detailsI18n,
      images,
      start_time: startTime,
      end_time: endTime,
      algorithm_type: algorithmType
    })
    .select()
    .single()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.json({ success: true, lottery: data })
}
```


***

## 2. 充值银行参数配置（管理后台录入，前端展示）

### 需求描述

**前端用户点击充值时，会看到"银行转账信息"**，包括：

- 收款银行名称
- 收款账户名
- 收款账号
- 支行信息
- 转账备注说明

这些信息需要**在管理后台可配置**，支持多个银行账户、多语言展示。

***

### 数据库表结构

#### 表：`payment_methods`

```sql
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  type VARCHAR(50) NOT NULL,  -- 'bank_transfer', 'alipay', 'wechat', etc.
  status VARCHAR(20) DEFAULT 'active',  -- 'active', 'inactive'
  
  -- 银行信息（多语言）
  bank_name_i18n JSONB,
  -- 示例: {"zh": "中国工商银行", "ru": "ICBC China", "tg": "Бонки ICBC"}
  
  account_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(100) NOT NULL,
  
  branch_name_i18n JSONB,
  -- 示例: {"zh": "深圳南山支行", "ru": "Филиал Шэньчжэнь", "tg": "Шохаи Шэньчжэнь"}
  
  transfer_note_i18n JSONB,
  -- 示例: {"zh": "请备注用户ID", "ru": "Укажите ID пользователя", ...}
  
  -- 处理时间/费率等
  processing_time_minutes INTEGER DEFAULT 30,
  min_amount NUMERIC(10,2) DEFAULT 10.00,
  max_amount NUMERIC(10,2) DEFAULT 50000.00,
  
  sort_order INTEGER DEFAULT 0,  -- 显示顺序
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```


***

### 管理后台 UI 设计

#### 支付方式管理页面

```
┌─────────────────────────────────────────────────┐
│  支付方式配置                    [+ 添加新方式]  │
├─────────────────────────────────────────────────┤
│  银行转账配置                                    │
│  ┌─────────────────────────────────────────┐   │
│  │ 类型: 银行转账       状态: ●启用        │   │
│  │                                         │   │
│  │ [中文] [Русский] [Тоҷикӣ]             │   │
│  │                                         │   │
│  │ 银行名称: 中国工商银行                   │   │
│  │ 账户名:   TezBarakat 收款账户            │   │
│  │ 账号:     6222 **** **** 1234           │   │
│  │ 支行:     深圳南山支行                   │   │
│  │ 转账备注: 请备注您的用户ID               │   │
│  │                                         │   │
│  │ 处理时间: 30 分钟                       │   │
│  │ 最小金额: 10.00                         │   │
│  │ 最大金额: 50000.00                      │   │
│  │                                         │   │
│  │ [编辑] [删除] [禁用]                   │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```


#### 表单字段（支持多语言）

```typescript
interface PaymentMethodForm {
  type: 'bank_transfer' | 'alipay' | 'wechat'
  status: 'active' | 'inactive'
  
  // 多语言字段
  bankNameZh: string
  bankNameRu: string
  bankNameTg: string
  
  accountName: string  // 收款人名称（通常不需要多语言）
  accountNumber: string
  
  branchNameZh: string
  branchNameRu: string
  branchNameTg: string
  
  transferNoteZh: string
  transferNoteRu: string
  transferNoteTg: string
  
  processingTimeMinutes: number
  minAmount: number
  maxAmount: number
}
```


***

### 前端获取接口

```typescript
// GET /api/payment-methods?type=bank_transfer&status=active
// 前端根据用户当前语言显示对应内容

const { data: paymentMethods } = await supabase
  .from('payment_methods')
  .select('*')
  .eq('type', 'bank_transfer')
  .eq('status', 'active')
  .order('sort_order')

// 前端展示逻辑
const currentLang = i18n.language  // 'zh' | 'ru' | 'tg'
const bankName = paymentMethod.bank_name_i18n[currentLang]
```


***

## 3. 多层级用户管理与返利设置

### 需求描述

- 支持**3级推荐返利体系**（前端已有邀请功能）
- 管理后台需要：

1. 查看用户邀请关系树（多层级）
2. 设置各级返利比例
3. 查看各用户的返利统计
4. 手动调整/冻结返利

***

### 数据库表结构

#### 表：`users`（扩展字段）

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_level INTEGER DEFAULT 0;
```


#### 表：`commission_settings`（返利配置）

```sql
CREATE TABLE commission_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  level INTEGER NOT NULL,  -- 1, 2, 3
  rate NUMERIC(5,4) NOT NULL,  -- 0.0500 = 5%
  
  description_i18n JSONB,
  -- 示例: {"zh": "一级推荐5%", "ru": "Уровень 1: 5%", ...}
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(level)
);

-- 默认配置
INSERT INTO commission_settings (level, rate, description_i18n) VALUES
(1, 0.0500, '{"zh": "一级推荐返利", "ru": "Уровень 1", "tg": "Сатҳи 1"}'),
(2, 0.0300, '{"zh": "二级推荐返利", "ru": "Уровень 2", "tg": "Сатҳи 2"}'),
(3, 0.0100, '{"zh": "三级推荐返利", "ru": "Уровень 3", "tg": "Сатҳи 3"}');
```


#### 表：`commissions`（返利记录）

```sql
CREATE TABLE commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  user_id UUID NOT NULL REFERENCES users(id),  -- 获得返利的用户
  referrer_id UUID NOT NULL REFERENCES users(id),  -- 产生消费的下级用户
  
  order_id UUID REFERENCES orders(id),
  order_amount NUMERIC(10,2) NOT NULL,
  
  level INTEGER NOT NULL,  -- 1, 2, 3
  rate NUMERIC(5,4) NOT NULL,
  commission_amount NUMERIC(10,2) NOT NULL,
  
  status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'paid', 'frozen'
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  paid_at TIMESTAMP WITH TIME ZONE
);
```


***

### 管理后台 UI 设计

#### 1. 返利设置页面

```
┌─────────────────────────────────────────────────┐
│  返利设置                                        │
├─────────────────────────────────────────────────┤
│  推荐返利比例配置                                │
│  ┌─────────────────────────────────────────┐   │
│  │ 层级    返利比例    说明              状态│   │
│  ├─────────────────────────────────────────┤   │
│  │ 一级    5.00%      直接推荐           ●启用│   │
│  │ 二级    3.00%      二级推荐           ●启用│   │
│  │ 三级    1.00%      三级推荐           ●启用│   │
│  └─────────────────────────────────────────┘   │
│  [编辑返利比例]                                  │
├─────────────────────────────────────────────────┤
│  返利规则说明                                    │
│  • 用户A邀请用户B，B消费时A获得5%返利           │
│  • 用户B邀请用户C，C消费时A获得3%，B获得5%      │
│  • 返利实时到账，可在钱包查看                    │
└─────────────────────────────────────────────────┘
```


#### 2. 用户邀请关系树页面

```
┌─────────────────────────────────────────────────┐
│  用户邀请关系                   [搜索: ______]  │
├─────────────────────────────────────────────────┤
│  📊 用户: user123                               │
│      ├─ 一级邀请 (5人)                          │
│      │   ├─ user456 (消费: ¥1,200)             │
│      │   │   └─ 二级邀请 (2人)                  │
│      │   │       ├─ user789 (消费: ¥500)       │
│      │   │       └─ user101 (消费: ¥300)       │
│      │   ├─ user112 (消费: ¥800)               │
│      │   └─ ...                                │
│      │                                          │
│      └─ 返利统计                                │
│          ├─ 一级返利: ¥150                      │
│          ├─ 二级返利: ¥24                       │
│          ├─ 三级返利: ¥5                        │
│          └─ 总计: ¥179                          │
└─────────────────────────────────────────────────┘
```


#### 3. 返利记录管理页面

```
┌─────────────────────────────────────────────────┐
│  返利记录                   [导出Excel]          │
├─────────────────────────────────────────────────┤
│  筛选: [用户ID] [层级▼] [状态▼] [日期范围]      │
├─────────────────────────────────────────────────┤
│  时间          用户      订单    层级  金额  状态│
│  11-17 10:30  user123  #12345   1级  ¥50  已发放│
│  11-17 09:15  user123  #12346   2级  ¥15  已发放│
│  11-16 15:20  user456  #12300   1级  ¥100 待发放│
│  ...                                            │
├─────────────────────────────────────────────────┤
│  [批量发放] [批量冻结] [导出报表]               │
└─────────────────────────────────────────────────┘
```


***

### 后端 API 实现

#### 获取用户邀请树

```typescript
// GET /api/admin/users/:userId/referral-tree
async function getUserReferralTree(userId: string) {
  // 递归查询3层邀请关系
  const level1 = await supabase
    .from('users')
    .select('id, username, total_spent')
    .eq('referrer_id', userId)

  // 对每个一级用户查询二级
  for (const user of level1) {
    user.children = await supabase
      .from('users')
      .select('id, username, total_spent')
      .eq('referrer_id', user.id)
    
    // 对每个二级用户查询三级
    for (const child of user.children) {
      child.children = await supabase
        .from('users')
        .select('id, username, total_spent')
        .eq('referrer_id', child.id)
    }
  }

  return level1
}
```


#### 更新返利比例

```typescript
// PUT /api/admin/commission-settings/:level
async function updateCommissionRate(level: number, rate: number) {
  // 校验
  if (rate < 0 || rate > 1) {
    throw new Error('返利比例必须在0-100%之间')
  }

  const { error } = await supabase
    .from('commission_settings')
    .update({ rate, updated_at: new Date().toISOString() })
    .eq('level', level)

  if (error) throw error

  return { success: true }
}
```


***

## 4. 开奖算法管理入口

### 需求描述

管理后台需要能够：

1. 查看当前支持的开奖算法列表
2. 配置算法参数（如VRF密钥、随机种子等）
3. 查看历史开奖记录和算法验证数据
4. 手动触发开奖（紧急情况）

***

### 数据库表结构

#### 表：`draw_algorithms`（算法配置）

```sql
CREATE TABLE draw_algorithms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  name VARCHAR(50) UNIQUE NOT NULL,  -- 'standard', 'vrf', 'hash'
  display_name_i18n JSONB NOT NULL,
  -- 示例: {"zh": "标准算法", "ru": "Стандартный", "tg": "Стандартӣ"}
  
  description_i18n JSONB,
  formula_i18n JSONB,
  -- 算法公式说明（多语言）
  
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  
  config JSONB,
  -- 算法特定配置，如:
  -- {"vrf_public_key": "...", "seed_source": "blockchain"}
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 初始化算法
INSERT INTO draw_algorithms (name, display_name_i18n, description_i18n, is_default) VALUES
('standard', 
 '{"zh": "标准时间戳算法", "ru": "Стандартный алгоритм", "tg": "Алгоритми стандартӣ"}',
 '{"zh": "基于订单时间戳求和取模", "ru": "На основе временных меток", "tg": "Дар асоси вақти фармоишҳо"}',
 true),
 
('vrf', 
 '{"zh": "VRF可验证随机算法", "ru": "VRF проверяемый случайный", "tg": "VRF тасодуфии санҷидашаванда"}',
 '{"zh": "使用可验证随机函数，完全透明", "ru": "Использует проверяемую функцию", "tg": "Истифодаи функсияи санҷидашаванда"}',
 false);
```


#### 表：`draw_logs`（开奖日志）

```sql
CREATE TABLE draw_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  lottery_id UUID NOT NULL REFERENCES lotteries(id),
  algorithm_name VARCHAR(50) NOT NULL,
  
  -- 输入参数
  input_data JSONB NOT NULL,
  -- 示例: {"orders": [...], "timestamp_sum": 123456789, "total_shares": 1000}
  
  -- 计算过程
  calculation_steps JSONB,
  -- 示例: [{"step": 1, "description": "计算时间戳总和", "value": 123456789}, ...]
  
  -- 输出结果
  winning_number INTEGER NOT NULL,
  winner_user_id UUID,
  
  -- VRF 特有字段
  vrf_seed TEXT,
  vrf_proof TEXT,
  
  draw_time TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```


***

### 管理后台 UI 设计

#### 1. 算法管理页面

```
┌─────────────────────────────────────────────────┐
│  开奖算法管理                                    │
├─────────────────────────────────────────────────┤
│  当前支持的算法                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ 算法名称          说明           状态  默认│   │
│  ├─────────────────────────────────────────┤   │
│  │ 标准时间戳算法  基于订单时间    ●启用  ●  │   │
│  │ VRF算法        可验证随机       ●启用     │   │
│  │ 哈希算法        SHA256计算      ○禁用     │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  [查看算法详情] [配置参数] [查看验证数据]       │
└─────────────────────────────────────────────────┘
```


#### 2. 算法配置详情（以 VRF 为例）

```
┌─────────────────────────────────────────────────┐
│  VRF 算法配置                          [保存]   │
├─────────────────────────────────────────────────┤
│  算法说明                                        │
│  VRF (Verifiable Random Function) 可验证随机函数 │
│  通过密码学方式确保随机性，所有人可验证结果      │
│                                                  │
│  配置参数                                        │
│  VRF 公钥: [____________________________]       │
│  VRF 私钥: [____________________________]       │
│  随机源:   [○ 区块链哈希  ● 服务器熵池]        │
│                                                  │
│  算法公式                                        │
│  [中文] [Русский] [Тоҷикӣ]                    │
│  ┌─────────────────────────────────────────┐   │
│  │ 1. 获取VRF种子 (区块高度哈希)           │   │
│  │ 2. 使用私钥计算VRF输出和证明            │   │
│  │ 3. 中奖号 = VRF输出 mod 总份数          │   │
│  │ 4. 任何人可用公钥验证证明               │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```


#### 3. 开奖记录页面

```
┌─────────────────────────────────────────────────┐
│  开奖记录                     [导出验证数据]     │
├─────────────────────────────────────────────────┤
│  时间          活动      算法     中奖号  验证   │
│  11-17 20:00  #12345  标准算法    456   [查看]  │
│  11-17 18:00  #12344  VRF算法     123   [查看]  │
│  11-16 20:00  #12340  标准算法    789   [查看]  │
│  ...                                            │
└─────────────────────────────────────────────────┘

// 点击"查看"弹出验证详情
┌─────────────────────────────────────────────────┐
│  开奖验证数据 - #12345                          │
├─────────────────────────────────────────────────┤
│  活动ID: 12345                                  │
│  算法: 标准时间戳算法                            │
│  开奖时间: 2025-11-17 20:00:00                  │
│                                                  │
│  输入数据:                                       │
│  • 总份数: 1000                                 │
│  • 订单数: 856                                  │
│  • 时间戳总和: 1,479,234,567,890                │
│                                                  │
│  计算过程:                                       │
│  1. 收集所有订单时间戳                          │
│  2. 计算总和: 1,479,234,567,890                 │
│  3. 取模运算: 1479234567890 % 1000 = 890       │
│  4. 中奖号码: 890                               │
│                                                  │
│  中奖用户: user12345 (@username)                │
│                                                  │
│  [下载验证数据JSON] [查看区块链证明]            │
└─────────────────────────────────────────────────┘
```


***

### 后端 API 实现

#### 获取算法列表

```typescript
// GET /api/admin/draw-algorithms
async function getDrawAlgorithms() {
  const { data, error } = await supabase
    .from('draw_algorithms')
    .select('*')
    .eq('is_active', true)
    .order('is_default', { ascending: false })

  if (error) throw error
  return data
}
```


#### 更新算法配置

```typescript
// PUT /api/admin/draw-algorithms/:name
async function updateAlgorithmConfig(name: string, config: any) {
  const { error } = await supabase
    .from('draw_algorithms')
    .update({ config, updated_at: new Date().toISOString() })
    .eq('name', name)

  if (error) throw error
  return { success: true }
}
```


#### 手动触发开奖

```typescript
// POST /api/admin/lotteries/:id/draw
async function manualDraw(lotteryId: string, algorithmName: string) {
  // 1. 验证活动状态
  const lottery = await getLottery(lotteryId)
  if (lottery.status !== 'SOLD_OUT') {
    throw new Error('只有已售罄的活动才能手动开奖')
  }

  // 2. 获取算法
  const algorithm = await getAlgorithm(algorithmName)

  // 3. 执行开奖
  const result = await executeDrawAlgorithm(lottery, algorithm)

  // 4. 记录日志
  await supabase.from('draw_logs').insert({
    lottery_id: lotteryId,
    algorithm_name: algorithmName,
    input_data: result.inputData,
    calculation_steps: result.steps,
    winning_number: result.winningNumber,
    winner_user_id: result.winnerId,
    vrf_seed: result.vrfSeed,
    vrf_proof: result.vrfProof,
    draw_time: new Date().toISOString()
  })

  // 5. 更新活动状态
  await supabase
    .from('lotteries')
    .update({
      status: 'FINISHED',
      winning_number: result.winningNumber,
      winner_user_id: result.winnerId,
      draw_time: new Date().toISOString()
    })
    .eq('id', lotteryId)

  return result
}
```


***

## 总结与实施检查清单

### ✅ 功能实施清单

- [ ] **积分商城管理多语言**
    - [ ] 数据库表添加 `name_i18n`, `description_i18n`, `details_i18n` 字段
    - [ ] 管理后台表单支持三语言 Tab 切换
    - [ ] 富文本编辑器集成
    - [ ] 前端读取多语言内容并根据用户语言显示
- [ ] **充值银行参数配置**
    - [ ] 创建 `payment_methods` 表
    - [ ] 管理后台添加支付方式配置页面
    - [ ] 支持多语言银行信息录入
    - [ ] 前端充值页面从数据库读取银行信息
- [ ] **多层级用户管理**
    - [ ] 扩展 `users` 表添加推荐关系字段
    - [ ] 创建 `commission_settings` 和 `commissions` 表
    - [ ] 管理后台添加返利设置页面
    - [ ] 管理后台添加用户邀请树页面
    - [ ] 管理后台添加返利记录管理页面
- [ ] **开奖算法管理**
    - [ ] 创建 `draw_algorithms` 和 `draw_logs` 表
    - [ ] 管理后台添加算法管理页面
    - [ ] 管理后台添加开奖记录查看页面
    - [ ] 实现手动触发开奖接口
    - [ ] 提供验证数据下载功能

***

**此文档详尽覆盖了所有补充需求的技术细节，可直接交付 AI 工程师实施。**

