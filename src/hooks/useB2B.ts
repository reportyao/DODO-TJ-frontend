/**
 * B2B 批发模块 Hooks
 * Phase 4: 前端核心展示层
 *
 * 提供：
 * - useWholesalerProfile: 获取当前用户的批发商认证状态
 * - useB2BHomeFeed: 获取B2B首页商品列表（调用 rpc_get_b2b_home_feed）
 * - useB2BProductDetail: 获取B2B商品详情（调用 rpc_get_b2b_product_detail）
 * - useB2BSearch: B2B商品搜索
 * - useB2BCart: 购物车操作
 *
 * 注意：B2B 表和 RPC 函数是新增的，尚未在 src/types/supabase.ts 自动生成类型中注册。
 * 因此这里使用 (supabase as any) 进行类型断言。后续运行 supabase gen types 后可移除。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { staleTimes } from '../lib/react-query';
import { ensureHttps } from '../lib/utils';

// B2B 每页商品数量常量
export const B2B_PAGE_SIZE = 20;

// ============================================================
// Query Keys
// ============================================================
export const b2bQueryKeys = {
  wholesalerProfile: (userId: string) => ['b2b', 'wholesaler-profile', userId] as const,
  homeFeed: (page: number, lang: string, categoryId?: string) => ['b2b', 'home-feed', page, lang, categoryId || 'all'] as const,
  productDetail: (productId: string) => ['b2b', 'product-detail', productId] as const,
  search: (keyword: string) => ['b2b', 'search', keyword] as const,
  cart: (userId: string) => ['b2b', 'cart', userId] as const,
};

// ============================================================
// Types
// ============================================================
export interface WholesalerProfile {
  id: string;
  user_id: string;
  company_name: string | null;
  contact_phone: string | null;
  tax_id: string | null;
  business_address: string | null;
  delivery_address: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface B2BProduct {
  id: string;
  name_i18n: { zh?: string; ru?: string; tg?: string };
  image_url: string | null;
  image_urls: string[] | null;
  wholesale_price: number;
  retail_price: number | null;
  min_order_quantity: number;
  unit_measure: string;
  stock: number;
  sku: string | null;
  category_name: string | null;
}

export interface B2BProductDetail extends B2BProduct {
  description_i18n: { zh?: string; ru?: string; tg?: string };
  details_i18n?: { zh?: string; ru?: string; tg?: string };
  specifications_i18n: { zh?: string; ru?: string; tg?: string };
  material_i18n: { zh?: string; ru?: string; tg?: string };
  ai_understanding: any | null;
  barcode: string | null;
  status: string;
}

export interface CartItem {
  id: string;
  product_id: string;
  quantity: number;
  product_name: string;
  product_image: string | null;
  wholesale_price: number;
  unit_measure: string;
  stock: number;
  min_order_quantity: number;
  name_i18n: { zh?: string; ru?: string; tg?: string };
  subtotal: number;
  is_available: boolean;
}

// ============================================================
// Hooks
// ============================================================

/**
 * 获取当前用户的批发商认证状态
 */
