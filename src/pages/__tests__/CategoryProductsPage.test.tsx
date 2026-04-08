/**
 * CategoryProductsPage 页面单元测试
 *
 * 覆盖范围：
 * - 页面布局（顶部导航栏、商品列表）
 * - 分类名称和图标显示
 * - 加载状态骨架屏
 * - 空数据状态
 * - 商品列表渲染
 * - 商品数量显示
 * - 浏览埋点（category_click）
 * - 返回按钮
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ============================================================
// Mock 依赖
// ============================================================

const mockTrack = vi.fn();
vi.mock('../../hooks/useTrackEvent', () => ({
  useTrackEvent: () => ({ track: mockTrack }),
  useExposureTracker: () => ({ current: null }),
}));

let mockCategoryData: Record<string, unknown> | undefined;
let mockIsLoading = false;
vi.mock('../../hooks/useHomeFeed', () => ({
  useCategoryProducts: () => ({
    data: mockCategoryData,
    isLoading: mockIsLoading,
  }),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({ user: { id: 'user-123' } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.noData': '暂无商品',
        'common.back': '返回首页',
        'common.category': '分类',
        'common.items': '件商品',
      };
      return map[key] || key;
    },
    i18n: { language: 'zh' },
  }),
}));

vi.mock('../../lib/utils', () => ({
  getLocalizedText: (i18n: Record<string, string>, lang: string) => i18n?.[lang] || i18n?.zh || '',
  formatCurrency: (_c: string, amount: number) => `${amount} TJS`,
}));

vi.mock('../../components/home/SceneProductCard', () => ({
  SceneProductCard: ({ product }: { product: { title_i18n: Record<string, string> } }) => (
    <div data-testid="product-card">{product.title_i18n.zh}</div>
  ),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
}));

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowLeftIcon: ({ className }: { className: string }) => (
    <span data-testid="arrow-left-icon" className={className}>←</span>
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ============================================================
// 测试数据
// ============================================================

const mockCategories = [
  { id: 'cat-1', code: 'digital_tech', name_i18n: { zh: '数码科技', ru: 'Цифровые', tg: 'Рақамӣ' }, sort_order: 1 },
];

const mockProducts = [
  { type: 'product', item_id: 'p1', data: { lottery_id: 'l1', inventory_product_id: 'inv1', title_i18n: { zh: '手机' }, image_url: '', original_price: 100, ticket_price: 10, total_tickets: 10, sold_tickets: 5, price_comparisons: [], currency: 'TJS', status: 'active' } },
  { type: 'product', item_id: 'p2', data: { lottery_id: 'l2', inventory_product_id: 'inv2', title_i18n: { zh: '耳机' }, image_url: '', original_price: 200, ticket_price: 20, total_tickets: 20, sold_tickets: 10, price_comparisons: [], currency: 'TJS', status: 'active' } },
];

let CategoryProductsPage: React.ComponentType;

function renderPage(categoryId = 'cat-1', searchParams = '') {
  return render(
    <MemoryRouter initialEntries={[`/category/${categoryId}${searchParams}`]}>
      <Routes>
        <Route path="/category/:categoryId" element={<CategoryProductsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================
// 测试
// ============================================================

describe('CategoryProductsPage', () => {
  beforeEach(async () => {
    mockTrack.mockClear();
    mockNavigate.mockClear();
    mockCategoryData = undefined;
    mockIsLoading = false;

    vi.resetModules();
    const mod = await import('../CategoryProductsPage');
    CategoryProductsPage = mod.default;
  });

  describe('页面布局', () => {
    it('应渲染顶部导航栏和返回按钮', () => {
      mockCategoryData = { categories: mockCategories, products: mockProducts };
      renderPage();

      expect(screen.getByTestId('arrow-left-icon')).toBeInTheDocument();
    });

    it('应显示分类名称', () => {
      mockCategoryData = { categories: mockCategories, products: mockProducts };
      renderPage();

      expect(screen.getByText('数码科技')).toBeInTheDocument();
    });

    it('应显示正确的分类图标', () => {
      mockCategoryData = { categories: mockCategories, products: mockProducts };
      renderPage();

      expect(screen.getByText('📱')).toBeInTheDocument();
    });

    it('应显示商品数量', () => {
      mockCategoryData = { categories: mockCategories, products: mockProducts };
      renderPage();

      expect(screen.getByText('2 件商品')).toBeInTheDocument();
    });
  });

  describe('分类名称回退', () => {
    it('categories 中找不到时应使用 URL 参数中的 name', () => {
      mockCategoryData = { categories: [], products: [] };
      renderPage('cat-unknown', '?name=测试分类&code=daily_goods');

      expect(screen.getByText('测试分类')).toBeInTheDocument();
      // 页面中有两个🏠（导航栏 + 空状态），使用 getAllByText
      expect(screen.getAllByText('🏠').length).toBeGreaterThanOrEqual(1);
    });

    it('无任何名称时应显示默认"分类"', () => {
      mockCategoryData = { categories: [], products: [] };
      renderPage('cat-unknown');

      expect(screen.getByText('分类')).toBeInTheDocument();
    });
  });

  describe('加载状态', () => {
    it('isLoading 为 true 时应显示骨架屏', () => {
      mockIsLoading = true;

      const { container } = renderPage();
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBe(6);
    });
  });

  describe('空数据状态', () => {
    it('无商品时应显示空状态提示', () => {
      mockCategoryData = { categories: mockCategories, products: [] };
      renderPage();

      expect(screen.getByText('暂无商品')).toBeInTheDocument();
    });

    it('空状态应显示返回按钮', () => {
      mockCategoryData = { categories: mockCategories, products: [] };
      renderPage();

      const backButton = screen.getByText(/返回首页/);
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('商品列表', () => {
    it('应渲染所有商品卡片', () => {
      mockCategoryData = { categories: mockCategories, products: mockProducts };
      renderPage();

      const productCards = screen.getAllByTestId('product-card');
      expect(productCards).toHaveLength(2);
      expect(screen.getByText('手机')).toBeInTheDocument();
      expect(screen.getByText('耳机')).toBeInTheDocument();
    });
  });

  describe('浏览埋点', () => {
    it('页面加载时应触发 category_click 埋点', () => {
      mockCategoryData = { categories: mockCategories, products: [] };
      renderPage();

      expect(mockTrack).toHaveBeenCalledWith({
        event_name: 'category_click',
        page_name: 'category_products',
        entity_type: 'category',
        entity_id: 'cat-1',
        source_category_id: 'cat-1',
      });
    });
  });

  describe('返回导航', () => {
    it('点击返回按钮应调用 navigate(-1)', () => {
      mockCategoryData = { categories: mockCategories, products: mockProducts };
      renderPage();

      const backButton = screen.getByTestId('arrow-left-icon').closest('button');
      if (backButton) {
        fireEvent.click(backButton);
        expect(mockNavigate).toHaveBeenCalledWith(-1);
      }
    });
  });
});
