/**
 * 分类商品列表页
 *
 * 独立的分类落地页，展示指定分类下的所有商品。
 * 路由：/category/:categoryId
 *
 * 功能：
 * - 顶部显示分类名称和返回按钮
 * - 双列网格展示该分类下的商品卡片
 * - 支持来源归因（src_page=category）
 * - 埋点：category_view / product_card_click
 *
 * 数据来源：复用 get-home-feed + product_categories 前端过滤
 */
import React, { useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import { getLocalizedText } from '../lib/utils';
import { getCategoryIcon } from '../utils/categoryIcons';
import { useCategoryProducts } from '../hooks/useHomeFeed';
import { useTrackEvent } from '../hooks/useTrackEvent';
import { SceneProductCard } from '../components/home/SceneProductCard';
import type { HomeFeedItem, HomeFeedProductData, HomeFeedCategory, SupportedLang } from '../types/homepage';

const CategoryProductsPage: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [searchParams] = useSearchParams();
  const { i18n, t } = useTranslation();
  const { track } = useTrackEvent();
  const navigate = useNavigate();
  const lang = i18n.language as SupportedLang;

  // 从 URL 参数获取分类名称（作为 fallback）
  const categoryName = searchParams.get('name') || '';
  const categoryCode = searchParams.get('code') || '';

  // 获取分类下的商品
  const { data, isLoading } = useCategoryProducts(categoryId || '');

  // 从返回的 categories 中找到当前分类信息
  const currentCategory: HomeFeedCategory | undefined = useMemo(() => {
    if (!data?.categories) return undefined;
    return data.categories.find((c) => c.id === categoryId);
  }, [data?.categories, categoryId]);

  // 分类显示名称
  const displayName = currentCategory
    ? getLocalizedText(currentCategory.name_i18n as Record<string, string>, lang)
    : categoryName || t('common.category');

  // 分类图标
  const displayIcon = currentCategory
    ? getCategoryIcon(currentCategory.code)
    : getCategoryIcon(categoryCode);

  // [修复] 页面浏览埋点：使用 home_view 事件名（category_view 未在 BehaviorEventName 类型中定义）
  // 原实现使用 category_click，与首页分类点击事件混淆，导致行为看板数据不准确
  useEffect(() => {
    if (categoryId) {
      track({
        event_name: 'home_view',
        page_name: 'category_products',
        entity_type: 'category',
        entity_id: categoryId,
        source_category_id: categoryId,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const products: HomeFeedItem[] = data?.products || [];

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* 顶部导航栏 */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3">
        <div className="flex items-center">
          <button
            onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mr-3 hover:bg-gray-200 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 text-gray-600" />
          </button>
          <div className="flex items-center space-x-2">
            <span className="text-xl">{displayIcon}</span>
            <h1 className="text-lg font-bold text-gray-900">{displayName}</h1>
          </div>
          <div className="ml-auto text-sm text-gray-400">
            {!isLoading && `${products.length} ${t('common.items') || '件商品'}`}
          </div>
        </div>
      </div>

      {/* 商品列表 */}
      <div className="px-4 mt-4">
        {isLoading ? (
          /* 骨架屏 */
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
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
        ) : products.length > 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-2 gap-3"
          >
            {products.map((item, index) => {
              const productData = item.data as HomeFeedProductData;
              return (
                <SceneProductCard
                  key={`product-${item.item_id}`}
                  product={productData}
                  position={index}
                  sourceCategoryId={categoryId}
                />
              );
            })}
          </motion.div>
        ) : (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">{displayIcon}</div>
            <p className="text-gray-400 text-sm">
              {t('common.noData') || '暂无商品'}
            </p>
            <button
              onClick={() => navigate(-1)}
              className="mt-4 text-sm text-orange-500 font-medium hover:text-orange-600"
            >
              ← {t('common.back') || '返回首页'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryProductsPage;