export function useWholesalerProfile() {
  const { supabase } = useSupabase();
  const { user } = useUser();

  return useQuery<WholesalerProfile | null>({
    queryKey: b2bQueryKeys.wholesalerProfile(user?.id || ''),
    queryFn: async () => {
      if (!user?.id) return null;
      // 使用 any 断言绕过自动生成类型限制（wholesaler_profiles 表尚未在 types 中注册）
      const { data, error } = await (supabase as any)
        .from('wholesaler_profiles')
        .select('id,user_id,company_name,contact_phone,tax_id,business_address,delivery_address,status,reject_reason,approved_at,notes,created_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as WholesalerProfile | null;
    },
    enabled: !!user?.id,
    staleTime: staleTimes.static,
    gcTime: staleTimes.static * 2,
  });
}

/**
 * 获取B2B首页商品列表
 * @param page - 页码（从0开始）
 * @param categoryId - 可选分类ID筛选
 */
export function useB2BHomeFeed(page: number = 0, categoryId?: string) {
  const { supabase } = useSupabase();
  const { i18n } = useTranslation();
  const lang = i18n.language || 'ru';

  return useQuery<{ products: B2BProduct[]; total: number; banners?: any[]; categories?: any[] }>({
    queryKey: b2bQueryKeys.homeFeed(page, lang, categoryId),
    queryFn: async () => {
      const safePage = Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0);
      const offset = safePage * B2B_PAGE_SIZE;

      const normalizeProducts = (rawProducts: any[]): B2BProduct[] => rawProducts.map((item: any) => {
        // RPC 返回 { type, item_id, data: {...} }，也兼容旧版直接返回商品对象。
        const d = item?.data ? item.data : item;
        return {
          id: d.product_id || item.item_id || d.id,
          name_i18n: d.name_i18n || {},
          image_url: ensureHttps(d.image_url) || null,
          image_urls: (d.image_urls || []).map((u: string) => ensureHttps(u)),
          wholesale_price: Number(d.wholesale_price) || 0,
          retail_price: d.retail_price ? Number(d.retail_price) : null,
          min_order_quantity: d.min_order_quantity || 1,
          unit_measure: d.unit_measure || '件',
          stock: d.stock || 0,
          sku: d.sku || null,
          category_name: d.category_name || null,
        };
      }).filter((product: B2BProduct) => Boolean(product.id));

      const parseResult = (payload: any) => typeof payload === 'string' ? JSON.parse(payload) : payload;

      // 新版 RPC 支持 p_offset；旧环境未应用迁移时回退到旧参数并保持最多 200 条兼容展示。
      const { data, error } = await (supabase as any).rpc('rpc_get_b2b_home_feed', {
        p_lang: lang,
        p_limit: B2B_PAGE_SIZE,
        p_category_id: categoryId || null,
        p_offset: offset,
      });

      if (!error) {
        const result = parseResult(data);
        const products = normalizeProducts(result?.products || []);
        return {
          products,
          total: result?.total_count ?? result?.total ?? products.length,
          banners: result?.banners || [],
          categories: result?.categories || [],
        };
      }

      const shouldFallback = /p_offset|schema cache|function .*not found|Could not find/i.test(error.message || '');
      if (!shouldFallback) throw new Error(error.message);

      const fallbackLimit = Math.max(200, (safePage + 1) * B2B_PAGE_SIZE);
      const { data: fallbackData, error: fallbackError } = await (supabase as any).rpc('rpc_get_b2b_home_feed', {
        p_lang: lang,
        p_limit: fallbackLimit,
        p_category_id: categoryId || null,
      });
      if (fallbackError) throw new Error(fallbackError.message);

      const fallbackResult = parseResult(fallbackData);
      const allProducts = normalizeProducts(fallbackResult?.products || []);
      return {
        products: allProducts.slice(offset, offset + B2B_PAGE_SIZE),
        total: fallbackResult?.total_count ?? fallbackResult?.total ?? allProducts.length,
        banners: fallbackResult?.banners || [],
        categories: fallbackResult?.categories || [],
      };
    },
    staleTime: staleTimes.list,
    placeholderData: (prev: any) => prev,
  });
}

/**
 * 获取B2B商品详情
 */
export function useB2BProductDetail(productId: string) {
  const { supabase } = useSupabase();

  return useQuery<B2BProductDetail | null>({
    queryKey: b2bQueryKeys.productDetail(productId),
    queryFn: async () => {
      if (!productId) return null;
      const { data, error } = await (supabase as any).rpc('rpc_get_b2b_product_detail', {
        p_product_id: productId,
      });
      if (error) throw new Error(error.message);
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      // RPC 返回格式: { product: {product_id, name_i18n, ...}, stores: [...] }
      const p = result?.product;
      if (!p) return null;
      return {
        id: p.product_id || p.id,
        name_i18n: p.name_i18n || {},
        description_i18n: p.description_i18n || {},
        details_i18n: p.details_i18n || {},
        specifications_i18n: p.specifications_i18n || {},
        material_i18n: p.material_i18n || {},
        image_url: ensureHttps(p.image_url) || null,
        image_urls: (p.image_urls || []).map((u: string) => ensureHttps(u)),
        wholesale_price: Number(p.wholesale_price) || 0,
        retail_price: p.retail_price ? Number(p.retail_price) : null,
        min_order_quantity: p.min_order_quantity || 1,
        unit_measure: p.unit_measure || '件',
        stock: p.stock || 0,
        sku: p.sku || null,
        ai_understanding: p.ai_understanding || null,
        barcode: p.barcode || null,
        status: p.status || 'ACTIVE',
        category_name: null,
      } as B2BProductDetail;
    },
    enabled: !!productId,
    staleTime: staleTimes.detail,
  });
}

/**
 * B2B商品搜索
 */
