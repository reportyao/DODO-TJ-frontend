/**
 * 专题卡片组件
 *
 * 在首页 Feed 流中展示专题投放卡片。
 * 支持多种卡片样式（hero / standard / banner / mini），自动曝光埋点。
 *
 * 与现有 ProductList 卡片保持一致的圆角、阴影、间距风格。
 *
 * [审查修复]
 * - 补充 topic_card_click 点击埋点（原实现 onClick 为空函数，
 *   导致行为仪表盘 topic CTR 始终为 0）
 * - 新增独立的 StandardCard 样式，与 HeroCard 区分
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

/**
 * Hero 样式卡片 - 全宽大图 + 底部渐变文字叠加
 * 用于 feed_position 靠前的重点专题，视觉冲击力最强
 * 宽高比 2:1，全出血大图
 */
const HeroCard: React.FC<TopicCardProps & { coverUrl: string; title: string; subtitle: string; t: (key: string) => string }> = ({
  topic,
  coverUrl,
  title,
  subtitle,
  t,
}) => {
  return (
    <div className="relative rounded-2xl overflow-hidden shadow-lg">
      {/* 封面图 - 2:1 宽高比 */}
      <div className="aspect-[2/1] bg-gray-100" style={{ position: 'relative', overflow: 'hidden' }}>
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
            alt={title}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
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

      {/* 渐变遮罩 + 文字 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h3 className="text-white font-bold text-base leading-tight line-clamp-2">
          {title}
        </h3>
        {subtitle && (
          <p className="text-white/80 text-xs mt-1 line-clamp-1">{subtitle}</p>
        )}
      </div>

      {/* 主题色角标 */}
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
 * Standard 样式卡片 - 左图右文横排布局
 * 与 Hero 的全出血大图不同，Standard 是更紧凑的图文并排卡片
 * 左侧方形封面 + 右侧标题/副标题/标签，适合中等优先级的专题展示
 */
const StandardCard: React.FC<TopicCardProps & { coverUrl: string; title: string; subtitle: string; t: (key: string) => string }> = ({
  topic,
  coverUrl,
  title,
  subtitle,
  t,
}) => {
  return (
    <div className="flex bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 左侧封面 - 正方形 */}
      <div className="w-32 h-32 flex-shrink-0 bg-gray-100 relative overflow-hidden">
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
            alt={title}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
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

      {/* 右侧文字区域 */}
      <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
        <div>
          {/* 主题标签 */}
          {topic.theme_color && (
            <span
              className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white mb-1.5"
              style={{ backgroundColor: topic.theme_color }}
            >
              {t('home.topic')}
            </span>
          )}
          <h3 className="text-sm font-bold text-gray-800 line-clamp-2 leading-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{subtitle}</p>
          )}
        </div>
        <span className="inline-block text-[11px] text-orange-500 font-medium mt-1">
          {t('home.viewDetails')} →
        </span>
      </div>
    </div>
  );
};

/**
 * Banner 样式卡片 - 横条式
 * 用于中间位置的专题推荐，更紧凑
 */
const BannerCard: React.FC<TopicCardProps & { coverUrl: string; title: string; subtitle: string; t: (key: string) => string }> = ({
  topic,
  coverUrl,
  title,
  subtitle,
  t,
}) => {
  return (
    <div className="flex items-center bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-24">
      {/* 左侧封面 */}
      <div className="w-24 h-full flex-shrink-0 bg-gray-100" style={{ position: 'relative', overflow: 'hidden' }}>
        {coverUrl ? (
          <LazyImage
            src={coverUrl}
            alt={title}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
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

      {/* 右侧文字 */}
      <div className="flex-1 px-3 py-2">
        <h3 className="text-sm font-bold text-gray-800 line-clamp-2 leading-tight">
          {title}
        </h3>
        {subtitle && (
          <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{subtitle}</p>
        )}
        <span className="inline-block mt-1.5 text-[10px] text-orange-500 font-medium">
          {t('home.viewDetails')} →
        </span>
      </div>
    </div>
  );
};

/**
 * Mini 样式卡片 - 紧凑型
 * 用于 feed 流中穿插的小型推荐
 */
const MiniCard: React.FC<TopicCardProps & { title: string; t: (key: string) => string }> = ({
  topic,
  title,
  t,
}) => {
  return (
    <div
      className="rounded-xl px-4 py-3 shadow-sm border border-gray-100"
      style={{
        background: topic.theme_color
          ? `linear-gradient(135deg, ${topic.theme_color}15, ${topic.theme_color}05)`
          : 'linear-gradient(135deg, #fff7ed, #ffffff)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: topic.theme_color || '#f97316' }}
          />
          <span className="text-sm font-medium text-gray-800 line-clamp-1">
            {title}
          </span>
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
 *
 * 根据 card_style 自动选择卡片样式，包裹 Link 和曝光追踪。
 */
export const TopicCard: React.FC<TopicCardProps> = ({ topic, position }) => {
  const { i18n, t } = useTranslation();
  const { track } = useTrackEvent();
  const lang = i18n.language as SupportedLang;

  const title = getLocalizedText(
    topic.title_i18n as Record<string, string>,
    lang
  );
  const subtitle = getLocalizedText(
    (topic.subtitle_i18n || {}) as Record<string, string>,
    lang
  );

  // 获取当前语言的封面图
  const coverUrl = getCoverImage(
    {
      cover_image_default: topic.cover_image_default,
      cover_image_zh: topic.cover_image_zh,
      cover_image_ru: topic.cover_image_ru,
      cover_image_tg: topic.cover_image_tg,
    },
    lang
  );

  // 曝光追踪
  const exposureRef = useExposureTracker({
    event_name: 'topic_card_expose',
    page_name: 'home',
    entity_type: 'topic',
    entity_id: topic.topic_id,
    position: String(position),
    source_topic_id: topic.topic_id,
    source_placement_id: topic.placement_id,
  });

  // [修复] 优先使用投放级 card_variant_name（管理员在投放管理中设置），
  // fallback 到专题级 card_style，最终 fallback 到 'banner'
  const cardStyle = topic.card_variant_name || topic.card_style || 'banner';

  /**
   * [修复] 补充 topic_card_click 点击埋点
   */
  const handleClick = () => {
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

  const renderCard = () => {
    switch (cardStyle) {
      case 'hero':
        return <HeroCard topic={topic} position={position} coverUrl={coverUrl} title={title} subtitle={subtitle} t={t} />;
      case 'standard':
        return <StandardCard topic={topic} position={position} coverUrl={coverUrl} title={title} subtitle={subtitle} t={t} />;
      case 'mini':
        return <MiniCard topic={topic} position={position} title={title} t={t} />;
      case 'banner':
      default:
        return <BannerCard topic={topic} position={position} coverUrl={coverUrl} title={title} subtitle={subtitle} t={t} />;
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
