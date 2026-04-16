import { useEffect, useRef, useState, useCallback } from 'react';
import { SUPABASE_URL } from '@/lib/supabase';

export interface RealtimeNotification {
  type: 'connected' | 'notification' | 'group_buy_update' | 'balance_update' | 'heartbeat';
  data?: any;
  timestamp: string;
}

export interface UseRealtimeNotificationsOptions {
  enabled?: boolean;
  userId?: string | null;
  sessionToken?: string | null;
  onNotification?: (notification: RealtimeNotification) => void;
  onBalanceUpdate?: (balance: { balance: number; frozen_balance: number; currency: string }) => void;
  onGroupBuyUpdate?: (session: any) => void;
  onError?: (error: Error) => void;
}

export function useRealtimeNotifications(options: UseRealtimeNotificationsOptions = {}) {
  const {
    enabled = true,
    userId,
    sessionToken,
    onNotification,
    onBalanceUpdate,
    onGroupBuyUpdate,
    onError
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<RealtimeNotification | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(async () => {
    if (!enabled) {return;}

    // 使用传入的 userId（来自 UserContext），不再依赖 supabase.auth
    if (!userId) {
      console.warn('No user ID provided, skipping realtime notifications');
      return;
    }

    try {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Get Supabase URL from config
      const supabaseUrl = SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL not configured');
      }

      // Create SSE connection（传递 session_token 用于服务端验证）
      let url = `${supabaseUrl}/functions/v1/realtime-notifications?user_id=${userId}`;
      if (sessionToken) {
        url += `&session_token=${sessionToken}`;
      }
      // 注意：EventSource 不支持自定义 header，且当前环境存在 CORS 限制
      // 如果 Edge Function 未配置 CORS 允许 cache-control header，连接会失败
      // 失败后会不断重试，影响性能。这里保持连接逻辑但错误不会导致应用崩溃
      const eventSource = new EventSource(url);

      eventSource.onopen = () => {
        console.log('Realtime notifications connected');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data: RealtimeNotification = JSON.parse(event.data);
          setLastMessage(data);

          // Handle different notification types
          switch (data.type) {
            case 'connected':
              console.log('SSE connection established');
              break;

            case 'notification':
              console.log('New notification received:', data.data);
              onNotification?.(data);
              break;

            case 'balance_update':
              console.log('Balance updated:', data.data);
              onBalanceUpdate?.(data.data);
              break;

            case 'group_buy_update':
              console.log('Group buy session updated:', data.data);
              onGroupBuyUpdate?.(data.data);
              break;

            case 'heartbeat':
              // Heartbeat to keep connection alive
              break;

            default:
              console.log('Unknown notification type:', data.type);
          }
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        setIsConnected(false);
        eventSource.close();

        // Attempt to reconnect with exponential backoff
        const maxAttempts = 5;
        const baseDelay = 1000;
        const maxDelay = 30000;

        if (reconnectAttemptsRef.current < maxAttempts) {
          const delay = Math.min(
            baseDelay * Math.pow(2, reconnectAttemptsRef.current),
            maxDelay
          );

          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxAttempts})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else {
          console.error('Max reconnection attempts reached');
          onError?.(new Error('Failed to establish realtime connection'));
        }
      };

      eventSourceRef.current = eventSource;

    } catch (error) {
      console.error('Error connecting to realtime notifications:', error);
      onError?.(error as Error);
    }
  }, [enabled, userId, sessionToken, onNotification, onBalanceUpdate, onGroupBuyUpdate, onError]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setIsConnected(false);
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    reconnect: connect,
    disconnect
  };
}
