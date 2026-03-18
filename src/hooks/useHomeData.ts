import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '../contexts/SupabaseContext';
import { supabase, Lottery } from '../lib/supabase';
import { queryKeys } from '../lib/react-query';
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
 * 使用 react-query 管理缓存、自动重试和后台刷新
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
    // 5 分钟内数据视为新鲜，不会重新请求
    staleTime: 1000 * 60 * 5,
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
    // 5 分钟内数据视为新鲜
    staleTime: 1000 * 60 * 5,
  });
}
