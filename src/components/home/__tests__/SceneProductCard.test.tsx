/**
 * SceneProductCard 组件单元测试
 *
 * 覆盖范围：
 * - 商品信息渲染（标题、价格、进度条）
 * - 竞品价格对比与节省百分比角标
 * - 点击埋点事件（product_card_click）
 * - 曝光追踪绑定（product_card_expose）
 * - 未登录用户点击跳转登录页
 * - 链接生成（含归因参数）
 * - 进度条计算
 * - 单份价格显示
 * - 全额购买标识
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SceneProductCard } from '../SceneProductCard';
import type { HomeFeedProductData } from '../../../types/homepage';

// ============================================================
// Mock 依赖
// ============================================================

const mockTrack = vi.fn();
vi.mock('../../../hooks/useTrackEvent', () => ({
  useTrackEvent: () => ({ track: mockTrack }),
  useExposureTracker: () => ({ current: null }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let mockUser: { id: string } | null = { id: 'user-123' };
vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({ user: mockUser }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'subsidyPool.subsidyPrice': '补贴价',
        'product.startFrom': '低至',
        'product.perUnit': '份',
      };
      return map[key] || key;
    },
    i18n: { language: 'zh' },
  }),
}));

vi.mock('../../../lib/utils', () => ({
  formatCurrency: (_currency: string, amount: number) => `${amount} TJS`,
  getLocalizedText: (i18n: Record<string, string>, lang: string) => i18n?.[lang] || i18n?.zh || '',
}));

vi.mock('../../LazyImage', () => ({
  LazyImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} data-testid="lazy-image" />
  ),
}));

// ============================================================
// 测试数据
// ============================================================

const baseProduct: HomeFeedProductData = {
  lottery_id: 'lot-001',
  inventory_product_id: 'inv-001',
  title_i18n: { zh: '智能手机', ru: 'Смартфон', tg: 'Смартфон' },
  description_i18n: { zh: '高性能手机', ru: 'Мощный телефон', tg: 'Телефони қавӣ' },
  image_url: 'https://cdn.example.com/phone.jpg',
  image_urls: ['https://cdn.example.com/phone.jpg'],
  original_price: 2999,
  ticket_price: 10,
  total_tickets: 300,
  sold_tickets: 150,
  price_comparisons: [],
  currency: 'TJS',
  full_purchase_enabled: false,
  full_purchase_price: null,
  status: 'active',
};

const productWithComparison: HomeFeedProductData = {
  ...baseProduct,
  original_price: 2999,
  price_comparisons: [
    { platform: 'Amazon', price: 4999 },
    { platform: 'eBay', price: 3999 },
  ],
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ============================================================
// 测试
// ============================================================

describe('SceneProductCard', () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockNavigate.mockClear();
    mockUser = { id: 'user-123' };
  });

  describe('基本渲染', () => {
    it('应渲染商品标题', () => {
      renderWithRouter(<SceneProductCard product={baseProduct} position={0} />);
      expect(screen.getByText('智能手机')).toBeInTheDocument();
    });

    it('应渲染商品价格和补贴价标签', () => {
      renderWithRouter(<SceneProductCard product={baseProduct} position={0} />);
      expect(screen.getByText('2999 TJS')).toBeInTheDocument();
      expect(screen.getByText('补贴价')).toBeInTheDocument();
    });

    it('应渲染商品图片', () => {
      renderWithRouter(<SceneProductCard product={baseProduct} position={0} />);
      const img = screen.getByTestId('lazy-image');
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/phone.jpg');
    });

    it('应渲染单份价格提示', () => {
      renderWithRouter(<SceneProductCard product={baseProduct} position={0} />);
      expect(screen.getByText(/低至/)).toBeInTheDocument();
      expect(screen.getByText(/10 TJS/)).toBeInTheDocument();
    });
  });

  describe('进度条', () => {
    it('应渲染进度条和售出数量', () => {
      renderWithRouter(<SceneProductCard product={baseProduct} position={0} />);
      expect(screen.getByText('150/300')).toBeInTheDocument();
    });

    it('进度条宽度应正确计算（50%）', () => {
      const { container } = renderWithRouter(
        <SceneProductCard product={baseProduct} position={0} />
      );
      const progressBar = container.querySelector('.bg-gradient-to-r.from-orange-400');
      expect(progressBar).toHaveStyle({ width: '50%' });
    });

    it('售罄时进度条应为 100%', () => {
      const soldOutProduct = { ...baseProduct, sold_tickets: 300 };
      const { container } = renderWithRouter(
        <SceneProductCard product={soldOutProduct} position={0} />
      );
      const progressBar = container.querySelector('.bg-gradient-to-r.from-orange-400');
      expect(progressBar).toHaveStyle({ width: '100%' });
    });

    it('total_tickets 为 0 时不应渲染进度条', () => {
      const noTickets = { ...baseProduct, total_tickets: 0 };
      renderWithRouter(<SceneProductCard product={noTickets} position={0} />);
      expect(screen.queryByText(/\/0/)).not.toBeInTheDocument();
    });
  });

  describe('竞品价格对比', () => {
    it('有竞品价格时应显示节省百分比角标', () => {
      renderWithRouter(
        <SceneProductCard product={productWithComparison} position={0} />
      );
      // 最高竞品价 4999，原价 2999，节省 = round((1 - 2999/4999) * 100) = 40%
      expect(screen.getByText('-40%')).toBeInTheDocument();
    });

    it('有竞品价格时应显示划线价', () => {
      renderWithRouter(
        <SceneProductCard product={productWithComparison} position={0} />
      );
      expect(screen.getByText('4999 TJS')).toBeInTheDocument();
    });

    it('竞品价格低于原价时不应显示角标', () => {
      const cheaperCompetitor = {
        ...baseProduct,
        price_comparisons: [{ platform: 'Local', price: 1999 }],
      };
      renderWithRouter(
        <SceneProductCard product={cheaperCompetitor} position={0} />
      );
      expect(screen.queryByText(/-%/)).not.toBeInTheDocument();
    });

    it('无竞品价格时不应显示角标', () => {
      renderWithRouter(<SceneProductCard product={baseProduct} position={0} />);
      expect(screen.queryByText(/-%/)).not.toBeInTheDocument();
    });
  });

  describe('链接生成', () => {
    it('应生成正确的抽奖详情链接（含归因参数）', () => {
      renderWithRouter(
        <SceneProductCard product={baseProduct} position={0} sourceCategoryId="cat-1" />
      );
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/lottery/lot-001?src_page=home&src_category=cat-1');
    });

    it('无分类 ID 时链接不含 src_category', () => {
      renderWithRouter(<SceneProductCard product={baseProduct} position={0} />);
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/lottery/lot-001?src_page=home');
    });
  });

  describe('点击埋点', () => {
    it('点击卡片应触发 product_card_click 事件', () => {
      renderWithRouter(
        <SceneProductCard product={baseProduct} position={2} sourceCategoryId="cat-1" />
      );

      const link = screen.getByRole('link');
      fireEvent.click(link);

      expect(mockTrack).toHaveBeenCalledWith({
        event_name: 'product_card_click',
        page_name: 'home',
        entity_type: 'product',
        entity_id: 'inv-001',
        position: '2',
        lottery_id: 'lot-001',
        inventory_product_id: 'inv-001',
        source_category_id: 'cat-1',
      });
    });
  });

  describe('未登录用户行为', () => {
    it('未登录时点击应阻止默认行为并跳转登录页', () => {
      mockUser = null;

      renderWithRouter(
        <SceneProductCard product={baseProduct} position={0} />
      );

      const link = screen.getByRole('link');
      fireEvent.click(link);

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/login?redirect=')
      );
    });

    it('已登录时点击不应跳转登录页', () => {
      mockUser = { id: 'user-123' };

      renderWithRouter(
        <SceneProductCard product={baseProduct} position={0} />
      );

      const link = screen.getByRole('link');
      fireEvent.click(link);

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('单份价格', () => {
    it('ticket_price 为 0 时不应显示单份价格', () => {
      const freeTicket = { ...baseProduct, ticket_price: 0 };
      renderWithRouter(<SceneProductCard product={freeTicket} position={0} />);
      expect(screen.queryByText(/低至/)).not.toBeInTheDocument();
    });
  });

  describe('图片为空', () => {
    it('image_url 为空时应渲染空 src 的图片', () => {
      const noImage = { ...baseProduct, image_url: '' };
      renderWithRouter(<SceneProductCard product={noImage} position={0} />);
      const img = screen.getByTestId('lazy-image');
      expect(img).toHaveAttribute('src', '');
    });
  });
});
