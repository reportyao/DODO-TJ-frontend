-- ============================================================================
-- B2B 核心表迁移脚本
-- 日期: 2026-05-06
-- 版本: Phase 1
--
-- 目的: 将 DODO-TJ 从 ToC 一元夺宝模式重构为 B2B 批发直采模式
-- 核心变更:
--   1. 扩充 inventory_products 表，增加成本价/批发价/零售价/起批量/计量单位
--   2. 创建 wholesaler_profiles 批发商认证表
--   3. 创建 shopping_carts 购物车表
--   4. 创建 b2b_orders 主订单表
--   5. 创建 b2b_order_items 订单明细表
--
-- 注意事项:
--   - 不修改 users 表，批发商身份通过 wholesaler_profiles 关联
--   - 旧的 lotteries / full_purchase_orders 表保留不动，后续逐步废弃
--   - 新表使用 uuid_generate_v4() 作为主键生成策略
-- ============================================================================

-- ============================================================================
-- 1. 扩充 inventory_products 表
-- ============================================================================
-- 说明:
--   cost_price: 成本价，仅管理后台可见，用于内部利润核算
--   wholesale_price: 批发价，批发商登录后可见的采购价格
--   retail_price: 建议零售价/展示价，未来可用于普通用户展示（当前隐藏）
--   min_order_quantity: 起批量，B2B 下单时的最小数量限制
--   unit_measure: 计量单位（件、箱、打等），展示在商品卡片上

ALTER TABLE inventory_products
ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS wholesale_price numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS retail_price numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS min_order_quantity int DEFAULT 1,
ADD COLUMN IF NOT EXISTS unit_measure varchar DEFAULT '件';

-- 为现有商品设置默认值：将 original_price 同步到 retail_price
-- 这样现有商品在新模式下有一个合理的零售价
UPDATE inventory_products
SET retail_price = original_price
WHERE retail_price = 0 AND original_price > 0;

COMMENT ON COLUMN inventory_products.cost_price IS '成本价（内部结算用，仅管理后台可见）';
COMMENT ON COLUMN inventory_products.wholesale_price IS '批发价（批发商登录后可见的采购价格）';
COMMENT ON COLUMN inventory_products.retail_price IS '建议零售价/展示价（当前对普通用户隐藏价格，但保留字段供未来使用）';
COMMENT ON COLUMN inventory_products.min_order_quantity IS '起批量（B2B 下单时的最小数量限制）';
COMMENT ON COLUMN inventory_products.unit_measure IS '计量单位（件、箱、打等）';

-- ============================================================================
-- 2. 创建 wholesaler_profiles 批发商认证表
-- ============================================================================
-- 说明:
--   独立于 users 表，通过 user_id 关联
--   status 状态流转: pending -> approved / rejected
--   管理后台审核通过后，前端通过查询此表判断用户是否为批发商

CREATE TABLE IF NOT EXISTS wholesaler_profiles (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name varchar(255),                   -- 公司/店铺名称
    contact_phone varchar(50),                   -- 联系电话
    tax_id varchar(100),                         -- 税号/营业执照号
    business_address varchar(500),               -- 经营地址
    delivery_address varchar(500),               -- 默认收货地址（送货上门用）
    status varchar(20) DEFAULT 'pending',        -- pending, approved, rejected
    reject_reason varchar(500),                  -- 拒绝原因
    approved_at timestamptz,                     -- 审核通过时间
    approved_by uuid,                            -- 审核人（admin_users.id）
    notes varchar(1000),                         -- 管理员备注
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id)                              -- 一个用户只能有一个批发商身份
);

COMMENT ON TABLE wholesaler_profiles IS 'B2B 批发商认证表。用户申请成为批发商后，管理后台审核通过即可看到批发价并下单。';
COMMENT ON COLUMN wholesaler_profiles.status IS '审核状态: pending=待审核, approved=已通过, rejected=已拒绝';
COMMENT ON COLUMN wholesaler_profiles.delivery_address IS '默认收货地址，下单时可修改';

