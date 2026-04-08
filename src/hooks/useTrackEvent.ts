/**
 * 行为埋点 SDK
 *
 * 提供 trackEvent() 方法和 useExposureTracker() hook。
 * - trackEvent 将事件写入本地队列，批量上报到 track-behavior-event Edge Function
 * - useExposureTracker 基于 IntersectionObserver 自动上报曝光事件
 * - 会话管理：首次加载生成 session_id，30 分钟无操作后自动续期
 *
 * 与现有 usePerformance.ts 中的 useIntersectionObserver 保持一致的 Observer 模式。
 *
 * [审查修复]
 * - 将上报通道从 supabase.rpc() 改为 track-behavior-event Edge Function
 *   原因: RPC 直连需要 authenticated/anon 角色的 INSERT 权限，
 *   而 user_behavior_events 表的 RLS 策略仅允许 anon INSERT（无 SELECT），
 *   但 supabase-js 客户端使用 anon key 时 rpc() 调用 SECURITY DEFINER 函数
 *   可能因网关层权限检查失败。Edge Function 使用 service_role key 调用 RPC，
 *   是文档规定的正确通道。
 * - 改为批量上报模式，减少网络请求数
 * - 增加上报失败时的重试队列（最多重试一次）
 */
import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useUser } from '../contexts/UserContext';
import type { BehaviorEventName, BehaviorEntityType, TrackEventPayload } from '../types/homepage';

// ============================================================
// Session 管理
// ============================================================

const SESSION_KEY = 'dodo_behavior_session_id';
const SESSION_TS_KEY = 'dodo_behavior_session_ts';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 分钟

function generateSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateSessionId(): string {
  const now = Date.now();
  const storedId = sessionStorage.getItem(SESSION_KEY);
  const storedTs = sessionStorage.getItem(SESSION_TS_KEY);

  if (storedId && storedTs && now - Number(storedTs) < SESSION_TIMEOUT) {
    // 续期
    sessionStorage.setItem(SESSION_TS_KEY, String(now));
    return storedId;
  }

  // 新建会话
  const newId = generateSessionId();
  sessionStorage.setItem(SESSION_KEY, newId);
  sessionStorage.setItem(SESSION_TS_KEY, String(now));
  return newId;
}

// ============================================================
// 设备信息采集（仅首次采集，缓存复用）
// ============================================================

let cachedDeviceInfo: Record<string, unknown> | null = null;

function getDeviceInfo(): Record<string, unknown> {
  if (cachedDeviceInfo) return cachedDeviceInfo;
  try {
    cachedDeviceInfo = {
      ua: navigator.userAgent.slice(0, 200),
      lang: navigator.language,
      screen: `${screen.width}x${screen.height}`,
      dpr: window.devicePixelRatio,
      online: navigator.onLine,
    };
  } catch {
    cachedDeviceInfo = {};
  }
  return cachedDeviceInfo;
}

// ============================================================
// 事件队列 & 批量上报
// ============================================================

interface QueuedEvent extends TrackEventPayload {
  _retryCount?: number;
}

const EVENT_QUEUE: QueuedEvent[] = [];
const RETRY_QUEUE: QueuedEvent[] = [];
const FLUSH_INTERVAL = 3000; // 3 秒
const MAX_BATCH_SIZE = 20;
const MAX_RETRY_COUNT = 1; // 最多重试 1 次

let flushTimer: ReturnType<typeof setInterval> | null = null;
let isFlushing = false; // [修复] 防止并发 flush 导致事件重复处理

/**
 * [修复] 通过 Edge Function 批量上报事件
 * 原实现逐条调用 supabase.rpc()，存在以下问题：
 * 1. anon 用户通过 RPC 直连可能被 RLS/网关拦截
 * 2. 逐条上报浪费网络请求
 * 3. Edge Function 已支持批量模式 { events: [...] }
 */
