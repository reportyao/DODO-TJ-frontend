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
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { staleTimes } from '../lib/react-query';

// ============================================================
// Query Keys
// ============================================================
export const b2bQueryKeys = {
  wholesalerProfile: (userId: string) => ['b2b', 'wholesaler-profile', userId] as const,
  homeFeed: (page: number, categoryId?: string) => ['b2b', 'home-feed', page, categoryId] as const,
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
  specifications_i18n: { zh?: string; ru?: string; tg?: string };
  material_i18n: { zh?: string; ru?: string; tg?: string };
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
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as WholesalerProfile | null;
    },
    enabled: !!user?.id,
    staleTime: staleTimes.static,
  });
}

/**
 * 获取B2B首页商品列表
 */
export function useB2BHomeFeed(page: number = 0, categoryId?: string) {
  const { supabase } = useSupabase();

  return useQuery<{ products: B2BProduct[]; total: number }>({
    queryKey: b2bQueryKeys.homeFeed(page, categoryId),
    queryFn: async () => {
      // 使用 any 断言绕过 RPC 类型限制
      const { data, error } = await (supabase as any).rpc('rpc_get_b2b_home_feed', {
        p_page: page,
        p_page_size: 20,
        p_category_id: categoryId || null,
      });
      if (error) throw new Error(error.message);
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      return {
        products: result?.products || [],
        total: result?.total || 0,
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
      return result as B2BProductDetail | null;
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
        p_keyword: keyword,
        p_limit: 30,
      });
      if (error) throw new Error(error.message);
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      return result || [];
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
        body: { action: 'list' },
        headers: { 'x-session-token': sessionToken },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data?.items || [];
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

  const upsertItem = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      if (!sessionToken) throw new Error('未登录');
      const { data, error } = await supabase.functions.invoke('b2b-cart', {
        method: 'POST',
        body: { action: 'upsert', product_id: productId, quantity },
        headers: { 'x-session-token': sessionToken },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data;
    },
    onSuccess: invalidateCart,
  });

  const removeItem = useMutation({
    mutationFn: async (productId: string) => {
      if (!sessionToken) throw new Error('未登录');
      const { data, error } = await supabase.functions.invoke('b2b-cart', {
        method: 'POST',
        body: { action: 'remove', product_id: productId },
        headers: { 'x-session-token': sessionToken },
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
        headers: { 'x-session-token': sessionToken },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data;
    },
    onSuccess: invalidateCart,
  });

  return { upsertItem, removeItem, clearCart };
}
