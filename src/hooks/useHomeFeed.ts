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
 * [性能优化 v3]
 * - useCategoryProducts 不再重复调用 get-home-feed，改为从 queryClient 读取缓存
 * - 分类-商品映射关系独立缓存（staleTimes.static = 30分钟），避免每次分类切换都查数据库
 * - 提取 fetchHomeFeedData 公共函数，消除 useHomeFeed 和 useCategoryProducts 的代码重复
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys, staleTimes } from '../lib/react-query';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import type { HomeFeedResponse, HomeFeedItem, HomeFeedProductData } from '../types/homepage';

// 扩展 queryKeys
export const homepageQueryKeys = {
  ...queryKeys,
  homeFeed: (categoryId?: string) => ['homepage', 'feed', categoryId || 'all'] as const,
  homeFeedBase: () => ['homepage', 'feed', 'all'] as const,
  topicDetail: (slugOrId: string) => ['homepage', 'topic', slugOrId] as const,
  categoryProducts: (categoryId: string) => ['homepage', 'category-products', categoryId] as const,
  categoryMapping: (categoryId: string) => ['homepage', 'category-mapping', categoryId] as const,
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
 * 从 Edge Function 获取原始 feed 数据
 */
async function fetchHomeFeedData(): Promise<HomeFeedResponse> {
  const feedResult = await supabase.functions.invoke('get-home-feed', { method: 'GET' });

  if (feedResult.error) {
    throw new Error(await extractEdgeFunctionError(feedResult.error));
  }

  // Edge Function 返回格式: { success, data: { banners, categories, products, placements }, meta }
  const feedData = feedResult.data?.data || feedResult.data;

  return {
    banners: feedData?.banners || [],
    categories: feedData?.categories || [],
    products: feedData?.products || [],
    placements: feedData?.placements || [],
  };
}

/**
 * 按分类过滤商品列表
 */
function filterProductsByCategory(
  products: HomeFeedItem[],
  categoryProductIds: Set<string>,
): HomeFeedItem[] {
  return products.filter((item) => {
    const productData = item.data as HomeFeedProductData;
    return categoryProductIds.has(productData.inventory_product_id);
  });
}

/**
 * 获取首页 Feed 数据
 *
 * @param categoryId - 可选的分类 ID，用于前端筛选商品
 *
 * 当 categoryId 存在时，会额外查询 product_categories 表获取该分类下的商品ID，
 * 然后在前端过滤 feed 中的商品列表。
 */
export function useHomeFeed(categoryId?: string) {
  const queryClient = useQueryClient();

  return useQuery<HomeFeedResponse>({
    queryKey: homepageQueryKeys.homeFeed(categoryId),
    queryFn: async () => {
      const cachedBaseFeed = queryClient.getQueryData<HomeFeedResponse>(
        homepageQueryKeys.homeFeedBase(),
      );

      const feedData = categoryId && cachedBaseFeed
        ? cachedBaseFeed
        : await queryClient.fetchQuery({
            queryKey: homepageQueryKeys.homeFeedBase(),
            queryFn: fetchHomeFeedData,
            staleTime: staleTimes.list,
          });

      // 如果有分类筛选，只额外查询分类映射并在前端过滤
      let filteredProducts = feedData.products;
      if (categoryId) {
        const categoryProductIds = await queryClient.fetchQuery({
          queryKey: homepageQueryKeys.categoryMapping(categoryId),
          queryFn: () => fetchCategoryProductIds(categoryId),
          staleTime: staleTimes.static,
        });

        filteredProducts = filterProductsByCategory(feedData.products, categoryProductIds);
      }

      return {
        ...feedData,
        products: filteredProducts,
      };
    },
    staleTime: staleTimes.list,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * 获取指定分类下的商品列表（用于独立的分类商品列表页）
 *
 * [v3 性能优化] 优先从 queryClient 缓存中读取 homeFeed 基础数据，
 * 避免每次分类切换都重新调用 get-home-feed Edge Function。
 * 仅在缓存不存在时才发起网络请求。
 *
 * @param categoryId - 分类 ID
 */
export function useCategoryProducts(categoryId: string) {
  const queryClient = useQueryClient();

  return useQuery<HomeFeedResponse>({
    queryKey: homepageQueryKeys.categoryProducts(categoryId),
    queryFn: async () => {
      // 优先从 queryClient 缓存读取基础 feed 数据
      let baseFeed = queryClient.getQueryData<HomeFeedResponse>(
        homepageQueryKeys.homeFeedBase(),
      );

      // 缓存未命中时才发起网络请求
      if (!baseFeed) {
        baseFeed = await fetchHomeFeedData();
      }

      // 获取分类映射（独立缓存）
      const categoryProductIds = await queryClient.fetchQuery({
        queryKey: homepageQueryKeys.categoryMapping(categoryId),
        queryFn: () => fetchCategoryProductIds(categoryId),
        staleTime: staleTimes.static, // 30分钟缓存
      });

      const filteredProducts = filterProductsByCategory(
        baseFeed.products,
        categoryProductIds,
      );

      return {
        banners: [],
        categories: baseFeed.categories,
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
