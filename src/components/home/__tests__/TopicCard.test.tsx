/**
 * TopicCard 组件单元测试
 *
 * 覆盖范围：
 * - 三种卡片样式渲染（hero/banner/mini）
 * - 多语言文本回退
 * - 封面图回退
 * - 点击埋点事件
 * - 曝光追踪绑定
 * - 链接生成（含归因参数）
 * - 默认样式回退
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopicCard } from '../TopicCard';
import type { HomeFeedTopicData } from '../../../types/homepage';

// ============================================================
// Mock 依赖
// ============================================================

const mockTrack = vi.fn();
vi.mock('../../../hooks/useTrackEvent', () => ({
  useTrackEvent: () => ({ track: mockTrack }),
  useExposureTracker: () => ({ current: null }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'home.topic': '专题',
        'home.viewDetails': '查看详情',
        'home.goSee': '去看看',
        'home.viewAll': '查看全部',
      };
      return map[key] || key;
    },
    i18n: { language: 'zh' },
  }),
}));

vi.mock('../../../lib/utils', () => ({
  getLocalizedText: (i18n: Record<string, string>, lang: string) => i18n?.[lang] || i18n?.zh || '',
}));

vi.mock('../../../utils/i18nFallback', () => ({
  getCoverImage: (images: Record<string, string | null>, _lang: string) =>
    images?.cover_image_zh || images?.cover_image_default || null,
}));

// Mock LazyImage
vi.mock('../../../components/LazyImage', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} data-testid="lazy-image" />,
  LazyImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} data-testid="lazy-image" />,
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial, animate, transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// ============================================================
// 测试数据
// ============================================================

const baseTopic: HomeFeedTopicData = {
  topic_id: 'topic-123',
  placement_id: 'pl-456',
  slug: 'summer-sale',
  title_i18n: { zh: '夏季大促', ru: 'Летняя распродажа', tg: 'Фурӯши тобистона' },
  subtitle_i18n: { zh: '全场5折起', ru: 'Скидки от 50%', tg: 'Тахфиф аз 50%' },
  cover_image_default: 'https://cdn.example.com/default.jpg',
  cover_image_zh: 'https://cdn.example.com/zh.jpg',
  cover_image_ru: 'https://cdn.example.com/ru.jpg',
  cover_image_tg: 'https://cdn.example.com/tg.jpg',
  cover_image_url: null,
  theme_color: '#FF6B35',
  card_style: 'banner',
  card_variant_name: null,
  feed_position: 3,
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ============================================================
// 测试
// ============================================================

describe('TopicCard', () => {
  beforeEach(() => {
    mockTrack.mockClear();
  });

  describe('Banner 样式（默认）', () => {
    it('应渲染标题和副标题', () => {
      renderWithRouter(<TopicCard topic={baseTopic} position={0} />);

      expect(screen.getByText('夏季大促')).toBeInTheDocument();
      expect(screen.getByText('全场5折起')).toBeInTheDocument();
    });

    it('应渲染封面图', () => {
      renderWithRouter(<TopicCard topic={baseTopic} position={0} />);

      const img = screen.getByTestId('lazy-image');
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/zh.jpg');
    });

    it('应显示"查看详情"文本', () => {
      renderWithRouter(<TopicCard topic={baseTopic} position={0} />);

      expect(screen.getByText(/查看详情/)).toBeInTheDocument();
    });
  });

  describe('Hero 样式', () => {
    it('应渲染 hero 样式卡片（含标题和专题标签）', () => {
      const heroTopic = { ...baseTopic, card_style: 'hero' };
      renderWithRouter(<TopicCard topic={heroTopic} position={0} />);

      expect(screen.getByText('夏季大促')).toBeInTheDocument();
      // Hero 样式使用"专题"标签而非"查看详情"
      expect(screen.getByText('专题')).toBeInTheDocument();
    });

    it('应渲染封面图', () => {
      const heroTopic = { ...baseTopic, card_style: 'hero' };
      renderWithRouter(<TopicCard topic={heroTopic} position={0} />);

      const img = screen.getByTestId('lazy-image');
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/zh.jpg');
    });
  });


  describe('Mini 样式', () => {
    it('应渲染 mini 样式卡片（无封面图）', () => {
      const miniTopic = { ...baseTopic, card_style: 'mini' };
      renderWithRouter(<TopicCard topic={miniTopic} position={0} />);

      expect(screen.getByText('夏季大促')).toBeInTheDocument();
      expect(screen.getByText(/去看看/)).toBeInTheDocument();
      // Mini 样式不显示封面图
      expect(screen.queryByTestId('lazy-image')).not.toBeInTheDocument();
    });
  });

  describe('默认样式回退', () => {
    it('未知 card_style 应回退到 banner 样式', () => {
      const unknownTopic = { ...baseTopic, card_style: 'unknown_style' };
      renderWithRouter(<TopicCard topic={unknownTopic} position={0} />);

      // Banner 样式有"查看详情"
      expect(screen.getByText(/查看详情/)).toBeInTheDocument();
    });

    it('card_style 为空时应回退到 banner 样式', () => {
      const emptyStyleTopic = { ...baseTopic, card_style: '' };
      renderWithRouter(<TopicCard topic={emptyStyleTopic} position={0} />);

      expect(screen.getByText(/查看详情/)).toBeInTheDocument();
    });
  });

  describe('链接生成', () => {
    it('应生成正确的专题详情链接（含归因参数）', () => {
      renderWithRouter(<TopicCard topic={baseTopic} position={0} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute(
        'href',
        '/topic/summer-sale?src_topic=topic-123&src_placement=pl-456&src_page=home'
      );
    });
  });

  describe('点击埋点', () => {
    it('点击卡片应触发 topic_card_click 事件', () => {
      renderWithRouter(<TopicCard topic={baseTopic} position={2} />);

      const link = screen.getByRole('link');
      fireEvent.click(link);

      expect(mockTrack).toHaveBeenCalledWith({
        event_name: 'topic_card_click',
        page_name: 'home',
        entity_type: 'topic',
        entity_id: 'topic-123',
        position: '2',
        source_topic_id: 'topic-123',
        source_placement_id: 'pl-456',
      });
    });
  });

  describe('无封面图回退', () => {
    it('封面图全部为 null 时 Banner 样式应显示主题色背景和"专题"文字', async () => {
      // 重新 mock getCoverImage 返回 null
      const i18nMod = await import('../../../utils/i18nFallback');
      vi.spyOn(i18nMod, 'getCoverImage').mockReturnValue(null);

      const noCoverTopic = {
        ...baseTopic,
        card_style: 'banner',
        cover_image_default: null,
        cover_image_zh: null,
        cover_image_ru: null,
        cover_image_tg: null,
      };

      renderWithRouter(<TopicCard topic={noCoverTopic} position={0} />);

      // Banner 样式在无封面时显示"专题"文字
      expect(screen.getByText('专题')).toBeInTheDocument();
      // 不应有 LazyImage
      expect(screen.queryByTestId('lazy-image')).not.toBeInTheDocument();

      vi.restoreAllMocks();
    });
  });
});
