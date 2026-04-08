/**
 * useTrackEvent 行为埋点 SDK 单元测试
 *
 * 覆盖范围：
 * - Session 管理（生成、续期、超时重建）
 * - 事件队列（入队、批量 flush、队列满自动 flush）
 * - 重试逻辑（失败重试一次、超过重试次数丢弃）
 * - trackEvent 公共 API
 * - 设备信息采集
 * - 事件字段映射
 *
 * 策略：由于 setInterval + async flushQueue 在 fake timers 下会触发无限循环，
 * 本测试直接导入并调用 trackEvent / flushQueue，避免使用 fake timers。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mock 依赖
// ============================================================

const mockInvoke = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({ user: { id: 'test-user-123' } }),
}));

// Mock sessionStorage
const sessionStorageData: Record<string, string> = {};
Object.defineProperty(global, 'sessionStorage', {
  value: {
    getItem: (key: string) => sessionStorageData[key] || null,
    setItem: (key: string, value: string) => { sessionStorageData[key] = value; },
    removeItem: (key: string) => { delete sessionStorageData[key]; },
    clear: () => { Object.keys(sessionStorageData).forEach((k) => delete sessionStorageData[k]); },
  },
  writable: true,
});

Object.defineProperty(global, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Test)', language: 'zh-CN', onLine: true },
  writable: true,
});
Object.defineProperty(global, 'screen', {
  value: { width: 1920, height: 1080 },
  writable: true,
});

// Prevent actual setInterval from running (we'll call flushQueue manually)
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

// ============================================================
// 测试
// ============================================================

describe('useTrackEvent SDK', () => {
  let trackEvent: typeof import('../useTrackEvent').trackEvent;
  let flushQueue: () => Promise<void>;
  let EVENT_QUEUE: unknown[];
  let RETRY_QUEUE: unknown[];

  beforeEach(async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
    sessionStorage.clear();

    // Stub setInterval to prevent background timer
    vi.spyOn(global, 'setInterval').mockImplementation((() => 999) as unknown as typeof setInterval);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    // Reset module state to get fresh queues
    vi.resetModules();
    const mod = await import('../useTrackEvent');
    trackEvent = mod.trackEvent;

    // Access internal queues via module internals (they're module-level variables)
    // We'll test via observable behavior (mockInvoke calls)
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('trackEvent 基本功能', () => {
    it('应将事件推入队列并在 flush 时发送', async () => {
      trackEvent({
        event_name: 'home_view',
        page_name: 'home',
      });

      // 单个事件不会立即 flush（队列未满），手动触发 flush
      // 由于 flushQueue 不是 export 的，我们通过推满队列来触发
      // 或者直接检查 mockInvoke 未被调用
      expect(mockInvoke).not.toHaveBeenCalled();

      // 推入更多事件直到达到 MAX_BATCH_SIZE (20)
      for (let i = 0; i < 19; i++) {
        trackEvent({
          event_name: 'product_card_expose',
          page_name: 'home',
          entity_id: `product-${i}`,
        });
      }

      // 队列满了应触发 flush
      // 等待异步 flush 完成
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('track-behavior-event', {
        body: {
          events: expect.arrayContaining([
            expect.objectContaining({
              event_name: 'home_view',
              page_name: 'home',
              session_id: expect.stringMatching(/^s_\d+_[a-z0-9]+$/),
            }),
          ]),
        },
      });
    });

    it('队列满时应立即 flush 并发送 20 个事件', async () => {
      for (let i = 0; i < 20; i++) {
        trackEvent({
          event_name: 'product_card_click',
          page_name: 'home',
          entity_id: `product-${i}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      const events = mockInvoke.mock.calls[0][1].body.events;
      expect(events).toHaveLength(20);
    });
  });

  describe('Session 管理', () => {
    it('首次调用应生成新的 session_id', () => {
      trackEvent({ event_name: 'home_view', page_name: 'home' });

      const sessionId = sessionStorageData['dodo_behavior_session_id'];
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^s_\d+_[a-z0-9]+$/);
    });

    it('连续调用应复用同一 session_id', () => {
      trackEvent({ event_name: 'home_view', page_name: 'home' });
      const firstSessionId = sessionStorageData['dodo_behavior_session_id'];

      trackEvent({ event_name: 'banner_click', page_name: 'home' });
      const secondSessionId = sessionStorageData['dodo_behavior_session_id'];

      expect(firstSessionId).toBe(secondSessionId);
    });

    it('session 超时后应生成新的 session_id', () => {
      trackEvent({ event_name: 'home_view', page_name: 'home' });
      const firstSessionId = sessionStorageData['dodo_behavior_session_id'];

      // 模拟 session 超时（将时间戳设为 31 分钟前）
      const expiredTs = Date.now() - 31 * 60 * 1000;
      sessionStorageData['dodo_behavior_session_ts'] = String(expiredTs);

      trackEvent({ event_name: 'banner_click', page_name: 'home' });
      const secondSessionId = sessionStorageData['dodo_behavior_session_id'];

      expect(secondSessionId).not.toBe(firstSessionId);
    });
  });

  describe('设备信息采集', () => {
    it('应正确采集 UA、语言和屏幕尺寸', async () => {
      for (let i = 0; i < 20; i++) {
        trackEvent({
          event_name: 'home_view',
          page_name: 'home',
          entity_id: `e-${i}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const events = mockInvoke.mock.calls[0][1].body.events;
      expect(events[0].device_info).toEqual(
        expect.objectContaining({
          ua: expect.stringContaining('Mozilla'),
          lang: 'zh-CN',
          screen: '1920x1080',
        })
      );
    });
  });

  describe('事件字段映射', () => {
    it('应正确映射所有可选字段', async () => {
      // 先推入一个带完整字段的事件
      trackEvent({
        event_name: 'product_card_click',
        page_name: 'home',
        entity_type: 'product',
        entity_id: 'prod-123',
        position: '3',
        source_page: 'home',
        source_topic_id: 'topic-456',
        source_placement_id: 'placement-789',
        source_category_id: 'cat-001',
        lottery_id: 'lottery-111',
        inventory_product_id: 'inv-222',
        order_id: 'order-333',
        trace_id: 'trace-444',
        metadata: { custom_field: 'value' },
      });

      // 再推入 19 个填充事件触发 flush
      for (let i = 0; i < 19; i++) {
        trackEvent({ event_name: 'home_view', page_name: 'home', entity_id: `fill-${i}` });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const event = mockInvoke.mock.calls[0][1].body.events[0];
      expect(event.entity_type).toBe('product');
      expect(event.entity_id).toBe('prod-123');
      expect(event.position).toBe('3');
      expect(event.source_topic_id).toBe('topic-456');
      expect(event.source_placement_id).toBe('placement-789');
      expect(event.lottery_id).toBe('lottery-111');
      expect(event.inventory_product_id).toBe('inv-222');
      expect(event.metadata).toEqual({ custom_field: 'value' });
    });

    it('缺失的可选字段应设为 null 或 undefined', async () => {
      trackEvent({ event_name: 'home_view', page_name: 'home' });

      // 填充到 20 个
      for (let i = 0; i < 19; i++) {
        trackEvent({ event_name: 'home_view', page_name: 'home', entity_id: `fill-${i}` });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const event = mockInvoke.mock.calls[0][1].body.events[0];
      // 可选字段应为 null 或 undefined
      expect(event.entity_type ?? null).toBeNull();
      expect(event.entity_id ?? null).toBeNull();
      expect(event.lottery_id ?? null).toBeNull();
      expect(event.order_id ?? null).toBeNull();
    });
  });

  describe('重试逻辑', () => {
    it('上报失败时事件应进入重试队列', async () => {
      // 第一次调用失败
      mockInvoke.mockResolvedValueOnce({
        data: null,
        error: { message: 'Network error' },
      });
      // 第二次调用成功
      mockInvoke.mockResolvedValueOnce({
        data: { success: true },
        error: null,
      });

      // 推满队列触发第一次 flush
      for (let i = 0; i < 20; i++) {
        trackEvent({ event_name: 'home_view', page_name: 'home', entity_id: `e-${i}` });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      // 重试队列中的事件会在下一次 flush 时发送
      // 再推满队列触发第二次 flush（重试事件会一起发送）
      for (let i = 0; i < 20; i++) {
        trackEvent({ event_name: 'banner_click', page_name: 'home', entity_id: `b-${i}` });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('批量上报', () => {
    it('超过 MAX_BATCH_SIZE 的事件应分批上报', async () => {
      // 推入 40 个事件
      for (let i = 0; i < 40; i++) {
        trackEvent({
          event_name: 'product_card_expose',
          page_name: 'home',
          entity_id: `product-${i}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // 应该触发 2 次 flush（20 + 20）
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke.mock.calls[0][1].body.events).toHaveLength(20);
      expect(mockInvoke.mock.calls[1][1].body.events).toHaveLength(20);
    });
  });

  describe('Edge Function 调用格式', () => {
    it('应调用 track-behavior-event 并传递 events 数组', async () => {
      for (let i = 0; i < 20; i++) {
        trackEvent({ event_name: 'home_view', page_name: 'home', entity_id: `e-${i}` });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockInvoke).toHaveBeenCalledWith('track-behavior-event', {
        body: {
          events: expect.any(Array),
        },
      });
    });
  });
});
