/**
 * 专题详情页 v2 — AppStore Today 风格
 *
 * 结构：
 *   封面图 → 标题 / 副标题 → 引导正文
 *   → 段落1（场景文案 + 横向商品卡片列表）
 *   → 段落2（场景文案 + 横向商品卡片列表）
 *   → ...
 *
 * 路由：/topic/:slug
 * 数据来源：get-topic-detail Edge Function (v2 sections 模式)
 * 埋点：topic_detail_view / topic_product_click
 */
import React, { useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeftIcon, ShoppingCartIcon } from '@heroicons/react/24/solid';
import { useUser } from '../contexts/UserContext';
import { getLocalizedText, formatCurrency } from '../lib/utils';
import { LazyImage } from '../components/LazyImage';
import { getCoverImage } from '../utils/i18nFallback';
import { useTopicDetail } from '../hooks/useHomeFeed';
import { useTrackEvent } from '../hooks/useTrackEvent';
import type {
  TopicDetail,
  TopicProductItem,
  TopicSection,
  PriceComparison,
  SupportedLang,
} from '../types/homepage';

// ============================================================
// 横向商品卡片 — 左图右信息
// ============================================================

const HorizontalProductCard: React.FC<{
  item: TopicProductItem;
  lang: SupportedLang;
  topicId: string;
  onTrack: (productId: string, lotteryId?: string) => void;
  requireAuth: boolean;
}> = ({ item, lang, topicId, onTrack, requireAuth }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const title = getLocalizedText(item.name_i18n as Record<string, string>, lang);
  const lottery = item.active_lottery;
  const imageUrl = item.image_url || '';

  // 竞品价格（有就展示，没有就不展示）
  const priceComparisons: PriceComparison[] = (lottery?.price_comparisons as PriceComparison[]) || [];

  const handleClick = (e: React.MouseEvent) => {
    onTrack(item.product_id, lottery?.lottery_id);
    const target = lottery
      ? `/lottery/${lottery.lottery_id}?src_topic=${topicId}&src_page=topic_detail`
      : `/lottery/${item.product_id}?src_topic=${topicId}&src_page=topic_detail`;

    if (requireAuth) {
      e.preventDefault();
      navigate(`/login?redirect=${encodeURIComponent(target)}`);
    }
  };

  const linkTo = lottery
    ? `/lottery/${lottery.lottery_id}?src_topic=${topicId}&src_page=topic_detail`
    : '#';

  return (
    <Link
      to={linkTo}
      onClick={handleClick}
      className="flex bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all active:scale-[0.98] group"
    >
      {/* 左侧商品图 */}
      <div className="relative flex-shrink-0 w-28 h-28 bg-gray-100">
        <LazyImage
          src={imageUrl}
          alt={title}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        {/* 角标 */}
        {item.badge_text_i18n && (
          <div className="absolute top-1.5 left-1.5 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            {getLocalizedText(item.badge_text_i18n as Record<string, string>, lang)}
          </div>
        )}
      </div>

      {/* 右侧信息 */}
      <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
        {/* 标题 */}
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">
          {title}
        </h3>

        {/* 价格区域 */}
        <div className="mt-auto">
          {lottery ? (
            <div className="space-y-1">
              {/* DODO 价格 */}
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold text-red-500">
                  {formatCurrency(lottery.currency || 'TJS', item.original_price)}
                </span>
                <span className="text-[9px] font-medium bg-red-50 text-red-500 border border-red-100 px-1 py-0.5 rounded">
                  DODO
                </span>
              </div>

              {/* 竞品价格对比 */}
              {priceComparisons.length > 0 && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {priceComparisons.slice(0, 2).map((pc, idx) => (
                    <span key={idx} className="text-[10px] text-gray-400 line-through">
                      {pc.platform}: {formatCurrency(pc.currency || lottery.currency || 'TJS', pc.price)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-sm font-bold text-gray-600">
              {formatCurrency('TJS', item.original_price)}
            </span>
          )}
        </div>

        {/* 购买按钮 */}
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-full group-hover:shadow-md transition-shadow">
            <ShoppingCartIcon className="w-3 h-3" />
            {t('product.buyNow', '立即购买')}
          </span>
        </div>
      </div>
    </Link>
  );
};

// ============================================================
// 段落区块 — 场景文案 + 商品列表
// ============================================================

const SectionBlock: React.FC<{
  section: TopicSection;
  sectionIndex: number;
  lang: SupportedLang;
  topicId: string;
  onTrack: (productId: string, lotteryId?: string) => void;
  requireAuth: boolean;
}> = ({ section, sectionIndex, lang, topicId, onTrack, requireAuth }) => {
  const storyText = section.story_text_i18n
    ? getLocalizedText(section.story_text_i18n as Record<string, string>, lang)
    : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 * sectionIndex, duration: 0.4 }}
      className="mt-6"
    >
      {/* 场景化文案 */}
      {storyText && (
        <div className="px-4 mb-3">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            {storyText}
          </p>
        </div>
      )}

      {/* 横向商品卡片列表 */}
      {section.products.length > 0 && (
        <div className="px-4 space-y-3">
          {section.products.map((item) => (
            <HorizontalProductCard
              key={item.product_id}
              item={item}
              lang={lang}
              topicId={topicId}
              onTrack={onTrack}
              requireAuth={requireAuth}
            />
          ))}
        </div>
      )}
    </motion.div>
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
  // v2: 优先使用 sections，兼容 v1 products
  const sections: TopicSection[] = data?.sections || [];
  const flatProducts = data?.products || [];

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
      <div className="pb-20 bg-gray-50 min-h-screen">
        <div className="animate-pulse">
          <div className="h-52 bg-gray-200" />
          <div className="px-4 pt-5 space-y-3">
            <div className="h-7 bg-gray-200 rounded-lg w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
            <div className="h-16 bg-gray-200 rounded-lg" />
            <div className="space-y-3 mt-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-28 h-28 bg-gray-200 rounded-2xl flex-shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                    <div className="h-6 bg-gray-200 rounded w-20 mt-auto" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 错误 / 未找到
  if (error || !topic) {
    return (
      <div className="pb-20 bg-gray-50 min-h-screen">
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

  const titleText = getLocalizedText(topic.title_i18n as Record<string, string>, lang);
  const subtitleText = topic.subtitle_i18n
    ? getLocalizedText(topic.subtitle_i18n as Record<string, string>, lang)
    : '';
  const introText = topic.intro_i18n
    ? getLocalizedText(topic.intro_i18n as Record<string, string>, lang)
    : '';

  // 封面图：优先使用 cover_image_url（AI生成），其次使用多语言封面
  const coverUrl = topic.cover_image_url || getCoverImage(
    {
      cover_image_default: topic.cover_image_default,
      cover_image_zh: topic.cover_image_zh,
      cover_image_ru: topic.cover_image_ru,
      cover_image_tg: topic.cover_image_tg,
    },
    lang
  );

  // 判断是否有 sections 数据
  const hasSections = sections.length > 0;

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* ==================== 封面图 ==================== */}
      {coverUrl ? (
        <div className="relative">
          <LazyImage
            src={coverUrl}
            alt={titleText}
            priority="high"
            style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }}
          />
          {/* 渐变遮罩 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />

          {/* 返回按钮 */}
          <button
            onClick={() => navigate(-1)}
            className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform"
          >
            <ArrowLeftIcon className="w-4.5 h-4.5 text-white" />
          </button>

          {/* 封面上的标题（AppStore 风格） */}
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
            <h1 className="text-xl font-bold text-white leading-tight drop-shadow-lg">
              {titleText}
            </h1>
            {subtitleText && (
              <p className="text-sm text-white/80 mt-1 drop-shadow">{subtitleText}</p>
            )}
          </div>
        </div>
      ) : (
        /* 无封面时 */
        <div className="px-4 pt-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-gray-600 mb-3"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-1" />
            {t('common.back')}
          </button>
          <h1 className="text-xl font-bold text-gray-900 leading-tight">
            {titleText}
          </h1>
          {subtitleText && (
            <p className="text-sm text-gray-500 mt-1">{subtitleText}</p>
          )}
        </div>
      )}

      {/* ==================== 引导正文 ==================== */}
      {introText && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="px-4 mt-4"
        >
          <p className="text-sm text-gray-600 leading-relaxed">
            {introText}
          </p>
        </motion.div>
      )}

      {/* ==================== 分隔线 ==================== */}
      <div className="mx-4 mt-4 border-t border-gray-200/60" />

      {/* ==================== v2: Sections 段落 + 商品 ==================== */}
      {hasSections ? (
        sections.map((section, idx) => (
          <SectionBlock
            key={section.story_group ?? idx}
            section={section}
            sectionIndex={idx}
            lang={lang}
            topicId={topic.id}
            onTrack={handleProductTrack}
            requireAuth={!user}
          />
        ))
      ) : (
        /* v1 兼容：平铺商品列表（横向卡片） */
        flatProducts.length > 0 && (
          <div className="px-4 mt-6 space-y-3">
            {flatProducts.map((item) => (
              <HorizontalProductCard
                key={item.product_id}
                item={item}
                lang={lang}
                topicId={topic.id}
                onTrack={handleProductTrack}
                requireAuth={!user}
              />
            ))}
          </div>
        )
      )}

      {/* 底部留白 */}
      <div className="h-8" />
    </div>
  );
};

export default TopicDetailPage;
