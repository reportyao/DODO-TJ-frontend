/**
 * SceneHomePage 页面单元测试
 *
 * 覆盖范围：
 * - 页面布局结构（Banner、补贴池、分类、Feed 流）
 * - 加载状态骨架屏
 * - 空数据状态
 * - 分类筛选交互
 * - Feed 混合流（商品 + 专题穿插）
 * - 首页浏览埋点
 * - 分类点击埋点
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { screen, fireEvent } from '@testing-library/dom';
import { MemoryRouter } from 'react-router-dom';

// ============================================================
// Mock 依赖
// ============================================================

const mockTrack = vi.fn();
vi.mock('../../hooks/useTrackEvent', () => ({
  useTrackEvent: () => ({ track: mockTrack }),
  useExposureTracker: () => ({ current: null }),
}));

let mockFeedData: Record<string, unknown> | undefined;
let mockIsLoading = false;
const mockRefetch = vi.fn();
vi.mock('../../hooks/useHomeFeed', () => ({
  useHomeFeed: () => ({
    data: mockFeedData,
    isLoading: mockIsLoading,
    refetch: mockRefetch,
  }),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: { id: 'user-123' },
    wallets: [],
    isLoading: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'home.lotteryProducts': '抽奖商品',
        'common.noData': '暂无数据',
      };
      return map[key] || key;
    },
    i18n: { language: 'zh' },
  }),
}));

// Mock 子组件为简单占位符
vi.mock('../../components/BannerCarousel', () => ({
  default: () => <div data-testid="banner-carousel">BannerCarousel</div>,
}));

vi.mock('../../components/home/SubsidyPoolBanner', () => ({
  SubsidyPoolBanner: () => <div data-testid="subsidy-pool-banner">SubsidyPoolBanner</div>,
}));

vi.mock('../../components/home/CategoryGrid', () => ({
  CategoryGrid: ({ onSelect, isLoading, categories }: {
    onSelect: (id: string | undefined) => void;
    isLoading: boolean;
    categories: unknown[];
  }) => (
    <div data-testid="category-grid">
      <span data-testid="category-loading">{String(isLoading)}</span>
      <span data-testid="category-count">{categories.length}</span>
      <button data-testid="select-cat-1" onClick={() => onSelect('cat-1')}>Cat 1</button>
      <button data-testid="select-all" onClick={() => onSelect(undefined)}>All</button>
    </div>
  ),
}));

vi.mock('../../components/home/TopicCard', () => ({
  TopicCard: ({ topic }: { topic: { title_i18n: Record<string, string> } }) => (
    <div data-testid="topic-card">{topic.title_i18n.zh}</div>
  ),
}));

vi.mock('../../components/home/SceneProductCard', () => ({
  SceneProductCard: ({ product }: { product: { title_i18n: Record<string, string> } }) => (
    <div data-testid="product-card">{product.title_i18n.zh}</div>
  ),
}));

// ============================================================
// 测试数据
// ============================================================

const mockCategories = [
  { id: 'cat-1', code: 'electronics', name_i18n: { zh: '电子产品' }, sort_order: 1, icon_url: null },
  { id: 'cat-2', code: 'home', name_i18n: { zh: '家居' }, sort_order: 2, icon_url: null },
];

const mockProducts = [
  { type: 'product', item_id: 'p1', data: { lottery_id: 'l1', inventory_product_id: 'inv1', title_i18n: { zh: '商品1' }, image_url: '', original_price: 100, ticket_price: 10, total_tickets: 10, sold_tickets: 5, price_comparisons: [], currency: 'TJS', status: 'active' } },
  { type: 'product', item_id: 'p2', data: { lottery_id: 'l2', inventory_product_id: 'inv2', title_i18n: { zh: '商品2' }, image_url: '', original_price: 200, ticket_price: 20, total_tickets: 20, sold_tickets: 10, price_comparisons: [], currency: 'TJS', status: 'active' } },
  { type: 'product', item_id: 'p3', data: { lottery_id: 'l3', inventory_product_id: 'inv3', title_i18n: { zh: '商品3' }, image_url: '', original_price: 300, ticket_price: 30, total_tickets: 30, sold_tickets: 15, price_comparisons: [], currency: 'TJS', status: 'active' } },
];

const mockPlacements = [
  {
    type: 'topic',
    item_id: 't1',
    data: {
      id: 'topic-1',
      slug: 'summer-sale',
      title_i18n: { zh: '夏季专题' },
      subtitle_i18n: { zh: '全场5折' },
      feed_position: 2,
      card_style: 'banner',
      theme_color: '#FF6B35',
      cover_image_default: null,
    },
  },
];

// ============================================================
// 测试
// ============================================================

describe('SceneHomePage', () => {
  let SceneHomePage: React.ComponentType;

  beforeEach(async () => {
    mockTrack.mockClear();
    mockRefetch.mockClear();
    mockFeedData = undefined;
    mockIsLoading = false;

    vi.resetModules();
    const mod = await import('../SceneHomePage');
    SceneHomePage = mod.default;
  });

  describe('页面布局', () => {
    it('应渲染所有核心模块（Banner、补贴池、分类、Feed 标题）', () => {
      mockFeedData = { categories: mockCategories, products: [], placements: [], banners: [] };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      expect(screen.getByTestId('banner-carousel')).toBeInTheDocument();
      expect(screen.getByTestId('subsidy-pool-banner')).toBeInTheDocument();
      expect(screen.getByTestId('category-grid')).toBeInTheDocument();
      expect(screen.getByText('抽奖商品')).toBeInTheDocument();
    });
  });

  describe('加载状态', () => {
    it('isLoading 为 true 时应显示骨架屏', () => {
      mockIsLoading = true;
      mockFeedData = undefined;

      const { container } = render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      // 骨架屏有 animate-pulse 类
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('isLoading 为 true 时应将 loading 状态传递给 CategoryGrid', () => {
      mockIsLoading = true;

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      expect(screen.getByTestId('category-loading').textContent).toBe('true');
    });
  });

  describe('空数据状态', () => {
    it('无商品和专题时应显示"暂无数据"', () => {
      mockFeedData = { categories: mockCategories, products: [], placements: [], banners: [] };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      expect(screen.getByText('暂无数据')).toBeInTheDocument();
    });
  });

  describe('Feed 混合流', () => {
    it('应渲染商品卡片', () => {
      mockFeedData = { categories: mockCategories, products: mockProducts, placements: [], banners: [] };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      const productCards = screen.getAllByTestId('product-card');
      expect(productCards).toHaveLength(3);
      expect(screen.getByText('商品1')).toBeInTheDocument();
      expect(screen.getByText('商品2')).toBeInTheDocument();
      expect(screen.getByText('商品3')).toBeInTheDocument();
    });

    it('应在正确位置穿插专题卡片', () => {
      mockFeedData = {
        categories: mockCategories,
        products: mockProducts,
        placements: mockPlacements,
        banners: [],
      };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      const topicCards = screen.getAllByTestId('topic-card');
      expect(topicCards).toHaveLength(1);
      expect(screen.getByText('夏季专题')).toBeInTheDocument();
    });

    it('分类数量应正确传递给 CategoryGrid', () => {
      mockFeedData = { categories: mockCategories, products: [], placements: [], banners: [] };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      expect(screen.getByTestId('category-count').textContent).toBe('2');
    });
  });

  describe('分类筛选', () => {
    it('点击分类应触发 category_click 埋点', () => {
      mockFeedData = { categories: mockCategories, products: mockProducts, placements: [], banners: [] };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByTestId('select-cat-1'));

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          event_name: 'category_click',
          page_name: 'home',
          entity_type: 'category',
          entity_id: 'cat-1',
        })
      );
    });

    it('点击"全部"不应触发 category_click 埋点', () => {
      mockFeedData = { categories: mockCategories, products: mockProducts, placements: [], banners: [] };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      // 先清除 home_view 埋点
      mockTrack.mockClear();

      fireEvent.click(screen.getByTestId('select-all'));

      // 不应有 category_click 事件
      const categoryCalls = mockTrack.mock.calls.filter(
        (call) => call[0]?.event_name === 'category_click'
      );
      expect(categoryCalls).toHaveLength(0);
    });
  });

  describe('首页浏览埋点', () => {
    it('页面加载时应触发 home_view 埋点', () => {
      mockFeedData = { categories: [], products: [], placements: [], banners: [] };

      render(
        <MemoryRouter>
          <SceneHomePage />
        </MemoryRouter>
      );

      expect(mockTrack).toHaveBeenCalledWith({
        event_name: 'home_view',
        page_name: 'home',
        entity_type: 'home',
      });
    });
  });
});
