/**
 * 场景化商品卡片
 *
 * 在首页 Feed 流中展示单个商品，带曝光追踪。
 * 复用现有 ProductList 的卡片视觉样式（上图下文、双列网格），
 * 但增加了曝光埋点和来源追踪能力。
 *
 * 与 ProductList 中的卡片保持完全一致的视觉风格。
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../../contexts/UserContext';
import { formatCurrency, getLocalizedText, getOptimizedImageUrl } from '../../lib/utils';
import { useExposureTracker } from '../../hooks/useTrackEvent';
import type { HomeFeedProductData } from '../../types/homepage';

interface SceneProductCardProps {
  product: HomeFeedProductData;
  position: number;
  sourceCategoryId?: string;
}

export const SceneProductCard: React.FC<SceneProductCardProps> = ({
  product,
  position,
  sourceCategoryId,
}) => {
  const { i18n, t } = useTranslation();
  const { user } = useUser();
  const navigate = useNavigate();

  const title = getLocalizedText(
    product.title_i18n as Record<string, string>,
    i18n.language
  ) || getLocalizedText(
    product.description_i18n as Record<string, string>,
    i18n.language
  );

  // 曝光追踪
  const exposureRef = useExposureTracker({
    event_name: 'product_card_expose',
    page_name: 'home',
    entity_type: 'product',
    entity_id: product.inventory_product_id,
    position: String(position),
    lottery_id: product.lottery_id,
    inventory_product_id: product.inventory_product_id,
    source_category_id: sourceCategoryId,
  });

  // 竞品最高价
  const competitorPrice = product.price_comparisons?.length
    ? Math.max(...(product.price_comparisons as { price: number }[]).map((pc) => pc.price))
    : null;
  const savingsPercent =
    competitorPrice && competitorPrice > product.original_price
      ? Math.round((1 - product.original_price / competitorPrice) * 100)
      : 0;

  const handleClick = (e: React.MouseEvent) => {
    if (!user) {
      e.preventDefault();
      navigate(`/login?redirect=${encodeURIComponent(`/lottery/${product.lottery_id}`)}`);
    }
  };

  const imageUrl = product.image_url
    ? getOptimizedImageUrl(product.image_url, { width: 400, quality: 75 })
    : '';

  return (
    <div ref={exposureRef}>
      <Link
        to={`/lottery/${product.lottery_id}`}
        onClick={handleClick}
        className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow relative block"
      >
        {/* 节省百分比角标 */}
        {savingsPercent > 0 && (
          <div className="absolute top-2 left-2 z-10 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            -{savingsPercent}%
          </div>
        )}

        {/* 商品图片 - 1:1 比例容器 */}
        <div
          style={{
            paddingBottom: '100%',
            position: 'relative',
            backgroundColor: '#f3f4f6',
            overflow: 'hidden',
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              loading="lazy"
              decoding="async"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23f0f0f0" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-size="14"%3ENo Image%3C/text%3E%3C/svg%3E';
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
                backgroundColor: '#f3f4f6',
              }}
            >
              <span style={{ fontSize: '0.75rem' }}>No Image</span>
            </div>
          )}
        </div>

        {/* 商品信息 */}
        <div className="p-3">
          <h3
            className="text-sm font-medium text-gray-800 line-clamp-2 leading-tight mb-2"
            style={{ minHeight: '2.5rem' }}
          >
            {title}
          </h3>

          {/* 价格区域 */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-lg font-bold text-red-500">
              {formatCurrency(product.currency || 'TJS', product.original_price)}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-500 border border-red-100 whitespace-nowrap">
              {t('subsidyPool.subsidyPrice')}
            </span>
          </div>

          {/* 竞品价格划线对比 */}
          {competitorPrice && competitorPrice > product.original_price && (
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[11px] text-gray-400 line-through">
                {formatCurrency(product.currency || 'TJS', competitorPrice)}
              </span>
              <span className="text-[10px] text-gray-400">
                {(product.price_comparisons as { platform?: string }[])?.[0]?.platform || ''}
              </span>
            </div>
          )}

          {/* 单份价格提示 */}
          {product.ticket_price > 0 && (
            <div className="flex items-center mt-1">
              <span className="text-[11px] text-orange-500 font-medium">
                {t('product.startFrom')} {formatCurrency(product.currency || 'TJS', product.ticket_price)}/{t('product.perUnit')}
              </span>
            </div>
          )}

          {/* 进度条 */}
          {product.total_tickets > 0 && (
            <div className="mt-2">
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-orange-400 to-red-500 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${Math.min((product.sold_tickets / product.total_tickets) * 100, 100)}%`,
                  }}
                />
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[10px] text-gray-400">
                  {product.sold_tickets}/{product.total_tickets}
                </span>
              </div>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
};

export default SceneProductCard;
