/**
 * useB2BOrderRealtime - B2B 订单实时订阅 Hook
 *
 * 功能：
 * - 通过 Supabase Realtime 监听 b2b_orders 表的 UPDATE 事件
 * - 当订单状态变更时自动刷新订单列表
 * - 同时监听 notifications 表的 INSERT 事件，收到新通知时显示 toast
 * - 为批发商提供实时的订单进度感知
 *
 * 使用方式：
 *   const { isSubscribed } = useB2BOrderRealtime({ userId, onOrderUpdate, onNotification });
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useTranslation } from 'react-i18next';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface B2BOrderUpdate {
  id: string;
  order_number: string;
  fulfillment_status: string;
  payment_status: string;
  status: string;
  total_amount: number;
  updated_at: string;
}

export interface B2BNotification {
  id: string;
  type: string;
  title: string;
  content: string;
  title_i18n?: Record<string, string>;
  message_i18n?: Record<string, string>;
  data?: Record<string, any>;
  related_id?: string;
  created_at: string;
}

export interface UseB2BOrderRealtimeOptions {
  /** 当前用户 ID */
  userId?: string | null;
  /** 是否启用实时订阅 */
  enabled?: boolean;
  /** 订单更新回调 */
  onOrderUpdate?: (order: B2BOrderUpdate) => void;
  /** 新通知回调 */
  onNotification?: (notification: B2BNotification) => void;
}

export function useB2BOrderRealtime(options: UseB2BOrderRealtimeOptions = {}) {
  const { userId, enabled = true, onOrderUpdate, onNotification } = options;
  const { supabase } = useSupabase();
  const { i18n } = useTranslation();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbacksRef = useRef({ onOrderUpdate, onNotification });

  // 保持回调引用最新
  useEffect(() => {
    callbacksRef.current = { onOrderUpdate, onNotification };
  }, [onOrderUpdate, onNotification]);

  const subscribe = useCallback(() => {
    if (!enabled || !userId || !supabase) return;

    // 清理旧连接
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`b2b-orders-${userId}`)
      // 监听 b2b_orders 表的 UPDATE 事件（过滤当前用户）
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'b2b_orders',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRecord = payload.new as B2BOrderUpdate;
          callbacksRef.current.onOrderUpdate?.(newRecord);
        }
      )
      // 监听 notifications 表的 INSERT 事件（过滤当前用户的 B2B 通知）
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const notification = payload.new as B2BNotification;
          // 只处理 B2B 相关通知
          if (notification.type?.startsWith('B2B_')) {
            callbacksRef.current.onNotification?.(notification);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsSubscribed(true);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setIsSubscribed(false);
        }
      });

    channelRef.current = channel;
  }, [enabled, userId, supabase]);

  // 订阅/取消订阅
  useEffect(() => {
    subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        setIsSubscribed(false);
      }
    };
  }, [subscribe, supabase]);

  return {
    isSubscribed,
    resubscribe: subscribe,
  };
}
