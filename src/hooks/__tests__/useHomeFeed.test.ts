/**
 * useHomeFeed / useCategoryProducts / useTopicDetail 单元测试
 *
 * 覆盖范围：
 * - homepageQueryKeys 缓存键生成
 * - useHomeFeed: 数据获取、分类筛选、错误处理
 * - useCategoryProducts: 分类商品独立查询
 * - useTopicDetail: 专题详情获取
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HomeFeedResponse, HomeFeedItem, HomeFeedProductData } from '../../types/homepage';

// ============================================================
// Mock 依赖
// ============================================================

const mockInvoke = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    from: (...args: unknown[]) => {
      mockFrom(...args);
      return {
        select: (...sArgs: unknown[]) => {
          mockSelect(...sArgs);
          return {
            eq: (...eArgs: unknown[]) => mockEq(...eArgs),
          };
        },
      };
    },
  },
}));

vi.mock('../../utils/edgeFunctionHelper', () => ({
  extractEdgeFunctionError: async (error: { message?: string }) =>
    error?.message || 'Unknown error',
}));

vi.mock('../../lib/react-query', () => ({
  queryKeys: {},
  staleTimes: {
    static: 1800000,
    list: 300000,
    realtime: 60000,
    detail: 180000,
  },
}));

// ============================================================
// 测试数据
// ============================================================

const mockFeedData = {
  banners: [
    { id: 'b1', title: '测试Banner', image_url: 'https://cdn.example.com/b1.jpg', link_url: '/test', sort_order: 0, start_time: null, end_time: null },
  ],
  categories: [
    { id: 'cat-1', code: 'daily_goods', name_i18n: { zh: '日用百货', ru: 'Товары', tg: 'Молҳо' }, icon_key: 'icon_daily_goods', color_token: '#FF6B35', sort_order: 0, is_active: true },
  ],
  products: [
    {
      type: 'product' as const,
      item_id: 'prod-1',
      data: {
        lottery_id: 'lot-1',
        inventory_product_id: 'inv-1',
        title_i18n: { zh: '商品1', ru: 'Товар 1', tg: 'Мол 1' },
        description_i18n: { zh: '描述', ru: 'Описание', tg: 'Тавсиф' },
        image_url: 'https://cdn.example.com/p1.jpg',
        image_urls: [],
        original_price: 100,
        ticket_price: 10,
        total_tickets: 100,
        sold_tickets: 50,
        price_comparisons: [],
        currency: 'TJS',
        full_purchase_enabled: false,
        full_purchase_price: null,
        status: 'active',
      } as HomeFeedProductData,
    },
    {
      type: 'product' as const,
      item_id: 'prod-2',
      data: {
        lottery_id: 'lot-2',
        inventory_product_id: 'inv-2',
        title_i18n: { zh: '商品2', ru: 'Товар 2', tg: 'Мол 2' },
        description_i18n: { zh: '描述2', ru: 'Описание 2', tg: 'Тавсиф 2' },
        image_url: 'https://cdn.example.com/p2.jpg',
        image_urls: [],
        original_price: 200,
        ticket_price: 20,
        total_tickets: 50,
        sold_tickets: 25,
        price_comparisons: [],
        currency: 'TJS',
        full_purchase_enabled: true,
        full_purchase_price: 180,
        status: 'active',
      } as HomeFeedProductData,
    },
  ] as HomeFeedItem[],
  placements: [
    {
      type: 'topic' as const,
      item_id: 'topic-1',
      data: {
        topic_id: 'topic-1',
        placement_id: 'pl-1',
        slug: 'test-topic',
        title_i18n: { zh: '测试专题', ru: 'Тест', tg: 'Тест' },
        subtitle_i18n: null,
        cover_image_default: 'https://cdn.example.com/topic.jpg',
        cover_image_zh: null,
        cover_image_ru: null,
        cover_image_tg: null,
        theme_color: '#FF0000',
        card_style: 'standard',
        card_variant_name: null,
        feed_position: 3,
      },
    },
  ] as HomeFeedItem[],
};

// ============================================================
// 测试辅助
// ============================================================

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ============================================================
// homepageQueryKeys 测试
// ============================================================

describe('homepageQueryKeys', () => {
  it('homeFeed 不带分类 ID 时使用 "all"', async () => {
    const { homepageQueryKeys } = await import('../useHomeFeed');
    expect(homepageQueryKeys.homeFeed()).toEqual(['homepage', 'feed', 'all']);
  });

  it('homeFeed 带分类 ID 时使用该 ID', async () => {
    const { homepageQueryKeys } = await import('../useHomeFeed');
    expect(homepageQueryKeys.homeFeed('cat-123')).toEqual(['homepage', 'feed', 'cat-123']);
  });

  it('topicDetail 使用 slugOrId', async () => {
    const { homepageQueryKeys } = await import('../useHomeFeed');
    expect(homepageQueryKeys.topicDetail('my-topic')).toEqual(['homepage', 'topic', 'my-topic']);
  });

  it('categoryProducts 使用 categoryId', async () => {
    const { homepageQueryKeys } = await import('../useHomeFeed');
    expect(homepageQueryKeys.categoryProducts('cat-456')).toEqual(['homepage', 'category-products', 'cat-456']);
  });
});

// ============================================================
// useHomeFeed 测试
// ============================================================

describe('useHomeFeed', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockFrom.mockReset();
    mockSelect.mockReset();
    mockEq.mockReset();
  });

  it('应正确获取首页 feed 数据', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, data: mockFeedData },
      error: null,
    });

    const { useHomeFeed } = await import('../useHomeFeed');
    const { result } = renderHook(() => useHomeFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.banners).toHaveLength(1);
    expect(result.current.data?.categories).toHaveLength(1);
    expect(result.current.data?.products).toHaveLength(2);
    expect(result.current.data?.placements).toHaveLength(1);
  });

  it('应使用 GET 方法调用 Edge Function', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, data: mockFeedData },
      error: null,
    });

    const { useHomeFeed } = await import('../useHomeFeed');
    renderHook(() => useHomeFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(mockInvoke).toHaveBeenCalledWith('get-home-feed', { method: 'GET' });
  });

  it('带分类 ID 时应过滤商品', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, data: mockFeedData },
      error: null,
    });

    // Mock product_categories 表查询：只有 inv-1 属于 cat-1
    mockEq.mockResolvedValue({
      data: [{ product_id: 'inv-1' }],
      error: null,
    });

    const { useHomeFeed } = await import('../useHomeFeed');
    const { result } = renderHook(() => useHomeFeed('cat-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 应该只返回 inv-1 对应的商品
    expect(result.current.data?.products).toHaveLength(1);
    const productData = result.current.data?.products[0]?.data as HomeFeedProductData;
    expect(productData.inventory_product_id).toBe('inv-1');
  });

  it('Edge Function 返回错误时应抛出异常', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Internal Server Error' },
    });

    const { useHomeFeed } = await import('../useHomeFeed');
    const { result } = renderHook(() => useHomeFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Internal Server Error');
  });

  it('返回数据为空时应返回空数组', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, data: {} },
      error: null,
    });

    const { useHomeFeed } = await import('../useHomeFeed');
    const { result } = renderHook(() => useHomeFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.banners).toEqual([]);
    expect(result.current.data?.categories).toEqual([]);
    expect(result.current.data?.products).toEqual([]);
    expect(result.current.data?.placements).toEqual([]);
  });
});

// ============================================================
// useTopicDetail 测试
// ============================================================

describe('useTopicDetail', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('应使用 GET 方法并传递 slug 参数', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, data: { topic: {}, products: [] } },
      error: null,
    });

    const { useTopicDetail } = await import('../useHomeFeed');
    renderHook(() => useTopicDetail('my-topic-slug'), { wrapper: createWrapper() });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(mockInvoke).toHaveBeenCalledWith(
      'get-topic-detail?slug=my-topic-slug',
      { method: 'GET' }
    );
  });

  it('slug 包含特殊字符时应正确编码', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, data: { topic: {}, products: [] } },
      error: null,
    });

    const { useTopicDetail } = await import('../useHomeFeed');
    renderHook(() => useTopicDetail('topic with spaces'), { wrapper: createWrapper() });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(mockInvoke).toHaveBeenCalledWith(
      'get-topic-detail?slug=topic%20with%20spaces',
      { method: 'GET' }
    );
  });

  it('slugOrId 为空时不应发起请求', async () => {
    const { useTopicDetail } = await import('../useHomeFeed');
    const { result } = renderHook(() => useTopicDetail(''), { wrapper: createWrapper() });

    // enabled: !!slugOrId 为 false，不应发起请求
    expect(result.current.isFetching).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ============================================================
// useCategoryProducts 测试
// ============================================================

describe('useCategoryProducts', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockEq.mockReset();
  });

  it('应获取并过滤分类商品', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, data: mockFeedData },
      error: null,
    });
    mockEq.mockResolvedValue({
      data: [{ product_id: 'inv-2' }],
      error: null,
    });

    const { useCategoryProducts } = await import('../useHomeFeed');
    const { result } = renderHook(() => useCategoryProducts('cat-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.products).toHaveLength(1);
    const productData = result.current.data?.products[0]?.data as HomeFeedProductData;
    expect(productData.inventory_product_id).toBe('inv-2');
    // banners 和 placements 应为空
    expect(result.current.data?.banners).toEqual([]);
    expect(result.current.data?.placements).toEqual([]);
  });
});
