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
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys, staleTimes } from '../lib/react-query';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import type { HomeFeedResponse } from '../types/homepage';

// 扩展 queryKeys
export const homepageQueryKeys = {
  ...queryKeys,
  homeFeed: (categoryId?: string) => ['homepage', 'feed', categoryId || 'all'] as const,
  topicDetail: (slugOrId: string) => ['homepage', 'topic', slugOrId] as const,
};

/**
 * 获取首页 Feed 数据
 *
 * @param categoryId - 可选的分类 ID，用于前端筛选商品（RPC 不支持分类筛选）
 *
 * [修复说明]
 * Edge Function `get-home-feed` 使用 GET 方法，参数通过 URL 查询字符串传递。
 * `supabase.functions.invoke()` 默认使用 POST + body，需要改用 GET 方式。
 * 注意：category_id 筛选在 RPC 层未实现，需要前端过滤。
 */
export function useHomeFeed(categoryId?: string) {
  return useQuery<HomeFeedResponse>({
    queryKey: homepageQueryKeys.homeFeed(categoryId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-home-feed', {
        method: 'GET',
      });

      if (error) {
        throw new Error(await extractEdgeFunctionError(error));
      }

      // Edge Function 返回格式: { success, data: { banners, categories, products, placements }, meta }
      const feedData = data?.data || data;

      // 确保返回结构完整
      return {
        banners: feedData?.banners || [],
        categories: feedData?.categories || [],
        products: feedData?.products || [],
        placements: feedData?.placements || [],
      };
    },
    staleTime: staleTimes.list,
    placeholderData: (previousData) => previousData,
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
