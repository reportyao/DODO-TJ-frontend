/**
 * TopicDetailPage 页面单元测试 (v2)
 *
 * 覆盖范围：
 * - 加载状态骨架屏
 * - 错误/未找到状态
 * - 专题标题、副标题、简介渲染
 * - 封面图渲染（AI封面优先 / 多语言封面回退 / 无封面）
 * - v2 sections 段落渲染（场景文案 + 横向商品卡片）
 * - v1 兼容：平铺商品列表
 * - 横向商品卡片：标题、DODO价格、竞品价格、购买按钮
 * - 无 lottery 时显示"即将上架"
 * - 浏览埋点（topic_detail_view）
 * - 商品点击埋点（topic_product_click）
 * - 未登录用户点击跳转登录
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
}));

let mockTopicData: Record<string, unknown> | undefined;
let mockIsLoading = false;
let mockError: Error | null = null;
vi.mock('../../hooks/useHomeFeed', () => ({
  useTopicDetail: () => ({
    data: mockTopicData,
    isLoading: mockIsLoading,
    error: mockError,
  }),
}));

let mockUser: { id: string } | null = { id: 'user-123' };
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({ user: mockUser }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const map: Record<string, string> = {
        'common.noData': '暂无数据',
        'common.back': '返回',
        'product.buyNow': '立即购买',
        'product.comingSoon': '即将上架',
        'product.startFrom': '低至',
        'product.perUnit': '份',
      };
      return map[key] || fallback || key;
    },
    i18n: { language: 'zh' },
  }),
}));

vi.mock('../../lib/utils', () => ({
  getLocalizedText: (i18n: Record<string, string>, lang: string) => i18n?.[lang] || i18n?.zh || '',
  formatCurrency: (_c: string, amount: number) => `${amount} TJS`,
}));

vi.mock('../../utils/i18nFallback', () => ({
  getCoverImage: (obj: Record<string, string | null>, lang: string) =>
    obj?.[`cover_image_${lang}`] || obj?.cover_image_default || null,
}));

vi.mock('../../components/LazyImage', () => ({
  LazyImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} data-testid="lazy-image" />
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
  ShoppingCartIcon: ({ className }: { className: string }) => (
    <span data-testid="shopping-cart-icon" className={className}>🛒</span>
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
// 测试数据 (v2 sections 模式)
// ============================================================

const mockTopic = {
  id: 'topic-001',
  slug: 'summer-sale',
  topic_type: 'story',
  title_i18n: { zh: '夏季大促', ru: 'Летняя распродажа', tg: 'Фурӯши тобистонӣ' },
  subtitle_i18n: { zh: '全场5折起', ru: 'Скидки до 50%', tg: 'Тахфиф то 50%' },
  intro_i18n: { zh: '这是夏季大促的简介', ru: 'Описание', tg: 'Тавсиф' },
  story_blocks_i18n: [],
  cover_image_default: 'https://cdn.example.com/cover.jpg',
  cover_image_zh: 'https://cdn.example.com/cover_zh.jpg',
  cover_image_ru: null,
  cover_image_tg: null,
  cover_image_url: null,
  theme_color: '#FF6B35',
  translation_status: null,
  start_time: null,
};

const mockSections = [
  {
    story_group: 0,
    story_text_i18n: { zh: '炎炎夏日，来一杯冰饮降降温', ru: 'Летний напиток', tg: 'Нӯшокии тобистонӣ' },
    products: [
      {
        product_id: 'prod-1',
        name_i18n: { zh: '智能手机', ru: 'Смартфон', tg: 'Смартфон' },
        description_i18n: { zh: '描述', ru: 'Описание', tg: 'Тавсиф' },
        image_url: 'https://cdn.example.com/phone.jpg',
        image_urls: ['https://cdn.example.com/phone.jpg'],
        original_price: 2999,
        badge_text_i18n: { zh: '热卖', ru: 'Хит', tg: 'Хит' },
        note_i18n: null,
        sort_order: 0,
        active_lottery: {
          lottery_id: 'lot-1',
          ticket_price: 10,
          total_tickets: 300,
          sold_tickets: 150,
          status: 'ACTIVE',
          full_purchase_enabled: false,
          full_purchase_price: null,
          price_comparisons: [
            { platform: '淘宝', price: 3999, currency: 'TJS' },
          ],
          currency: 'TJS',
          draw_time: null,
        },
      },
    ],
  },
  {
    story_group: 1,
    story_text_i18n: { zh: '居家好物推荐', ru: 'Для дома', tg: 'Барои хона' },
    products: [
      {
        product_id: 'prod-2',
        name_i18n: { zh: '平板电脑', ru: 'Планшет', tg: 'Планшет' },
        description_i18n: { zh: '描述', ru: 'Описание', tg: 'Тавсиф' },
        image_url: 'https://cdn.example.com/tablet.jpg',
        image_urls: ['https://cdn.example.com/tablet.jpg'],
        original_price: 1999,
        badge_text_i18n: null,
        note_i18n: null,
        sort_order: 0,
        active_lottery: null,
      },
    ],
  },
];

const mockFlatProducts = mockSections.flatMap(s => s.products);

function renderPage(slug = 'summer-sale') {
  return render(
    <MemoryRouter initialEntries={[`/topic/${slug}`]}>
      <Routes>
        <Route path="/topic/:slug" element={<TopicDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

let TopicDetailPage: React.ComponentType;

// ============================================================
// 测试
// ============================================================

describe('TopicDetailPage v2', () => {
  beforeEach(async () => {
    mockTrack.mockClear();
    mockNavigate.mockClear();
    mockTopicData = undefined;
    mockIsLoading = false;
    mockError = null;
    mockUser = { id: 'user-123' };

    vi.resetModules();
    const mod = await import('../TopicDetailPage');
    TopicDetailPage = mod.default;
  });

  describe('加载状态', () => {
    it('isLoading 为 true 时应显示骨架屏', () => {
      mockIsLoading = true;
      const { container } = renderPage();
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('错误/未找到状态', () => {
    it('error 不为空时应显示"暂无数据"', () => {
      mockError = new Error('Not found');
      renderPage();
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
    });

    it('topic 为 null 时应显示"暂无数据"和返回按钮', () => {
      mockTopicData = { topic: null, products: [], sections: [] };
      renderPage();
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
      expect(screen.getByText('返回')).toBeInTheDocument();
    });
  });

  describe('专题基本信息渲染', () => {
    beforeEach(() => {
      mockTopicData = { topic: mockTopic, products: mockFlatProducts, sections: mockSections };
    });

    it('应渲染专题标题', () => {
      renderPage();
      expect(screen.getByText('夏季大促')).toBeInTheDocument();
    });

    it('应渲染专题副标题', () => {
      renderPage();
      expect(screen.getByText('全场5折起')).toBeInTheDocument();
    });

    it('应渲染专题简介', () => {
      renderPage();
      expect(screen.getByText('这是夏季大促的简介')).toBeInTheDocument();
    });
  });

  describe('封面图渲染', () => {
    it('应渲染多语言封面图', () => {
      mockTopicData = { topic: mockTopic, products: [], sections: [] };
      renderPage();
      const images = screen.getAllByTestId('lazy-image');
      const coverImg = images.find((img) => img.getAttribute('src')?.includes('cover_zh'));
      expect(coverImg).toBeDefined();
    });

    it('AI封面图应优先于多语言封面', () => {
      const topicWithAICover = {
        ...mockTopic,
        cover_image_url: 'https://cdn.example.com/ai_cover.jpg',
      };
      mockTopicData = { topic: topicWithAICover, products: [], sections: [] };
      renderPage();
      const images = screen.getAllByTestId('lazy-image');
      const aiCover = images.find((img) => img.getAttribute('src')?.includes('ai_cover'));
      expect(aiCover).toBeDefined();
    });

    it('无封面图时应显示返回按钮（非覆盖式）', () => {
      const noCoverTopic = {
        ...mockTopic,
        cover_image_default: null,
        cover_image_zh: null,
        cover_image_ru: null,
        cover_image_tg: null,
        cover_image_url: null,
      };
      mockTopicData = { topic: noCoverTopic, products: [], sections: [] };
      renderPage();
      expect(screen.getByText('返回')).toBeInTheDocument();
    });
  });

  describe('v2 sections 段落渲染', () => {
    beforeEach(() => {
      mockTopicData = { topic: mockTopic, products: mockFlatProducts, sections: mockSections };
    });

    it('应渲染场景文案', () => {
      renderPage();
      expect(screen.getByText('炎炎夏日，来一杯冰饮降降温')).toBeInTheDocument();
      expect(screen.getByText('居家好物推荐')).toBeInTheDocument();
    });

    it('应渲染横向商品卡片中的商品名称', () => {
      renderPage();
      expect(screen.getByText('智能手机')).toBeInTheDocument();
      expect(screen.getByText('平板电脑')).toBeInTheDocument();
    });

    it('应渲染商品角标', () => {
      renderPage();
      expect(screen.getByText('热卖')).toBeInTheDocument();
    });

    it('有 lottery 时应显示 DODO 补贴价（ticket_price）和“立即购买”按钮，无 lottery 时显示原价和“即将上架”', () => {
      renderPage();
      // 检查智能手机 (prod-1)
      expect(screen.getByText('智能手机')).toBeInTheDocument();
      expect(screen.getByText('低至 10 TJS/份')).toBeInTheDocument(); // DODO price with '低至' and '份'
      expect(screen.getByText('立即购买')).toBeInTheDocument();
      expect(screen.queryByText('补贴价')).not.toBeInTheDocument(); // 确保不显示补贴价

      // 检查平板电脑 (prod-2)
      expect(screen.getByText('平板电脑')).toBeInTheDocument();
      expect(screen.getByText('1999 TJS')).toBeInTheDocument(); // Original price
      expect(screen.getByText('即将上架')).toBeInTheDocument();
      expect(screen.queryByText('低至')).not.toBeInTheDocument(); // 确保不显示低至
    });

    it('点击商品卡片应触发埋点并跳转到商品详情页', () => {
      renderPage();
      const productCard = screen.getByText('智能手机');
      fireEvent.click(productCard);
      expect(mockTrack).toHaveBeenCalledWith('topic_product_click', {
        product_id: 'prod-1',
        product_name: '智能手机',
        topic_id: 'topic-001',
        topic_name: '夏季大促',
      });
      expect(mockNavigate).toHaveBeenCalledWith('/product/prod-1');
    });

    it('未登录用户点击购买按钮应跳转到登录页', () => {
      mockUser = null; // 模拟未登录状态
      renderPage();
      const buyButton = screen.getByText('立即购买');
      fireEvent.click(buyButton);
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  describe('v1 兼容：平铺商品列表', () => {
    beforeEach(() => {
      mockTopicData = {
        topic: { ...mockTopic, topic_type: 'product_list' }, // 模拟 v1 专题类型
        products: mockFlatProducts,
        sections: [],
      };
    });

    it('应渲染平铺商品列表中的商品名称', () => {
      renderPage();
      expect(screen.getByText('智能手机')).toBeInTheDocument();
      expect(screen.getByText('平板电脑')).toBeInTheDocument();
    });

    it('应渲染平铺商品列表中的商品价格', () => {
      renderPage();
      // 智能手机有 lottery
      expect(screen.getByText('低至 10 TJS/份')).toBeInTheDocument();
      expect(screen.getByText('立即购买')).toBeInTheDocument();

      // 平板电脑无 lottery
      expect(screen.getByText('1999 TJS')).toBeInTheDocument();
      expect(screen.getByText('即将上架')).toBeInTheDocument();
    });
  });

  describe('埋点', () => {
    it('页面加载时应触发 topic_detail_view 埋点', () => {
      mockTopicData = { topic: mockTopic, products: mockFlatProducts, sections: mockSections };
      renderPage();
      expect(mockTrack).toHaveBeenCalledWith('topic_detail_view', {
        topic_id: 'topic-001',
        topic_name: '夏季大促',
        topic_type: 'story',
      });
    });
  });
});
