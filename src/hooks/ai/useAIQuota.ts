import { useState, useEffect, useCallback, useRef } from 'react';
import { aiService, AIQuota } from '../../lib/aiService';
import { useUser } from '../../contexts/UserContext';

export interface UseAIQuotaReturn {
  quota: {
    total: number;
    remaining: number;
    used: number;
    base: number;
    bonus: number;
  };
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const DEFAULT_QUOTA = {
  total_quota: 10,
  used_quota: 0,
  remaining_quota: 10,
  base_quota: 10,
  bonus_quota: 0,
};

// 最大连续失败次数，超过后停止轮询
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * AI 配额管理 Hook
 * 带失败退避机制：连续失败 MAX_CONSECUTIVE_FAILURES 次后停止轮询，避免刷屏
 */
export function useAIQuota(): UseAIQuotaReturn {
  const { user } = useUser();
  const [quotaData, setQuotaData] = useState<AIQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const failureCountRef = useRef(0);
  const pollingStoppedRef = useRef(false);

  const fetchQuota = useCallback(async (isManual = false) => {
    if (!user) {
      setQuotaData(null);
      return;
    }

    // 如果轮询已被停止（非手动触发），直接跳过
    if (pollingStoppedRef.current && !isManual) {
      return;
    }

    setLoading(true);
    if (isManual) {
      setError(null);
    }

    try {
      const data = await aiService.getQuota();
      setQuotaData(data);
      setError(null);
      // 成功后重置失败计数
      failureCountRef.current = 0;
      pollingStoppedRef.current = false;
    } catch (err) {
      failureCountRef.current += 1;

      // 超过最大失败次数，停止轮询，静默降级
      if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        pollingStoppedRef.current = true;
        // 仅在手动触发时才记录错误，避免刷屏
        if (isManual) {
          console.warn('[useAIQuota] Quota fetch failed, using default values');
          setError(err as Error);
        }
      }

      // 设置默认值，保证 UI 正常显示
      setQuotaData(prev => prev ?? DEFAULT_QUOTA);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 手动触发版本（供 refetch 使用）
  const refetch = useCallback(async () => {
    pollingStoppedRef.current = false;
    failureCountRef.current = 0;
    await fetchQuota(true);
  }, [fetchQuota]);

  // 初始加载和用户变化时刷新
  useEffect(() => {
    // 用户变化时重置失败计数
    failureCountRef.current = 0;
    pollingStoppedRef.current = false;
    fetchQuota(true);
  }, [fetchQuota]);

  // 定时刷新（每5分钟，减少请求频率）
  useEffect(() => {
    if (!user) {return;}

    const interval = setInterval(() => {
      fetchQuota(false);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, fetchQuota]);

  // 转换为组件使用的格式
  const quota = quotaData ? {
    total: quotaData.total_quota,
    remaining: quotaData.remaining_quota,
    used: quotaData.used_quota,
    base: quotaData.base_quota,
    bonus: quotaData.bonus_quota,
  } : {
    total: 10,
    remaining: 10,
    used: 0,
    base: 10,
    bonus: 0,
  };

  return {
    quota,
    loading,
    error,
    refetch,
  };
}
