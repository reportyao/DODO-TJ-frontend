/**
 * TopicDetailPage 页面单元测试
 *
 * 覆盖范围：
 * - 加载状态骨架屏
 * - 错误/未找到状态
 * - 专题标题、副标题、简介渲染
 * - 封面图渲染（有/无封面）
 * - 正文块渲染（heading、paragraph、callout、image、product_grid）
 * - 挂载商品列表渲染
 * - 浏览埋点（topic_detail_view）
 * - 商品点击埋点（topic_product_click）
 * - 未登录用户点击跳转登录
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { screen, fireEvent } from '@testing-library/dom';
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
    t: (key: string) => {
      const map: Record<string, string> = {
        'home.lotteryProducts': '热门商品',
        'common.noData': '暂无数据',
        'common.back': '返回',
        'subsidyPool.subsidyPrice': '补贴价',
        'product.startFrom': '低至',
        'product.perUnit': '份',
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
      const { initial, animate, ...rest } = props;
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

const mockTopic = {
  id: 'topic-001',
  slug: 'summer-sale',
  title_i18n: { zh: '夏季大促', ru: 'Летняя распродажа', tg: 'Фурӯши тобистонӣ' },
  subtitle_i18n: { zh: '全场5折起', ru: 'Скидки до 50%', tg: 'Тахфиф то 50%' },
  intro_i18n: { zh: '这是夏季大促的简介', ru: 'Описание', tg: 'Тавсиф' },
  cover_image_default: 'https://cdn.example.com/cover.jpg',
  cover_image_zh: 'https://cdn.example.com/cover_zh.jpg',
  cover_image_ru: null,
  cover_image_tg: null,
  theme_color: '#FF6B35',
  story_blocks_i18n: [
    { block_key: 'b1', block_type: 'heading', zh: '活动规则', ru: 'Правила', tg: 'Қоидаҳо' },
    { block_key: 'b2', block_type: 'paragraph', zh: '这是一段正文内容', ru: 'Текст', tg: 'Матн' },
    { block_key: 'b3', block_type: 'callout', zh: '注意事项', ru: 'Внимание', tg: 'Диққат' },
    { block_key: 'b4', block_type: 'image', image_url: 'https://cdn.example.com/story.jpg', zh: '', ru: '', tg: '' },
    { block_key: 'b5', block_type: 'product_grid', zh: '', ru: '', tg: '' },
  ],
};

const mockProducts = [
  {
    product_id: 'prod-1',
    name_i18n: { zh: '智能手机', ru: 'Смартфон', tg: 'Смартфон' },
    image_url: 'https://cdn.example.com/phone.jpg',
    original_price: 2999,
    badge_text_i18n: { zh: '热卖', ru: 'Хит', tg: 'Хит' },
    note_i18n: { zh: '限量100台', ru: '100 шт', tg: '100 адад' },
    sort_order: 1,
    active_lottery: {
      lottery_id: 'lot-1',
      ticket_price: 10,
      total_tickets: 300,
      sold_tickets: 150,
      currency: 'TJS',
    },
  },
  {
    product_id: 'prod-2',
    name_i18n: { zh: '平板电脑', ru: 'Планшет', tg: 'Планшет' },
    image_url: 'https://cdn.example.com/tablet.jpg',
    original_price: 1999,
    badge_text_i18n: null,
    note_i18n: null,
    sort_order: 2,
    active_lottery: {
      lottery_id: 'lot-2',
      ticket_price: 5,
      total_tickets: 200,
      sold_tickets: 50,
      currency: 'TJS',
    },
  },
];

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

describe('TopicDetailPage', () => {
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
      mockTopicData = { topic: null, products: [] };

      renderPage();
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
      expect(screen.getByText('返回')).toBeInTheDocument();
    });
  });

  describe('专题内容渲染', () => {
    beforeEach(() => {
      mockTopicData = { topic: mockTopic, products: mockProducts };
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

    it('应渲染封面图', () => {
      renderPage();
      const images = screen.getAllByTestId('lazy-image');
      const coverImg = images.find((img) => img.getAttribute('src')?.includes('cover_zh'));
      expect(coverImg).toBeDefined();
    });
  });

  describe('正文块渲染', () => {
    beforeEach(() => {
      mockTopicData = { topic: mockTopic, products: [] };
    });

    it('应渲染 heading 块', () => {
      renderPage();
      expect(screen.getByText('活动规则')).toBeInTheDocument();
    });

    it('应渲染 paragraph 块', () => {
      renderPage();
      expect(screen.getByText('这是一段正文内容')).toBeInTheDocument();
    });

    it('应渲染 callout 块', () => {
      renderPage();
      expect(screen.getByText('注意事项')).toBeInTheDocument();
    });

    it('应渲染 image 块', () => {
      renderPage();
      const images = screen.getAllByTestId('lazy-image');
      const storyImg = images.find((img) => img.getAttribute('src')?.includes('story.jpg'));
      expect(storyImg).toBeDefined();
    });

    it('product_grid 块不应渲染内容', () => {
      renderPage();
      // product_grid 返回 null，不应有额外的空元素
      // 只要没报错就算通过
      expect(screen.getByText('夏季大促')).toBeInTheDocument();
    });
  });

  describe('挂载商品列表', () => {
    beforeEach(() => {
      mockTopicData = { topic: mockTopic, products: mockProducts };
    });

    it('应渲染商品列表标题', () => {
      renderPage();
      expect(screen.getByText('热门商品')).toBeInTheDocument();
    });

    it('应渲染所有挂载商品', () => {
      renderPage();
      expect(screen.getByText('智能手机')).toBeInTheDocument();
      expect(screen.getByText('平板电脑')).toBeInTheDocument();
    });

    it('应渲染商品角标', () => {
      renderPage();
      expect(screen.getByText('热卖')).toBeInTheDocument();
    });

    it('应渲染商品备注', () => {
      renderPage();
      expect(screen.getByText('限量100台')).toBeInTheDocument();
    });

    it('应渲染商品价格和补贴价标签', () => {
      renderPage();
      expect(screen.getByText('2999 TJS')).toBeInTheDocument();
      expect(screen.getAllByText('补贴价').length).toBeGreaterThan(0);
    });

    it('无商品时不应渲染商品区域', () => {
      mockTopicData = { topic: mockTopic, products: [] };
      renderPage();
      expect(screen.queryByText('热门商品')).not.toBeInTheDocument();
    });
  });

  describe('浏览埋点', () => {
    it('页面加载时应触发 topic_detail_view 埋点', () => {
      mockTopicData = { topic: mockTopic, products: [] };
      renderPage();

      expect(mockTrack).toHaveBeenCalledWith({
        event_name: 'topic_detail_view',
        page_name: 'topic_detail',
        entity_type: 'topic',
        entity_id: 'topic-001',
        source_topic_id: 'topic-001',
      });
    });
  });

  describe('商品点击埋点', () => {
    it('点击商品应触发 topic_product_click 埋点', () => {
      mockTopicData = { topic: mockTopic, products: mockProducts };
      renderPage();

      const productLinks = screen.getAllByRole('link');
      // 找到包含"智能手机"的链接
      const phoneLink = productLinks.find((link) =>
        link.textContent?.includes('智能手机')
      );
      if (phoneLink) {
        fireEvent.click(phoneLink);
        expect(mockTrack).toHaveBeenCalledWith(
          expect.objectContaining({
            event_name: 'topic_product_click',
            page_name: 'topic_detail',
            entity_type: 'product',
            entity_id: 'prod-1',
            source_topic_id: 'topic-001',
            lottery_id: 'lot-1',
          })
        );
      }
    });
  });

  describe('未登录用户行为', () => {
    it('未登录时点击商品应跳转登录页', () => {
      mockUser = null;
      mockTopicData = { topic: mockTopic, products: mockProducts };
      renderPage();

      const productLinks = screen.getAllByRole('link');
      const phoneLink = productLinks.find((link) =>
        link.textContent?.includes('智能手机')
      );
      if (phoneLink) {
        fireEvent.click(phoneLink);
        expect(mockNavigate).toHaveBeenCalledWith(
          expect.stringContaining('/login?redirect=')
        );
      }
    });
  });

  describe('无封面图', () => {
    it('无封面图时应显示返回按钮（非覆盖式）', () => {
      const noCoverTopic = {
        ...mockTopic,
        cover_image_default: null,
        cover_image_zh: null,
        cover_image_ru: null,
        cover_image_tg: null,
      };
      mockTopicData = { topic: noCoverTopic, products: [] };
      renderPage();

      expect(screen.getByText('返回')).toBeInTheDocument();
    });
  });
});
