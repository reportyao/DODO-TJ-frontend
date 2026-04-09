/**
 * 专题详情页
 *
 * 展示专题的完整内容：封面图、标题、简介、正文块、挂载商品列表。
 * 路由：/topic/:slug
 *
 * 数据来源：get-topic-detail Edge Function
 * 埋点：topic_detail_view / topic_product_click
 *
 * 与现有页面保持一致的 Layout 壳结构。
 */
import React, { useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import { useUser } from '../contexts/UserContext';
import { getLocalizedText, formatCurrency } from '../lib/utils';
import { LazyImage } from '../components/LazyImage';
import { getCoverImage } from '../utils/i18nFallback';
import { useTopicDetail } from '../hooks/useHomeFeed';
import { useTrackEvent } from '../hooks/useTrackEvent';
import type {
  TopicDetail,
  TopicProductItem,
  StoryBlock,
  SupportedLang,
} from '../types/homepage';

// ============================================================
// 正文块渲染器
// ============================================================

const StoryBlockRenderer: React.FC<{ block: StoryBlock; lang: SupportedLang }> = ({
  block,
  lang,
}) => {
  const text = block[lang] || block.zh || block.ru || block.tg || '';

  switch (block.block_type) {
    case 'heading':
      return (
        <h2 className="text-lg font-bold text-gray-900 mt-6 mb-2">{text}</h2>
      );
    case 'paragraph':
      return (
        <p className="text-sm text-gray-700 leading-relaxed mb-3">{text}</p>
      );
    case 'image':
      return block.image_url ? (
        <div className="my-4 rounded-xl overflow-hidden">
          <LazyImage
            src={block.image_url}
            alt=""
            style={{ width: '100%' }}
          />
        </div>
      ) : null;
    case 'callout':
      return (
        <div className="my-4 bg-orange-50 border-l-4 border-orange-400 rounded-r-xl px-4 py-3">
          <p className="text-sm text-orange-800">{text}</p>
        </div>
      );
    case 'product_grid':
      // product_grid 在正文块中不渲染，商品列表在底部统一展示
      return null;
    default:
      return text ? (
        <p className="text-sm text-gray-700 leading-relaxed mb-3">{text}</p>
      ) : null;
  }
};

// ============================================================
// 专题商品卡片
// ============================================================

const TopicProductCard: React.FC<{
  item: TopicProductItem;
  lang: SupportedLang;
  topicId: string;
  onTrack: (productId: string, lotteryId?: string) => void;
  requireAuth: boolean;
}> = ({ item, lang, topicId, onTrack, requireAuth }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const title = getLocalizedText(
    item.name_i18n as Record<string, string>,
    lang
  );
  const badgeText = item.badge_text_i18n
    ? getLocalizedText(item.badge_text_i18n as Record<string, string>, lang)
    : '';
  const noteText = item.note_i18n
    ? getLocalizedText(item.note_i18n as Record<string, string>, lang)
    : '';

  const lottery = item.active_lottery;
  const imageUrl = item.image_url || '';

  const handleClick = (e: React.MouseEvent) => {
    onTrack(item.product_id, lottery?.lottery_id);
    if (requireAuth) {
      e.preventDefault();
      const target = lottery
        ? `/lottery/${lottery.lottery_id}?src_topic=${topicId}&src_page=topic_detail`
        : `/lottery/${item.product_id}?src_topic=${topicId}&src_page=topic_detail`;
      navigate(`/login?redirect=${encodeURIComponent(target)}`);
    }
  };

  // 构建带归因参数的链接
  const linkTo = lottery
    ? `/lottery/${lottery.lottery_id}?src_topic=${topicId}&src_page=topic_detail`
    : '#';

  return (
    <Link
      to={linkTo}
      onClick={handleClick}
      className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow relative block"
    >
      {/* 角标 */}
      {badgeText && (
        <div className="absolute top-2 left-2 z-10 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
          {badgeText}
        </div>
      )}

      {/* 商品图片 */}
      <div
        style={{
          paddingBottom: '100%',
          position: 'relative',
          backgroundColor: '#f3f4f6',
          overflow: 'hidden',
        }}
      >
        <LazyImage
          src={imageUrl}
          alt={title}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>

      {/* 商品信息 */}
      <div className="p-3">
        <h3
          className="text-sm font-medium text-gray-800 line-clamp-2 leading-tight mb-2"
          style={{ minHeight: '2.5rem' }}
        >
          {title}
        </h3>

        {/* 编辑备注 */}
        {noteText && (
          <p className="text-[11px] text-gray-500 mb-1 line-clamp-1">{noteText}</p>
        )}

        {/* 价格 */}
        {lottery ? (
          <>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-lg font-bold text-red-500">
                {formatCurrency(lottery.currency || 'TJS', item.original_price)}
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-500 border border-red-100 whitespace-nowrap">
                {t('subsidyPool.subsidyPrice')}
              </span>
            </div>
            {lottery.ticket_price > 0 && (
              <div className="flex items-center mt-1">
                <span className="text-[11px] text-orange-500 font-medium">
                  {t('product.startFrom')} {formatCurrency(lottery.currency || 'TJS', lottery.ticket_price)}/{t('product.perUnit')}
                </span>
              </div>
            )}
            {/* 进度条 */}
            {lottery.total_tickets > 0 && (
              <div className="mt-2">
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className="bg-gradient-to-r from-orange-400 to-red-500 h-1.5 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        (lottery.sold_tickets / lottery.total_tickets) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-gray-400">{formatCurrency('TJS', item.original_price)}</span>
        )}
      </div>
    </Link>
  );
};

// ============================================================
// 主页面
// ============================================================

const TopicDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { i18n, t } = useTranslation();
  const { user } = useUser();
  const { track } = useTrackEvent();
  const navigate = useNavigate();
  const lang = i18n.language as SupportedLang;

  const { data, isLoading, error } = useTopicDetail(slug || '');

  const topic: TopicDetail | null = data?.topic || null;
  const products: TopicProductItem[] = data?.products || [];

  // 页面浏览埋点
  useEffect(() => {
    if (topic?.id) {
      track({
        event_name: 'topic_detail_view',
        page_name: 'topic_detail',
        entity_type: 'topic',
        entity_id: topic.id,
        source_topic_id: topic.id,
      });
    }
  }, [topic?.id, track]);

  // 商品点击埋点
  const handleProductTrack = (productId: string, lotteryId?: string) => {
    track({
      event_name: 'topic_product_click',
      page_name: 'topic_detail',
      entity_type: 'product',
      entity_id: productId,
      source_topic_id: topic?.id,
      lottery_id: lotteryId,
      inventory_product_id: productId,
    });
  };

  // 加载中
  if (isLoading) {
    return (
      <div className="pb-20 bg-gray-50">
        <div className="animate-pulse">
          <div className="h-48 bg-gray-200" />
          <div className="px-4 pt-4 space-y-3">
            <div className="h-6 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
            <div className="h-20 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  // 错误 / 未找到
  if (error || !topic) {
    return (
      <div className="pb-20 bg-gray-50">
        <div className="px-4 pt-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-gray-600 mb-4"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-1" />
            {t('common.back')}
          </button>
          <div className="text-center py-12">
            <p className="text-gray-400">{t('common.noData')}</p>
          </div>
        </div>
      </div>
    );
  }

  const title = getLocalizedText(topic.title_i18n as Record<string, string>, lang);
  const subtitle = topic.subtitle_i18n
    ? getLocalizedText(topic.subtitle_i18n as Record<string, string>, lang)
    : '';
  const intro = topic.intro_i18n
    ? getLocalizedText(topic.intro_i18n as Record<string, string>, lang)
    : '';

  // [BUG-M6 修复] 传递 cover_image_url 给 getCoverImage，支持 AI 生成的封面图
  const coverUrl = getCoverImage(
    {
      cover_image_default: topic.cover_image_default,
      cover_image_zh: topic.cover_image_zh,
      cover_image_ru: topic.cover_image_ru,
      cover_image_tg: topic.cover_image_tg,
      cover_image_url: (topic as any).cover_image_url,
    },
    lang
  );

  const storyBlocks: StoryBlock[] = topic.story_blocks_i18n || [];

  return (
    <div className="pb-20 bg-gray-50">
      {/* 封面图 */}
      {coverUrl && (
        <div className="relative">
          <LazyImage
            src={coverUrl}
            alt={title}
            priority="high"
            style={{ width: '100%', aspectRatio: '2/1', objectFit: 'cover' }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

          {/* 返回按钮 */}
          <button
            onClick={() => navigate(-1)}
            className="absolute top-4 left-4 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center"
          >
            <ArrowLeftIcon className="w-4 h-4 text-white" />
          </button>
        </div>
      )}

      {/* 无封面时的返回按钮 */}
      {!coverUrl && (
        <div className="px-4 pt-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-gray-600 mb-2"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-1" />
            {t('common.back')}
          </button>
        </div>
      )}

      {/* 标题区 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-4 pt-4"
      >
        <h1 className="text-xl font-bold text-gray-900 leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        )}
        {intro && (
          <p className="text-sm text-gray-600 mt-3 leading-relaxed">{intro}</p>
        )}
      </motion.div>

      {/* 正文块 */}
      {storyBlocks.length > 0 && (
        <div className="px-4 mt-2">
          {storyBlocks.map((block, idx) => (
            <StoryBlockRenderer key={block.block_key || idx} block={block} lang={lang} />
          ))}
        </div>
      )}

      {/* 挂载商品列表 */}
      {products.length > 0 && (
        <div className="px-4 mt-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            {t('home.lotteryProducts')}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {products.map((item) => (
              <TopicProductCard
                key={item.product_id}
                item={item}
                lang={lang}
                topicId={topic.id}
                onTrack={handleProductTrack}
                requireAuth={!user}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TopicDetailPage;
