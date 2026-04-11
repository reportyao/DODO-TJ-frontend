/**
 * 专题卡片组件
 *
 * 在首页 Feed 流中展示专题投放卡片。
 * 支持多种卡片样式（hero / standard / banner / mini），自动曝光埋点。
 *
 * [审查修复]
 * - 补充 topic_card_click 点击埋点
 * - 修复 standard 样式，使其与商品瀑布流卡片保持一致的上图下文双列视觉
 * - 抽取样式归一化与栅格跨度逻辑，避免首页把四种样式都渲染成同一种宽度
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { getLocalizedText } from '../../lib/utils';
import { LazyImage } from '../LazyImage';
import { useExposureTracker, useTrackEvent } from '../../hooks/useTrackEvent';
import { getCoverImage } from '../../utils/i18nFallback';
import type { HomeFeedTopicData, SupportedLang } from '../../types/homepage';

interface TopicCardProps {
  topic: HomeFeedTopicData;
  position: number;
}

type TopicCardStyle = 'hero' | 'standard' | 'banner' | 'mini';

export function normalizeTopicCardStyle(
  cardVariantName?: string | null,
  cardStyle?: string | null
): TopicCardStyle {
  const candidate = (cardVariantName || cardStyle || 'banner').trim().toLowerCase();
  if (
    candidate === 'hero' ||
    candidate === 'standard' ||
    candidate === 'banner' ||
    candidate === 'mini'
  ) {
    return candidate;
  }
  return 'banner';
}

export function getTopicCardGridSpan(style: TopicCardStyle): 'col-span-1' | 'col-span-2' {
  return style === 'standard' || style === 'mini' ? 'col-span-1' : 'col-span-2';
}

/**
 * Hero 样式卡片 - 全宽大图 + 底部渐变文字叠加
 */
const HeroCard: React.FC<
  TopicCardProps & { coverUrl: string; title: string; subtitle: string; t: (key: string) => string }
> = ({ topic, coverUrl, title, subtitle, t }) => {
  return (
    <div className="relative rounded-2xl overflow-hidden shadow-lg">
      <div
        className="aspect-[2/1] bg-gray-100"
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
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
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ backgroundColor: topic.theme_color || '#f97316' }}
          >
            <span className="text-white text-2xl font-bold">{title}</span>
          </div>
        )}
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h3 className="text-white font-bold text-base leading-tight line-clamp-2">{title}</h3>
        {subtitle && <p className="text-white/80 text-xs mt-1 line-clamp-1">{subtitle}</p>}
      </div>

      {topic.theme_color && (
        <div
          className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: topic.theme_color }}
        >
          {t('home.topic')}
        </div>
      )}
    </div>
  );
};

/**
 * Standard 样式卡片 - 与商品瀑布流卡片一致的上图下文双列布局
 */
const StandardCard: React.FC<
  TopicCardProps & { coverUrl: string; title: string; subtitle: string; t: (key: string) => string }
> = ({ topic, coverUrl, title, subtitle, t }) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow relative block">
      {topic.theme_color && (
        <div
          className="absolute top-2 left-2 z-10 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm"
          style={{ backgroundColor: topic.theme_color }}
        >
          {t('home.topic')}
        </div>
      )}

      <div
        style={{
          paddingBottom: '100%',
          position: 'relative',
          backgroundColor: '#f3f4f6',
          overflow: 'hidden',
        }}
      >
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
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
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: topic.theme_color || '#f97316' }}
          >
            <span className="text-white text-sm font-bold px-3 text-center line-clamp-2">
              {title}
            </span>
          </div>
        )}
      </div>

      <div className="p-3">
        <h3
          className="text-sm font-medium text-gray-800 line-clamp-2 leading-tight mb-2"
          style={{ minHeight: '2.5rem' }}
        >
          {title}
        </h3>

        {subtitle && (
          <p className="text-[11px] text-gray-500 line-clamp-2 mb-2" style={{ minHeight: '2rem' }}>
            {subtitle}
          </p>
        )}

        <div className="flex items-center mt-1">
          <span className="text-[11px] text-orange-500 font-medium">{t('home.viewDetails')} →</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Banner 样式卡片 - 横条式
 */
const BannerCard: React.FC<
  TopicCardProps & { coverUrl: string; title: string; subtitle: string; t: (key: string) => string }
