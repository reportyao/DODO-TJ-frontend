/**
 * 行为埋点 SDK
 *
 * 提供 trackEvent() 方法和 useExposureTracker() hook。
 * - trackEvent 将事件写入本地队列，批量上报到 rpc_track_behavior_event
 * - useExposureTracker 基于 IntersectionObserver 自动上报曝光事件
 * - 会话管理：首次加载生成 session_id，30 分钟无操作后自动续期
 *
 * 与现有 usePerformance.ts 中的 useIntersectionObserver 保持一致的 Observer 模式。
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

const EVENT_QUEUE: TrackEventPayload[] = [];
const FLUSH_INTERVAL = 3000; // 3 秒
const MAX_BATCH_SIZE = 20;

let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flushQueue() {
  if (EVENT_QUEUE.length === 0) return;

  const batch = EVENT_QUEUE.splice(0, MAX_BATCH_SIZE);

  try {
    // 逐条上报（RPC 单条接口），后续可改为批量 Edge Function
    const promises = batch.map((evt) =>
      supabase.rpc('rpc_track_behavior_event', {
        p_session_id: evt.session_id,
        p_user_id: evt.user_id || null,
        p_event_name: evt.event_name,
        p_page_name: evt.page_name,
        p_entity_type: evt.entity_type || null,
        p_entity_id: evt.entity_id || null,
        p_position: evt.position || null,
        p_source_page: evt.source_page || null,
        p_source_topic_id: evt.source_topic_id || null,
        p_source_placement_id: evt.source_placement_id || null,
        p_source_category_id: evt.source_category_id || null,
        p_lottery_id: evt.lottery_id || null,
        p_inventory_product_id: evt.inventory_product_id || null,
        p_order_id: evt.order_id || null,
        p_trace_id: evt.trace_id || null,
        p_metadata: evt.metadata || {},
        p_device_info: evt.device_info || null,
      })
    );

    await Promise.allSettled(promises);
  } catch {
    // 上报失败不阻塞业务，静默丢弃
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
  const userIdRef = useRef<string | undefined>();
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
  options?: { threshold?: number; enabled?: boolean }
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const hasFiredRef = useRef(false);
  const { user } = useUser();
  const userIdRef = useRef<string | undefined>();
  userIdRef.current = user?.id;

  const enabled = options?.enabled !== false;
  const threshold = options?.threshold ?? 0.3;

  useEffect(() => {
    if (!enabled || !elementRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !hasFiredRef.current) {
          hasFiredRef.current = true;
          trackEvent({
            ...payload,
            user_id: userIdRef.current,
          });
          // 曝光只上报一次，之后断开观察
          observer.disconnect();
        }
      },
      { threshold }
    );

    observer.observe(elementRef.current);

    return () => {
      observer.disconnect();
    };
  }, [enabled, threshold, payload.entity_id]); // entity_id 变化时重新绑定

  return elementRef;
}
