/**
 * useUnreadNotifications - 全局未读通知计数 Hook（单例模式）
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
 *
 * 修复说明（2026-05-16）：
 * 原实现中，每个调用 useUnreadNotifications 的组件都会各自创建一个同名的
 * Supabase Realtime channel（`unread-count-${userId}`）。由于 Supabase
 * realtime-js 的 `channel()` 方法对同名 channel 返回已存在的实例，当第二个
 * 组件尝试在已 subscribed 的 channel 上调用 `.on('postgres_changes', ...)`
 * 时，会抛出：
 *   "cannot add `postgres_changes` callbacks for realtime:unread-count-xxx after `subscribe()`"
 *
 * 修复方案：将 realtime 订阅提升为模块级单例，所有组件共享同一个订阅。
 * 使用 useSyncExternalStore 模式让多个组件安全地订阅同一份数据。
 */
import { useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
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

// ─── 模块级单例状态 ───────────────────────────────────────────
let _counts: UnreadCounts = { totalUnread: 0, orderUnread: 0, otherUnread: 0 };
let _listeners: Set<() => void> = new Set();
let _channel: RealtimeChannel | null = null;
let _subscribedUserId: string | null = null;
let _subscriberCount = 0;

function _getSnapshot(): UnreadCounts {
  return _counts;
}

function _subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function _emitChange(newCounts: UnreadCounts) {
  _counts = newCounts;
  _listeners.forEach((listener) => listener());
}

async function _fetchCounts(userId: string) {
  try {
    // 查询总未读数
    const { count: totalCount, error: totalError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    // 查询 B2B 订单相关未读数
    const { count: orderCount, error: orderError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .like('type', 'B2B_%');

    if (!totalError && !orderError) {
      const total = totalCount || 0;
      const order = orderCount || 0;
      _emitChange({
        totalUnread: total,
        orderUnread: order,
        otherUnread: total - order,
      });
    }
  } catch (e) {
    console.error('[useUnreadNotifications] fetch error:', e);
  }
}

function _setupRealtimeChannel(userId: string) {
  // 如果已经为同一用户订阅，直接复用
  if (_channel && _subscribedUserId === userId) {
    return;
  }

  // 清理旧 channel（如果存在）
  _cleanupRealtimeChannel();

  _subscribedUserId = userId;

  // 创建新 channel，先注册 .on() 回调，再调用 .subscribe()
  // 这是 Supabase realtime-js 要求的正确顺序
  _channel = supabase
    .channel(`unread-count-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*', // INSERT, UPDATE, DELETE
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      () => {
        // 任何通知变更都重新计数
        if (_subscribedUserId) {
          _fetchCounts(_subscribedUserId);
        }
      }
    )
    .subscribe();
}

function _cleanupRealtimeChannel() {
  if (_channel) {
    supabase.removeChannel(_channel);
    _channel = null;
    _subscribedUserId = null;
  }
}

// ─── React Hook ───────────────────────────────────────────────

export function useUnreadNotifications() {
  const { user } = useUser();
  const userIdRef = useRef<string | null>(null);

  // 使用 useSyncExternalStore 订阅模块级单例状态
  const counts = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);

  // 管理 realtime 订阅的生命周期
  useEffect(() => {
    const userId = user?.id;

    if (!userId) {
      // 用户未登录，重置计数
      if (userIdRef.current) {
        _subscriberCount--;
        if (_subscriberCount <= 0) {
          _subscriberCount = 0;
          _cleanupRealtimeChannel();
          _emitChange({ totalUnread: 0, orderUnread: 0, otherUnread: 0 });
        }
        userIdRef.current = null;
      }
      return;
    }

    // 用户已登录
    if (userIdRef.current !== userId) {
      // 如果之前跟踪的是另一个用户，先减少引用计数
      if (userIdRef.current) {
        _subscriberCount--;
      }
      userIdRef.current = userId;
      _subscriberCount++;

      // 初始加载计数
      _fetchCounts(userId);

      // 设置 realtime 订阅（单例，多次调用安全）
      _setupRealtimeChannel(userId);
    }

    return () => {
      if (userIdRef.current) {
        _subscriberCount--;
        if (_subscriberCount <= 0) {
          _subscriberCount = 0;
          _cleanupRealtimeChannel();
        }
        userIdRef.current = null;
      }
    };
  }, [user?.id]);

  // 手动刷新
  const refresh = useCallback(() => {
    if (user?.id) {
      _fetchCounts(user.id);
    }
  }, [user?.id]);

  return {
    ...counts,
    refresh,
  };
}
