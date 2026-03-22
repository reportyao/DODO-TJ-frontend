import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '../contexts/SupabaseContext';
import { supabase, Lottery } from '../lib/supabase';
import { queryKeys, staleTimes } from '../lib/react-query';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

interface GroupBuyProduct {
  id: string;
  title: { zh: string; ru: string; tg: string };
  description: { zh: string; ru: string; tg: string };
  image_url: string;
  original_price: number;
  price_per_person: number;
  group_size: number;
  timeout_hours: number;
  active_sessions_count: number;
  created_at?: string;
}

/**
 * 首页商城数据 hook
 * 
 * 【性能优化】
 * - staleTime 5分钟：商品列表变化不频繁，减少不必要的网络请求
 * - placeholderData：页面切换时立即显示上次数据，后台静默刷新
 * - networkMode offlineFirst：弱网/离线时优先返回缓存
 */
export function useLotteries() {
  const { lotteryService } = useSupabase();

  return useQuery<Lottery[]>({
    queryKey: queryKeys.lotteries.lists(),
    queryFn: async () => {
      const data = await lotteryService.getActiveLotteries();
      // 按创建时间从新到旧排序
      return [...data].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    staleTime: staleTimes.list,
    // 保留上次成功的数据作为占位，避免页面切换时闪白
    placeholderData: (previousData) => previousData,
  });
}

/**
 * 首页拼团数据 hook
 * 使用 react-query 管理缓存、自动重试和后台刷新
 */
export function useGroupBuyProducts() {
  return useQuery<GroupBuyProduct[]>({
    queryKey: ['groupBuyProducts', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('group-buy-list', {
        body: { type: 'products' },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (data?.success) {
        // 按创建时间从新到旧排序
        return [...data.data].sort(
          (a: GroupBuyProduct, b: GroupBuyProduct) =>
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
      }
      return [];
    },
    staleTime: staleTimes.list,
    placeholderData: (previousData) => previousData,
  });
}
