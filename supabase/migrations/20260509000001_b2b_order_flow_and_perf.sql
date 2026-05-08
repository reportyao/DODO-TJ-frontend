-- ============================================================================
-- B2B 下单链路与性能优化
-- 日期: 2026-05-09
--
-- 目的:
--   1. 统一购物车与结算链路的业务说明：登录用户均可创建 B2B 订单，批发商资料用于默认地址与后台识别。
--   2. 为 B2B 首页分页、分类筛选、购物车读取和用户订单列表补充复合索引，降低接口响应时间。
--
-- 注意:
--   结算权限的实际校验位于 supabase/functions/b2b-checkout/index.ts。
-- ============================================================================

COMMENT ON TABLE public.shopping_carts IS 'B2B 购物车表。登录用户可添加商品到购物车，支持修改数量，结算时一键生成 B2B 订单。';
COMMENT ON TABLE public.b2b_orders IS 'B2B 主订单表。登录用户从购物车结算生成主订单；批发商资料用于默认地址、企业名称和后台运营识别。';

-- 用户购物车读取与更新时间排序：b2b-cart Edge Function 按 user_id 读取购物车并关联商品。
CREATE INDEX IF NOT EXISTS idx_shopping_carts_user_updated_at
    ON public.shopping_carts (user_id, updated_at DESC);

-- 用户订单列表：B2BOrdersPage/后台常按用户和创建时间读取最近订单。
CREATE INDEX IF NOT EXISTS idx_b2b_orders_user_created_at
    ON public.b2b_orders (user_id, created_at DESC);

-- B2B 首页 Feed：仅展示 ACTIVE 且有库存商品，按 created_at/id 倒序分页。
-- 比仅 status='ACTIVE' 的索引更贴合 stock > 0 的首页查询条件。
CREATE INDEX IF NOT EXISTS idx_inventory_products_b2b_available_created
    ON public.inventory_products (created_at DESC, id DESC)
    WHERE status = 'ACTIVE' AND stock > 0;

-- 分类筛选：rpc_get_b2b_home_feed 使用 category_id + product_id 判断商品是否属于分类。
CREATE INDEX IF NOT EXISTS idx_product_categories_category_product
    ON public.product_categories (category_id, product_id);
