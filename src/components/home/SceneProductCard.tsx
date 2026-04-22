/**
 * 场景化商品卡片
 *
 * 优化目标：
 * - 标题拥有更高优先级，适应俄语/塔吉克语长文案
 * - 价格仍清晰，但不再压过商品识别信息
 * - 辅助信息更轻、更结构化，降低双列卡片噪音
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../../contexts/UserContext';
import { getLocalizedText } from '../../lib/utils';
import { LazyImage } from '../LazyImage';
import { useExposureTracker, useTrackEvent } from '../../hooks/useTrackEvent';
import type { HomeFeedProductData } from '../../types/homepage';

let lotteryDetailPagePreloadPromise: Promise<unknown> | null = null;

function preloadLotteryDetailPage() {
  if (!lotteryDetailPagePreloadPromise) {
    lotteryDetailPagePreloadPromise = import('../../pages/LotteryDetailPage').catch((error) => {
      console.warn('[SceneProductCard] Failed to preload LotteryDetailPage chunk:', error);
      lotteryDetailPagePreloadPromise = null;
      throw error;
    });
  }

  return lotteryDetailPagePreloadPromise.catch(() => {
    return null;
  });
}

function getLocale(language: string): string {
  if (language.startsWith('ru')) {return 'ru-RU';}
  if (language.startsWith('tg')) {return 'tg-TJ';}
  return 'zh-CN';
}

function formatCompactAmount(amount: number | undefined | null, language: string): string {
  const safeAmount = typeof amount === 'number' ? amount : 0;
  const hasFraction = Math.abs(safeAmount % 1) > 0.001;

  return new Intl.NumberFormat(getLocale(language), {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(safeAmount);
}

interface SceneProductCardProps {
  product: HomeFeedProductData;
  position: number;
  sourceCategoryId?: string;
}

export const SceneProductCard: React.FC<SceneProductCardProps> = React.memo(({
  product,
  position,
  sourceCategoryId,
}) => {
  const { i18n, t } = useTranslation();
  const { user } = useUser();
  const navigate = useNavigate();
  const { track } = useTrackEvent();

  const title = getLocalizedText(
    product.title_i18n as Record<string, string>,
    i18n.language
  ) || '';

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

  const competitorPrice = product.price_comparisons?.length
    ? Math.max(...(product.price_comparisons as { price: number }[]).map((pc) => pc.price))
    : null;
  const competitorPlatform = (product.price_comparisons as { platform?: string }[] | undefined)?.[0]?.platform || '';
  const savingsPercent = competitorPrice && competitorPrice > product.original_price
    ? Math.round((1 - product.original_price / competitorPrice) * 100)
    : 0;

  const buildLotteryLink = () => {
    const params = new URLSearchParams();
    params.set('src_page', 'home');
    if (sourceCategoryId) {params.set('src_category', sourceCategoryId);}
    return `/lottery/${product.lottery_id}?${params.toString()}`;
  };
  const lotteryLink = buildLotteryLink();

  const handlePrefetch = React.useCallback(() => {
    void preloadLotteryDetailPage();
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    handlePrefetch();

    track({
      event_name: 'product_card_click',
      page_name: 'home',
      entity_type: 'product',
      entity_id: product.inventory_product_id,
      position: String(position),
      lottery_id: product.lottery_id,
      inventory_product_id: product.inventory_product_id,
      source_category_id: sourceCategoryId,
    });

    if (!user) {
      e.preventDefault();
      navigate(`/login?redirect=${encodeURIComponent(lotteryLink)}`);
    }
  };

  const imageUrl = product.image_url || '';
  const imagePriority = position < 4 ? 'high' : 'low';
  const currency = product.currency || 'TJS';
  const originalPriceText = formatCompactAmount(product.original_price, i18n.language);
  const competitorPriceText = competitorPrice ? formatCompactAmount(competitorPrice, i18n.language) : '';
  const ticketPriceText = formatCompactAmount(product.ticket_price, i18n.language);
  const progressPercent = product.total_tickets > 0
    ? Math.min((product.sold_tickets / product.total_tickets) * 100, 100)
    : 0;

  return (
    <div ref={exposureRef}>
      <Link
        to={lotteryLink}
        onClick={handleClick}
        onMouseEnter={handlePrefetch}
        onTouchStart={handlePrefetch}
        onFocus={handlePrefetch}
        className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-shadow relative block"
      >
        {savingsPercent > 0 && (
          <div className="absolute top-2 left-2 z-10 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-sm">
            -{savingsPercent}%
          </div>
        )}

        <div
          style={{
            paddingBottom: '100%',
            position: 'relative',
            backgroundColor: '#f5f5f4',
            overflow: 'hidden',
          }}
        >
          <LazyImage
            src={imageUrl}
            alt={title}
            priority={imagePriority}
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

        <div className="p-3.5">
          <h3 className="text-[15px] font-semibold text-slate-800 line-clamp-3 leading-snug min-h-[3.9rem]">
            {title}
          </h3>

          <div className="mt-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-end gap-1.5 leading-none">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-500/90">
                  {currency}
                </span>
                <span className="text-[22px] font-bold text-rose-500 tracking-tight">
                  {originalPriceText}
                </span>
              </div>

              {competitorPrice && competitorPrice > product.original_price && (
                <div className="mt-1 flex items-center gap-1.5 min-w-0 text-[11px] text-slate-400">
                  <span className="line-through whitespace-nowrap">
                    {currency} {competitorPriceText}
                  </span>
                  {competitorPlatform && <span className="truncate">· {competitorPlatform}</span>}
                </div>
              )}
            </div>

            <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-100 whitespace-nowrap flex-shrink-0">
              {t('subsidyPool.subsidyTag')}
            </span>
          </div>

          {product.ticket_price > 0 && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-500 truncate">
                {t('product.luckyBuyCompact')} · {t('product.fromPriceShort')} {currency} {ticketPriceText}
              </span>
              {product.total_tickets > 0 && (
                <span className="text-slate-400 flex-shrink-0">
                  {product.sold_tickets}/{product.total_tickets}
                </span>
              )}
            </div>
          )}

          {product.total_tickets > 0 && (
            <div className="mt-2.5">
              <div className="w-full bg-slate-100 rounded-full h-1">
                <div
                  className="bg-gradient-to-r from-amber-400 to-orange-500 h-1 rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
});

export default SceneProductCard;
