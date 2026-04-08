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
 * @param categoryId - 可选的分类 ID，用于筛选商品
 */
export function useHomeFeed(categoryId?: string) {
  return useQuery<HomeFeedResponse>({
    queryKey: homepageQueryKeys.homeFeed(categoryId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-home-feed', {
        body: {
          category_id: categoryId || null,
          limit: 20,
          offset: 0,
        },
      });

      if (error) {
        throw new Error(await extractEdgeFunctionError(error));
      }

      // 确保返回结构完整
      return {
        banners: data?.banners || [],
        categories: data?.categories || [],
        products: data?.products || [],
        placements: data?.placements || [],
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
 */
export function useTopicDetail(slugOrId: string) {
  return useQuery({
    queryKey: homepageQueryKeys.topicDetail(slugOrId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-topic-detail', {
        body: { slug: slugOrId },
      });

      if (error) {
        throw new Error(await extractEdgeFunctionError(error));
      }

      return data;
    },
    staleTime: staleTimes.detail,
    enabled: !!slugOrId,
  });
}
