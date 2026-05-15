/**
 * useUnreadNotifications - 全局未读通知计数 Hook
 *
 * 功能：
 * - 查询 notifications 表中当前用户的未读通知数量
 * - 通过 Supabase Realtime 监听新通知插入，自动更新计数
 * - 提供 unreadCount（总未读数）和 unreadOrderCount（B2B订单未读数）
 * - 提供 markAllRead 方法用于清零
 *
 * 使用场景：
 * - 底部导航"我的"入口角标
 * - ProfilePage 中"订单管理"和"通知"入口的小红点/数字角标
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UnreadCounts {
  /** 总未读通知数 */
  totalUnread: number;
  /** B2B 订单相关未读通知数 */
  orderUnread: number;
  /** 其他类型未读通知数 */
  otherUnread: number;
}

export function useUnreadNotifications() {
  const { supabase } = useSupabase();
  const { user } = useUser();
  const [counts, setCounts] = useState<UnreadCounts>({
    totalUnread: 0,
    orderUnread: 0,
    otherUnread: 0,
  });
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!user?.id) {
      setCounts({ totalUnread: 0, orderUnread: 0, otherUnread: 0 });
      return;
    }

    try {
      // 查询总未读数
      const { count: totalCount, error: totalError } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      // 查询 B2B 订单相关未读数
      const { count: orderCount, error: orderError } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .like('type', 'B2B_%');

      if (!totalError && !orderError) {
        const total = totalCount || 0;
        const order = orderCount || 0;
        setCounts({
          totalUnread: total,
          orderUnread: order,
          otherUnread: total - order,
        });
      }
    } catch (e) {
      console.error('[useUnreadNotifications] fetch error:', e);
    }
  }, [user?.id, supabase]);

  // 初始加载
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // 实时订阅：新通知插入或通知被标记为已读时刷新计数
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`unread-count-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // 任何通知变更都重新计数
          fetchCounts();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, supabase, fetchCounts]);

  // 标记所有为已读后刷新
  const refresh = useCallback(() => {
    fetchCounts();
  }, [fetchCounts]);

  return {
    ...counts,
    refresh,
  };
}