async function flushQueue() {
  // [修复] 防止并发执行（定时器 + beforeunload + visibilitychange 可能同时触发）
  if (isFlushing) return;
  isFlushing = true;

  try {
    // 先处理重试队列
    if (RETRY_QUEUE.length > 0) {
      EVENT_QUEUE.unshift(...RETRY_QUEUE.splice(0));
    }

    if (EVENT_QUEUE.length === 0) return;

    const batch = EVENT_QUEUE.splice(0, MAX_BATCH_SIZE);

    try {
      const { data, error } = await supabase.functions.invoke('track-behavior-event', {
        body: {
          events: batch.map((evt) => ({
            session_id: evt.session_id,
            user_id: evt.user_id || null,
            event_name: evt.event_name,
            page_name: evt.page_name,
            entity_type: evt.entity_type || null,
            entity_id: evt.entity_id || null,
            position: evt.position || null,
            source_page: evt.source_page || null,
            source_topic_id: evt.source_topic_id || null,
            source_placement_id: evt.source_placement_id || null,
            source_category_id: evt.source_category_id || null,
            lottery_id: evt.lottery_id || null,
            inventory_product_id: evt.inventory_product_id || null,
            order_id: evt.order_id || null,
            trace_id: evt.trace_id || null,
            metadata: evt.metadata || {},
            device_info: evt.device_info || null,
          })),
        },
      });

      if (error) {
        console.warn('[TrackEvent] Batch flush failed, queuing for retry:', error.message);
        const retryable = batch.filter(e => (e._retryCount || 0) < MAX_RETRY_COUNT);
        retryable.forEach(e => { e._retryCount = (e._retryCount || 0) + 1; });
        RETRY_QUEUE.push(...retryable);
        if (batch.length > retryable.length) {
          console.warn(`[TrackEvent] Dropped ${batch.length - retryable.length} events after max retries`);
        }
      }
    } catch {
      const retryable = batch.filter(e => (e._retryCount || 0) < MAX_RETRY_COUNT);
      retryable.forEach(e => { e._retryCount = (e._retryCount || 0) + 1; });
      RETRY_QUEUE.push(...retryable);
    }
  } finally {
    isFlushing = false;
  }
}

function ensureFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(flushQueue, FLUSH_INTERVAL);

  // 页面卸载时最后一次 flush
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      flushQueue();
    });
    // visibilitychange 也触发 flush（移动端切后台）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushQueue();
      }
    });
  }
}

// ============================================================
// 公共 API
// ============================================================

/**
 * 将事件推入队列，自动批量上报
 */
export function trackEvent(
  payload: Omit<TrackEventPayload, 'session_id' | 'device_info'>
): void {
  ensureFlushTimer();

  const sessionId = getOrCreateSessionId();
  const deviceInfo = getDeviceInfo();

  EVENT_QUEUE.push({
    ...payload,
    session_id: sessionId,
    device_info: deviceInfo,
  });

  // 如果队列满了立即 flush
  if (EVENT_QUEUE.length >= MAX_BATCH_SIZE) {
    flushQueue();
  }
}

// ============================================================
// React Hooks
// ============================================================

/**
 * 行为埋点 hook
 *
 * 返回 trackEvent 方法，自动注入 user_id。
 * 用法：
 * ```ts
 * const { track } = useTrackEvent();
 * track({ event_name: 'home_view', page_name: 'home' });
 * ```
 */
export function useTrackEvent() {
  const { user } = useUser();
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = user?.id;

  const track = useCallback(
    (payload: Omit<TrackEventPayload, 'session_id' | 'device_info' | 'user_id'> & { user_id?: string }) => {
      trackEvent({
        ...payload,
        user_id: payload.user_id ?? userIdRef.current,
      });
    },
    []
  );

  return { track };
}

/**
 * 曝光追踪 hook
 *
 * 返回一个 ref，绑定到需要追踪曝光的 DOM 元素。
 * 元素进入视口时自动上报一次曝光事件（同一 session 内去重）。
 *
 * 用法：
 * ```tsx
 * const exposureRef = useExposureTracker({
 *   event_name: 'topic_card_expose',
 *   page_name: 'home',
 *   entity_type: 'topic',
 *   entity_id: topic.id,
 * });
 * return <div ref={exposureRef}>...</div>;
 * ```
 */
export function useExposureTracker(
  payload: Omit<TrackEventPayload, 'session_id' | 'device_info' | 'user_id'>,
  options?: { threshold?: number; enabled?: boolean; dwellMs?: number }
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const hasFiredRef = useRef(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useUser();
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = user?.id;

  const enabled = options?.enabled !== false;
  const threshold = options?.threshold ?? 0.5; // 文档规定: 50% 可见
  const dwellMs = options?.dwellMs ?? 300;      // 文档规定: 停留 300ms

  useEffect(() => {
    if (!enabled || !elementRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !hasFiredRef.current) {
          // 元素进入视口，启动停留计时器
          dwellTimerRef.current = setTimeout(() => {
            if (!hasFiredRef.current) {
              hasFiredRef.current = true;
              trackEvent({
                ...payload,
                user_id: userIdRef.current,
              });
              // 曝光只上报一次，之后断开观察
              observer.disconnect();
            }
          }, dwellMs);
        } else if (!entry?.isIntersecting && dwellTimerRef.current) {
          // 元素离开视口，取消计时器（停留时间不足）
          clearTimeout(dwellTimerRef.current);
          dwellTimerRef.current = null;
        }
      },
      { threshold }
    );

    observer.observe(elementRef.current);

    return () => {
      observer.disconnect();
      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
    };
  }, [enabled, threshold, dwellMs, payload.entity_id]); // entity_id 变化时重新绑定

  return elementRef;
}