-- ============================================================================
-- 3. 创建 shopping_carts 购物车表
-- ============================================================================
-- 说明:
--   user_id + product_id 联合唯一，同一商品只存一条记录（修改数量）
--   仅批发商可使用购物车功能（前端控制）

CREATE TABLE IF NOT EXISTS shopping_carts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
    quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, product_id)
);

COMMENT ON TABLE shopping_carts IS 'B2B 购物车表。批发商添加商品到购物车，支持修改数量，结算时一键下单。';

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_shopping_carts_user_id ON shopping_carts(user_id);

-- ============================================================================
-- 4. 创建 b2b_orders 主订单表
-- ============================================================================
-- 说明:
--   一次购物车结算生成一个主订单
--   status 状态流转: pending -> processing -> delivering -> delivered -> paid
--   payment_status: pending -> paid（货到付款，送达后管理后台确认收款）
--   order_number: 业务订单号，格式 B2B-YYYYMMDD-XXXXX

CREATE TABLE IF NOT EXISTS b2b_orders (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number varchar(50) UNIQUE NOT NULL,     -- 业务订单号
    user_id uuid NOT NULL REFERENCES users(id),
    total_amount numeric NOT NULL DEFAULT 0,      -- 订单总金额（批发价 * 数量 的汇总）
    item_count int NOT NULL DEFAULT 0,            -- 商品种类数
    total_quantity int NOT NULL DEFAULT 0,        -- 商品总件数
    status varchar(30) DEFAULT 'pending',          -- pending, processing, delivering, delivered, paid, cancelled
    payment_method varchar(20) DEFAULT 'cod',     -- cod = Cash On Delivery（货到付款）
    payment_status varchar(20) DEFAULT 'pending', -- pending, paid
    estimated_delivery_date date,                 -- 预计送达日期（管理后台设置）
    delivery_address varchar(500),                -- 收货地址
    delivery_note varchar(500),                   -- 配送备注
    admin_note varchar(1000),                     -- 管理员内部备注
    confirmed_at timestamptz,                     -- 确认收款时间
    confirmed_by uuid,                            -- 确认收款操作人
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE b2b_orders IS 'B2B 主订单表。一次购物车结算生成一个主订单，送货上门后货到付款，管理后台确认收款完成闭环。';
COMMENT ON COLUMN b2b_orders.status IS '订单状态: pending=待处理, processing=处理中, delivering=配送中, delivered=已送达, paid=已完成, cancelled=已取消';
COMMENT ON COLUMN b2b_orders.payment_status IS '支付状态: pending=未付款, paid=已付款（货到付款确认后）';
COMMENT ON COLUMN b2b_orders.order_number IS '业务订单号，格式: B2B-YYYYMMDD-XXXXX';

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_b2b_orders_user_id ON b2b_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_status ON b2b_orders(status);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_created_at ON b2b_orders(created_at DESC);

-- ============================================================================
-- 5. 创建 b2b_order_items 订单明细表
-- ============================================================================
-- 说明:
--   每个主订单下有多条明细，记录每个商品的数量和单价
--   snapshot_data 存储下单时的商品快照（名称、图片等），防止商品修改后订单信息丢失

CREATE TABLE IF NOT EXISTS b2b_order_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES b2b_orders(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES inventory_products(id),
    quantity int NOT NULL CHECK (quantity > 0),
    unit_price numeric NOT NULL,                  -- 下单时的批发单价
    subtotal numeric NOT NULL,                    -- 小计 = unit_price * quantity
    snapshot_data jsonb,                          -- 商品快照: { name, name_i18n, image_url, sku }
    created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE b2b_order_items IS 'B2B 订单明细表。记录每个商品的数量、单价和商品快照。';
COMMENT ON COLUMN b2b_order_items.snapshot_data IS '下单时的商品快照，包含 name, name_i18n, image_url, sku 等，防止商品修改后订单信息丢失';

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_b2b_order_items_order_id ON b2b_order_items(order_id);

-- ============================================================================
-- 6. RLS (Row Level Security) 策略
-- ============================================================================
-- 为新表启用 RLS 并设置基本策略

-- wholesaler_profiles: 用户只能查看自己的批发商资料
ALTER TABLE wholesaler_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wholesaler profile"
    ON wholesaler_profiles FOR SELECT
    USING (true);  -- 允许所有已认证用户查询（前端需要判断当前用户是否为批发商）

CREATE POLICY "Users can insert own wholesaler profile"
    ON wholesaler_profiles FOR INSERT
    WITH CHECK (user_id = auth.uid() OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

CREATE POLICY "Service role can manage wholesaler profiles"
    ON wholesaler_profiles FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- shopping_carts: 用户只能操作自己的购物车
ALTER TABLE shopping_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cart"
    ON shopping_carts FOR ALL
    USING (user_id = auth.uid() OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- b2b_orders: 用户只能查看自己的订单
ALTER TABLE b2b_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own orders"
    ON b2b_orders FOR SELECT
    USING (user_id = auth.uid() OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

CREATE POLICY "Service role can manage orders"
    ON b2b_orders FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- b2b_order_items: 通过 order_id 关联，用户只能查看自己订单的明细
ALTER TABLE b2b_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own order items"
    ON b2b_order_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM b2b_orders
            WHERE b2b_orders.id = b2b_order_items.order_id
            AND (b2b_orders.user_id = auth.uid() OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
        )
    );

CREATE POLICY "Service role can manage order items"
    ON b2b_order_items FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- ============================================================================
-- 7. 授权
-- ============================================================================
-- 确保 Edge Functions (service_role) 和前端 (authenticated) 都能访问新表

GRANT SELECT, INSERT, UPDATE, DELETE ON wholesaler_profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON shopping_carts TO authenticated, service_role;
GRANT SELECT ON b2b_orders TO authenticated;
GRANT ALL ON b2b_orders TO service_role;
GRANT SELECT ON b2b_order_items TO authenticated;
GRANT ALL ON b2b_order_items TO service_role;

-- ============================================================================
-- 8. 辅助函数：生成 B2B 订单号
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_b2b_order_number()
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
    v_date_part varchar;
    v_seq int;
    v_order_number varchar;
BEGIN
    v_date_part := to_char(now(), 'YYYYMMDD');
    
    -- 获取当天的订单序号
    SELECT COALESCE(MAX(
        CASE 
            WHEN order_number LIKE 'B2B-' || v_date_part || '-%'
            THEN CAST(SUBSTRING(order_number FROM 14) AS int)
            ELSE 0
        END
    ), 0) + 1
    INTO v_seq
    FROM b2b_orders
    WHERE order_number LIKE 'B2B-' || v_date_part || '-%';
    
    v_order_number := 'B2B-' || v_date_part || '-' || LPAD(v_seq::text, 5, '0');
    
    RETURN v_order_number;
END;
$$;

COMMENT ON FUNCTION generate_b2b_order_number IS '生成 B2B 订单号，格式: B2B-YYYYMMDD-XXXXX（如 B2B-20260506-00001）';

GRANT EXECUTE ON FUNCTION generate_b2b_order_number TO authenticated, service_role;

-- ============================================================================
-- 9. 扩展 inventory_transactions 的 CHECK 约束
-- ============================================================================
-- 说明:
--   原有约束只允许 'FULL_PURCHASE', 'LOTTERY_PRIZE', 'STOCK_IN', 'STOCK_OUT',
--   'ADJUSTMENT', 'RESERVE', 'RELEASE_RESERVE'
--   新增 'B2B_SALE' 用于 B2B 订单的库存扣减记录
--
-- 注意: PostgreSQL 不支持直接 ALTER CHECK CONSTRAINT，需要先删后建

-- 查找并删除旧的 CHECK 约束
DO $$
DECLARE
    v_constraint_name text;
BEGIN
    SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'inventory_transactions'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%transaction_type%';
    
    IF v_constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE inventory_transactions DROP CONSTRAINT ' || v_constraint_name;
    END IF;
END;
$$;

-- 添加新的 CHECK 约束（包含 B2B_SALE）
ALTER TABLE inventory_transactions
ADD CONSTRAINT inventory_transactions_type_check
CHECK (transaction_type IN (
    'FULL_PURCHASE',      -- 全款购买（旧 ToC 模式）
    'LOTTERY_PRIZE',      -- 一元购物中奖（旧 ToC 模式）
    'STOCK_IN',           -- 入库
    'STOCK_OUT',          -- 出库
    'ADJUSTMENT',         -- 库存调整
    'RESERVE',            -- 预留
    'RELEASE_RESERVE',    -- 释放预留
    'B2B_SALE'            -- B2B 批发订单扣减（新增）
));

-- ============================================================================
-- 10. Admin RPC 白名单注册（必须！）
-- ============================================================================
-- 说明:
--   将新表加入 admin_query / admin_count / admin_mutate 的 v_allowed_tables 数组
--   不做此步骤，管理后台将无法访问这些表！
--   当前白名单最后一个表名是 'ai_understanding_jobs'

-- 10a. admin_query: 添加 wholesaler_profiles, shopping_carts, b2b_orders, b2b_order_items
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_query(text,text,text,jsonb,text,boolean,integer,integer,text,boolean)'::regprocedure
  );
  IF position('wholesaler_profiles' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''wholesaler_profiles'',
    ''shopping_carts'',
    ''b2b_orders'',
    ''b2b_order_items'''
    );
    EXECUTE v_def;
  END IF;
END; $$;

-- 10b. admin_count: 添加 wholesaler_profiles, shopping_carts, b2b_orders, b2b_order_items
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_count(text,text,jsonb,text)'::regprocedure
  );
  IF position('wholesaler_profiles' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''wholesaler_profiles'',
    ''shopping_carts'',
    ''b2b_orders'',
    ''b2b_order_items'''
    );
    EXECUTE v_def;
  END IF;
END; $$;

-- 10c. admin_mutate: 添加 wholesaler_profiles, shopping_carts, b2b_orders, b2b_order_items
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.admin_mutate(text,text,text,jsonb,jsonb,text,text)'::regprocedure
  );
  IF position('wholesaler_profiles' IN v_def) = 0 THEN
    v_def := replace(v_def,
      '''ai_understanding_jobs''',
      '''ai_understanding_jobs'',
    ''wholesaler_profiles'',
    ''shopping_carts'',
    ''b2b_orders'',
    ''b2b_order_items'''
    );
    EXECUTE v_def;
  END IF;
END; $$;

-- ============================================================================
-- 11. updated_at 触发器（自动更新时间戳）
-- ============================================================================
-- 为新表添加 updated_at 自动更新触发器

CREATE OR REPLACE FUNCTION public.touch_wholesaler_profiles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wholesaler_profiles_updated_at ON public.wholesaler_profiles;
CREATE TRIGGER trg_wholesaler_profiles_updated_at
  BEFORE UPDATE ON public.wholesaler_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_wholesaler_profiles_updated_at();

CREATE OR REPLACE FUNCTION public.touch_shopping_carts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shopping_carts_updated_at ON public.shopping_carts;
CREATE TRIGGER trg_shopping_carts_updated_at
  BEFORE UPDATE ON public.shopping_carts
  FOR EACH ROW EXECUTE FUNCTION public.touch_shopping_carts_updated_at();

CREATE OR REPLACE FUNCTION public.touch_b2b_orders_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_b2b_orders_updated_at ON public.b2b_orders;
CREATE TRIGGER trg_b2b_orders_updated_at
  BEFORE UPDATE ON public.b2b_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_b2b_orders_updated_at();

-- ============================================================================
-- 完成
-- ============================================================================
-- 迁移完成后，需要手动更新 database.types.ts 以反映新的表结构
-- 运行: npx supabase gen types typescript --project-id <project-id> > database.types.ts