> = ({ topic, coverUrl, title, subtitle, t }) => {
  return (
    <div className="flex items-center bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-24 hover:shadow-md transition-shadow">
      <div
        className="w-24 h-full flex-shrink-0 bg-gray-100"
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
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
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ backgroundColor: topic.theme_color || '#f97316' }}
          >
            <span className="text-white text-sm font-bold">{t('home.topic')}</span>
          </div>
        )}
      </div>

      <div className="flex-1 px-3 py-2 min-w-0">
        <h3 className="text-sm font-bold text-gray-800 line-clamp-2 leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{subtitle}</p>}
        <span className="inline-block mt-1.5 text-[10px] text-orange-500 font-medium">
          {t('home.viewDetails')} →
        </span>
      </div>
    </div>
  );
};

/**
 * Mini 样式卡片 - 紧凑型
 */
const MiniCard: React.FC<TopicCardProps & { title: string; t: (key: string) => string }> = ({
  topic,
  title,
  t,
}) => {
  return (
    <div
      className="rounded-xl px-4 py-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
      style={{
        background: topic.theme_color
          ? `linear-gradient(135deg, ${topic.theme_color}15, ${topic.theme_color}05)`
          : 'linear-gradient(135deg, #fff7ed, #ffffff)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2 min-w-0">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: topic.theme_color || '#f97316' }}
          />
          <span className="text-sm font-medium text-gray-800 line-clamp-2">{title}</span>
        </div>
        <span className="text-[11px] text-orange-500 font-medium flex-shrink-0">
          {t('home.goSee')} →
        </span>
      </div>
    </div>
  );
};

/**
 * 专题卡片入口组件
 */
export const TopicCard: React.FC<TopicCardProps> = ({ topic, position }) => {
  const { i18n, t } = useTranslation();
  const { track } = useTrackEvent();
  const lang = i18n.language as SupportedLang;

  const title = getLocalizedText(topic.title_i18n as Record<string, string>, lang);
  const subtitle = getLocalizedText((topic.subtitle_i18n || {}) as Record<string, string>, lang);

  const coverUrl = getCoverImage(
    {
      cover_image_default: topic.cover_image_default,
      cover_image_zh: topic.cover_image_zh,
      cover_image_ru: topic.cover_image_ru,
      cover_image_tg: topic.cover_image_tg,
      cover_image_url: topic.cover_image_url,
    },
    lang
  );

  const exposureRef = useExposureTracker({
    event_name: 'topic_card_expose',
    page_name: 'home',
    entity_type: 'topic',
    entity_id: topic.topic_id,
    position: String(position),
    source_topic_id: topic.topic_id,
    source_placement_id: topic.placement_id,
  });

  const cardStyle = normalizeTopicCardStyle(topic.card_variant_name, topic.card_style);

  const handleClick = (): void => {
    track({
      event_name: 'topic_card_click',
      page_name: 'home',
      entity_type: 'topic',
      entity_id: topic.topic_id,
      position: String(position),
      source_topic_id: topic.topic_id,
      source_placement_id: topic.placement_id,
    });
  };

  const renderCard = (): React.ReactNode => {
    switch (cardStyle) {
      case 'hero':
        return (
          <HeroCard
            topic={topic}
            position={position}
            coverUrl={coverUrl}
            title={title}
            subtitle={subtitle}
            t={t}
          />
        );
      case 'standard':
        return (
          <StandardCard
            topic={topic}
            position={position}
            coverUrl={coverUrl}
            title={title}
            subtitle={subtitle}
            t={t}
          />
        );
      case 'mini':
        return <MiniCard topic={topic} position={position} title={title} t={t} />;
      case 'banner':
      default:
        return (
          <BannerCard
            topic={topic}
            position={position}
            coverUrl={coverUrl}
            title={title}
            subtitle={subtitle}
            t={t}
          />
        );
    }
  };

  return (
    <motion.div
      ref={exposureRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: position * 0.05, duration: 0.3 }}
    >
      <Link
        to={`/topic/${topic.slug}?src_topic=${topic.topic_id}&src_placement=${topic.placement_id || ''}&src_page=home`}
        className="block"
        onClick={handleClick}
      >
        {renderCard()}
      </Link>
    </motion.div>
  );
};

export default TopicCard;
