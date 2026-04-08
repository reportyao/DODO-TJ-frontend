/**
 * 首页场景化 Feed 数据 hook
 *
 * 调用 get-home-feed Edge Function 获取：
 * - banners: 轮播图
 * - categories: 金刚区一级分类
 * - products: 商品列表（按分类筛选）
 * - placements: 专题投放卡片
 *
 * 使用 react-query 管理缓存，与现有 useHomeData.ts 保持一致的模式。
 *
 * [审查修复]
 * - Edge Function get-home-feed 定义为 GET 请求，使用 URL 查询参数（lang, limit）
 *   但原实现使用 supabase.functions.invoke() 的 body 传参（POST 模式），
 *   导致 Edge Function 收不到参数，始终使用默认值。
 *   此外 category_id 参数在 Edge Function / RPC 中根本不存在，
 *   分类筛选需要前端实现。
 * - 修复为正确的 GET 请求方式
 * - 将 data 从 response.data.data 正确解包（Edge Function 返回 { success, data, meta }）
 * - get-topic-detail 同样修复为 GET 请求方式
 *
 * [遗漏修复]
 * - 分类筛选功能未实现：categoryId 参数被接收但从未使用，
 *   导致选择分类后商品列表不变化。
 *   修复方案：当 categoryId 存在时，查询 product_categories 表获取该分类下的
 *   inventory_product_id 列表，然后在前端过滤 feed 中的商品。
 * - 新增 useCategoryProducts hook 用于独立的分类商品列表页。
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys, staleTimes } from '../lib/react-query';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import type { HomeFeedResponse, HomeFeedItem, HomeFeedProductData } from '../types/homepage';

// 扩展 queryKeys
export const homepageQueryKeys = {
  ...queryKeys,
  homeFeed: (categoryId?: string) => ['homepage', 'feed', categoryId || 'all'] as const,
  topicDetail: (slugOrId: string) => ['homepage', 'topic', slugOrId] as const,
  categoryProducts: (categoryId: string) => ['homepage', 'category-products', categoryId] as const,
};

/**
 * 查询指定分类下的商品 ID 列表
 * 通过 product_categories 关系表获取
 */
async function fetchCategoryProductIds(categoryId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('product_id')
    .eq('category_id', categoryId);

  if (error) {
    console.warn('[useHomeFeed] Failed to fetch category products:', error.message);
    return new Set();
  }

  return new Set((data || []).map((row: { product_id: string }) => row.product_id));
}

/**
 * 获取首页 Feed 数据
 *
 * @param categoryId - 可选的分类 ID，用于前端筛选商品
 *
 * [修复说明]
 * Edge Function `get-home-feed` 使用 GET 方法，参数通过 URL 查询字符串传递。
 * `supabase.functions.invoke()` 默认使用 POST + body，需要改用 GET 方式。
 *
 * 当 categoryId 存在时，会额外查询 product_categories 表获取该分类下的商品ID，
 * 然后在前端过滤 feed 中的商品列表。
 */
export function useHomeFeed(categoryId?: string) {
  return useQuery<HomeFeedResponse>({
    queryKey: homepageQueryKeys.homeFeed(categoryId),
    queryFn: async () => {
      // 并行获取 feed 数据和分类商品 ID（如果需要筛选）
      const [feedResult, categoryProductIds] = await Promise.all([
        supabase.functions.invoke('get-home-feed', { method: 'GET' }),
        categoryId ? fetchCategoryProductIds(categoryId) : Promise.resolve(null),
      ]);

      if (feedResult.error) {
        throw new Error(await extractEdgeFunctionError(feedResult.error));
      }

      // Edge Function 返回格式: { success, data: { banners, categories, products, placements }, meta }
      const feedData = feedResult.data?.data || feedResult.data;

      const allProducts: HomeFeedItem[] = feedData?.products || [];
      const placements: HomeFeedItem[] = feedData?.placements || [];

      // 如果有分类筛选，过滤商品列表
      let filteredProducts = allProducts;
      if (categoryId && categoryProductIds) {
        filteredProducts = allProducts.filter((item) => {
          const productData = item.data as HomeFeedProductData;
          // 通过 inventory_product_id 匹配分类关系
          return categoryProductIds.has(productData.inventory_product_id);
        });
      }

      // 确保返回结构完整
      return {
        banners: feedData?.banners || [],
        categories: feedData?.categories || [],
        products: filteredProducts,
        placements: placements,
      };
    },
    staleTime: staleTimes.list,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * 获取指定分类下的商品列表（用于独立的分类商品列表页）
 *
 * 复用 get-home-feed 的数据并按分类过滤，避免新增 Edge Function。
 *
 * @param categoryId - 分类 ID
 * @param categoryCode - 分类 code（用于缓存 key）
 */
export function useCategoryProducts(categoryId: string) {
  return useQuery<HomeFeedResponse>({
    queryKey: homepageQueryKeys.categoryProducts(categoryId),
    queryFn: async () => {
      const [feedResult, categoryProductIds] = await Promise.all([
        supabase.functions.invoke('get-home-feed', { method: 'GET' }),
        fetchCategoryProductIds(categoryId),
      ]);

      if (feedResult.error) {
        throw new Error(await extractEdgeFunctionError(feedResult.error));
      }

      const feedData = feedResult.data?.data || feedResult.data;
      const allProducts: HomeFeedItem[] = feedData?.products || [];

      // 过滤该分类下的商品
      const filteredProducts = allProducts.filter((item) => {
        const productData = item.data as HomeFeedProductData;
        return categoryProductIds.has(productData.inventory_product_id);
      });

      return {
        banners: [],
        categories: feedData?.categories || [],
        products: filteredProducts,
        placements: [],
      };
    },
    staleTime: staleTimes.list,
    enabled: !!categoryId,
  });
}

/**
 * 获取专题详情
 *
 * @param slugOrId - 专题 slug 或 ID
 *
 * [修复说明]
 * Edge Function `get-topic-detail` 使用 GET 方法，slug 通过 URL 查询字符串传递。
 * 原实现使用 POST + body，需要改用 GET 方式。
 */
export function useTopicDetail(slugOrId: string) {
  return useQuery({
    queryKey: homepageQueryKeys.topicDetail(slugOrId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        `get-topic-detail?slug=${encodeURIComponent(slugOrId)}`,
        {
          method: 'GET',
        }
      );

      if (error) {
        throw new Error(await extractEdgeFunctionError(error));
      }

      // Edge Function 返回格式: { success, data: { topic, products }, meta }
      const detailData = data?.data || data;
      return detailData;
    },
    staleTime: staleTimes.detail,
    enabled: !!slugOrId,
  });
}