export function useB2BSearch(keyword: string) {
  const { supabase } = useSupabase();

  return useQuery<B2BProduct[]>({
    queryKey: b2bQueryKeys.search(keyword),
    queryFn: async () => {
      if (!keyword || keyword.length < 2) return [];
      const { data, error } = await (supabase as any).rpc('rpc_b2b_search_products', {
        p_query: keyword,
        p_limit: 30,
      });
      if (error) throw new Error(error.message);
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      // RPC 返回格式: { products: [{product_id, name_i18n, ...}], query }
      const rawProducts = result?.products || [];
      return rawProducts.map((d: any) => ({
        id: d.product_id || d.id,
        name_i18n: d.name_i18n || {},
        image_url: ensureHttps(d.image_url) || null,
        image_urls: (d.image_urls || []).map((u: string) => ensureHttps(u)),
        wholesale_price: Number(d.wholesale_price) || 0,
        retail_price: d.retail_price ? Number(d.retail_price) : null,
        min_order_quantity: d.min_order_quantity || 1,
        unit_measure: d.unit_measure || '件',
        stock: d.stock || 0,
        sku: d.sku || null,
        category_name: null,
      }));
    },
    enabled: keyword.length >= 2,
    staleTime: staleTimes.list,
  });
}

/**
 * 获取购物车
 */
export function useB2BCart() {
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();

  return useQuery<CartItem[]>({
    queryKey: b2bQueryKeys.cart(user?.id || ''),
    queryFn: async () => {
      if (!user?.id || !sessionToken) return [];
      const { data, error } = await supabase.functions.invoke('b2b-cart', {
        method: 'POST',
        body: { action: 'get' },
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      // Edge Function 返回: { success, cart: [{cart_id, product_id, quantity, subtotal, product: {...}, is_available}], total_amount, item_count }
      const rawCart = data?.cart || [];
      return rawCart.map((item: any) => ({
        id: item.cart_id,
        product_id: item.product_id,
        quantity: item.quantity,
        product_name: item.product?.name || '',
        product_image: ensureHttps(item.product?.image_url) || null,
        wholesale_price: Number(item.product?.wholesale_price) || 0,
        unit_measure: item.product?.unit_measure || '件',
        stock: item.product?.stock || 0,
        min_order_quantity: item.product?.min_order_quantity || 1,
        name_i18n: item.product?.name_i18n || {},
        subtotal: item.subtotal || 0,
        is_available: item.is_available ?? true,
      })) as CartItem[];
    },
    enabled: !!user?.id && !!sessionToken,
    staleTime: staleTimes.realtime,
  });
}

/**
 * 购物车操作 mutations
 */
export function useB2BCartMutations() {
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const queryClient = useQueryClient();

  const invalidateCart = () => {
    if (user?.id) {
      queryClient.invalidateQueries({ queryKey: b2bQueryKeys.cart(user.id) });
    }
  };

  /**
   * 添加商品到购物车（如已存在则累加数量）
   * 用于：商品详情页的"加入购物车"按钮
   */
  const addItem = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      if (!sessionToken) throw new Error('未登录');
      const { data, error } = await supabase.functions.invoke('b2b-cart', {
        method: 'POST',
        body: { action: 'add', product_id: productId, quantity },
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data;
    },
    onSuccess: invalidateCart,
  });

  /**
   * 更新购物车中商品的绝对数量
   * 用于：购物车页面的数量步进器
   */
  const updateItem = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      if (!sessionToken) throw new Error('未登录');
      const { data, error } = await supabase.functions.invoke('b2b-cart', {
        method: 'POST',
        body: { action: 'update', product_id: productId, quantity },
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data;
    },
    onSuccess: invalidateCart,
  });

  // 向后兼容：upsertItem 默认使用 add 行为
  const upsertItem = addItem;

  const removeItem = useMutation({
    mutationFn: async (productId: string) => {
      if (!sessionToken) throw new Error('未登录');
      const { data, error } = await supabase.functions.invoke('b2b-cart', {
        method: 'POST',
        body: { action: 'remove', product_id: productId },
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data;
    },
    onSuccess: invalidateCart,
  });

  const clearCart = useMutation({
    mutationFn: async () => {
      if (!sessionToken) throw new Error('未登录');
      const { data, error } = await supabase.functions.invoke('b2b-cart', {
        method: 'POST',
        body: { action: 'clear' },
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data;
    },
    onSuccess: invalidateCart,
  });

  return { upsertItem, addItem, updateItem, removeItem, clearCart };
}