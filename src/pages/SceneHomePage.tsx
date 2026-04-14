/**
 * 首页场景化改造 · 主页面
 *
 * 布局结构（从上到下）：
 * 1. BannerCarousel - 轮播图（数据来自 feed，不再独立请求）
 * 2. SubsidyPoolBanner - 补贴池横条
 * 3. CategoryGrid - 金刚区分类入口
 * 4. Feed 混合流 - 商品卡片 + 专题卡片穿插
 *
 * 数据来源：get-home-feed Edge Function（单一请求）
 * 埋点：home_view / category_click / product_card_click / topic_card_click
 *
 * [v2 性能优化]
 * - Banner 数据合并到 get-home-feed，首屏请求数从 3 减少到 2
 * - BannerCarousel 改为接收 props，不再内部独立查询 banners 表
 * - 移除 react-query banners 缓存键的独立查询
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../contexts/UserContext';
import BannerCarousel from '../components/BannerCarousel';
import { SubsidyPoolBanner } from '../components/home/SubsidyPoolBanner';
import { CategoryGrid } from '../components/home/CategoryGrid';
import {
  TopicCard,
  getTopicCardGridSpan,
  normalizeTopicCardStyle,
} from '../components/home/TopicCard';
import { SceneProductCard } from '../components/home/SceneProductCard';
import { useHomeFeed } from '../hooks/useHomeFeed';
import { useTrackEvent } from '../hooks/useTrackEvent';

import type { HomeFeedItem, HomeFeedTopicData, HomeFeedProductData } from '../types/homepage';

const SceneHomePage: React.FC = () => {
  const { t } = useTranslation();
  const { user, isLoading: userLoading } = useUser();
  const { track } = useTrackEvent();
  const nav = useNavigate();

  // ============================================================
  // 分类筛选状态
  // ============================================================
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();

  // ============================================================
  // 数据获取（单一请求获取 banners + categories + products + placements）
  // ============================================================
  const { data: feedData, isLoading } = useHomeFeed(selectedCategoryId);

  // ============================================================
  // 首页浏览埋点
  // ============================================================
  useEffect(() => {
    track({
      event_name: 'home_view',
      page_name: 'home',
      entity_type: 'home',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // PWA 深度链接处理（与原 HomePage 保持一致）
  // ============================================================
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gotoParam = urlParams.get('goto');
    const refParam = urlParams.get('ref');

    if (gotoParam) {
      if (gotoParam.startsWith('lt_')) {
        const lotteryId = gotoParam.replace('lt_', '');
        nav(`/lottery/${lotteryId}`, { replace: true });
      } else if (gotoParam.startsWith('so_')) {
        nav(`/showoff`, { replace: true });
      }
    } else if (refParam && !user && !userLoading) {
      nav(`/register?ref=${encodeURIComponent(refParam)}`, { replace: true });
    }
  }, [nav, user, userLoading]);

  // ============================================================
  // 分类选择
  // ============================================================
  const handleCategorySelect = useCallback(
    (categoryId: string | undefined) => {
      setSelectedCategoryId(categoryId);
      if (categoryId) {
        track({
          event_name: 'category_click',
          page_name: 'home',
          entity_type: 'category',
          entity_id: categoryId,
          source_category_id: categoryId,
        });
      }
    },
    [track]
  );

  // ============================================================
  // Feed 混合流构建
  // 将专题卡片按 feed_position 插入商品列表
  // ============================================================
  const mixedFeed = useMemo(() => {
    if (!feedData) {
      return [];
    }

    const products = feedData.products || [];
    const placements = feedData.placements || [];

    // [修复] 分类筛选时隐藏专题卡片，避免用户选择"数码科技"后仍看到"母婴好物"等不相关专题
    if (selectedCategoryId) {
      // 分类筛选模式：只显示商品，不插入专题卡片
      return products;
    }

    // 全部模式：按 feed_position 插入专题卡片
    const sortedPlacements = [...placements].sort(
      (a, b) =>
        (a.data as HomeFeedTopicData).feed_position - (b.data as HomeFeedTopicData).feed_position
    );

    const result: HomeFeedItem[] = [];
    let productIndex = 0;

    for (const placement of sortedPlacements) {
      const topicData = placement.data as HomeFeedTopicData;
      const insertAt = topicData.feed_position;

      while (productIndex < products.length && result.length < insertAt) {
        result.push(products[productIndex]);
        productIndex++;
      }

      result.push(placement);
    }

    while (productIndex < products.length) {
      result.push(products[productIndex]);
      productIndex++;
    }

    return result;
  }, [feedData, selectedCategoryId]);

  // ============================================================
  // 渲染
  // ============================================================

  // 分离商品和专题用于渲染
  const renderFeedItem = (item: HomeFeedItem, index: number): React.ReactNode => {
    if (item.type === 'topic') {
      const topicData = item.data as HomeFeedTopicData;
      const topicStyle = normalizeTopicCardStyle(topicData.card_variant_name, topicData.card_style);
      const topicSpan = getTopicCardGridSpan(topicStyle);
      return (
        <div key={`topic-${item.item_id}`} className={`${topicSpan} px-0`}>
          <TopicCard topic={topicData} position={index} />
        </div>
      );
    }

    // 商品卡片
    const productData = item.data as HomeFeedProductData;
    return (
      <SceneProductCard
        key={`product-${item.item_id}`}
        product={productData}
        position={index}
        sourceCategoryId={selectedCategoryId}
      />
    );
  };

  return (
    <div className="pb-20 bg-gray-50">
      {/* Banner 广告位 - 数据来自 feed，不再独立请求 */}
      <div className="px-4 pt-4">
        <BannerCarousel banners={feedData?.banners} />
      </div>

      {/* 补贴池横条 */}
      <SubsidyPoolBanner />

      {/* 金刚区 - 分类入口 */}
      <CategoryGrid
        categories={feedData?.categories || []}
        selectedId={selectedCategoryId}
        onSelect={handleCategorySelect}
        isLoading={isLoading}
      />

      {/* Feed 混合流 */}
      <div className="px-4 mt-4">
        <h2 className="text-lg font-bold text-gray-800 mb-3">{t('home.lotteryProducts')}</h2>

        {isLoading ? (
          /* 骨架屏 - 双列网格 */
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse"
              >
                <div style={{ paddingBottom: '100%', position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: 0, backgroundColor: '#e5e7eb' }} />
                </div>
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-5 bg-gray-200 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : mixedFeed.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {mixedFeed.map((item, index) => renderFeedItem(item, index))}
          </div>
        ) : (
          <div className="text-center py-12">
            <picture>
              <source srcSet="/brand/empty_cart.webp" type="image/webp" />
              <img
                src="/brand/empty_cart.png"
                alt="No items"
                className="w-32 h-32 mx-auto mb-3 opacity-80"
                style={{ objectFit: 'contain' }}
              />
            </picture>
            <p className="text-gray-400 text-sm">{t('common.noData')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SceneHomePage;
