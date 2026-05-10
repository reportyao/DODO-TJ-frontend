/**
 * B2B 进货大厅首页
 * Phase 4: 前端核心展示层
 *
 * 功能：
 * - 商品网格展示（批发价、起批量、库存状态）
 * - 搜索框（调用 rpc_b2b_search_products）
 * - 异步滚动加载
 * - 点击商品跳转详情页
 * - 非批发商用户隐藏价格信息
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useB2BHomeFeedInfinite, useB2BSearch, useWholesalerProfile, B2BProduct } from '../hooks/useB2B';
import { LazyImage } from '../components/LazyImage';
import BannerCarousel from '../components/BannerCarousel';
import { CategoryGrid } from '../components/home/CategoryGrid';
import { cn } from '../lib/utils';

/**
 * 获取商品的本地化名称
 */
function getLocalizedName(nameI18n: { zh?: string; ru?: string; tg?: string } | null, lang: string, fallback: string = ''): string {
  if (!nameI18n) return fallback || '—';
  return nameI18n[lang as keyof typeof nameI18n] || nameI18n.ru || nameI18n.zh || nameI18n.tg || fallback || '—';
}

/**
 * B2B 商品卡片
 */
const B2BProductCard: React.FC<{
  product: B2BProduct;
  onClick: () => void;
  lang: string;
  t: (key: string) => string;
  showPrice: boolean;
}> = ({ product, onClick, lang, t, showPrice }) => {
  const isOutOfStock = product.stock <= 0;
  // 安全计算利润百分比，防止除以零
  const profitPercent = product.retail_price && product.wholesale_price && product.wholesale_price > 0
    ? Math.round(((product.retail_price - product.wholesale_price) / product.wholesale_price) * 100)
    : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-200 active:scale-[0.98]',
        isOutOfStock ? 'opacity-60' : 'hover:shadow-md'
      )}
    >
      {/* Image */}
      <div className="relative aspect-square bg-gray-50">
        <LazyImage
          src={product.image_url || ''}
          alt={getLocalizedName(product.name_i18n, lang, product.sku || '')}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {isOutOfStock && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="text-white text-xs font-bold bg-red-500 px-2 py-1 rounded">
              {t('b2b.outOfStock')}
            </span>
          </div>
        )}
        {showPrice && profitPercent && profitPercent > 0 && !isOutOfStock && (
          <div className="absolute top-1.5 right-1.5 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
            +{profitPercent}%
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight min-h-[2.5rem]">
          {getLocalizedName(product.name_i18n, lang, product.sku || '')}
        </h3>

        {/* Price - 仅批发商可见 */}
        {showPrice ? (
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-base font-bold text-primary-dark">
              {Number(product.wholesale_price).toFixed(0)}
            </span>
            <span className="text-xs text-gray-400">TJS</span>
            {product.retail_price && (
              <span className="text-xs text-gray-400 line-through ml-auto">
                {Number(product.retail_price).toFixed(0)}
              </span>
            )}
          </div>
        ) : (
          <div className="mt-1.5">
            <span className="text-xs text-primary font-medium">{t('b2b.viewProductDetail')}</span>
          </div>
        )}

        {/* Meta */}
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500">
          <span>{t('b2b.minOrder')} {product.min_order_quantity}{product.unit_measure}</span>
          <span className={cn(
            'font-medium',
            product.stock > 10 ? 'text-green-600' : product.stock > 0 ? 'text-orange-500' : 'text-red-500'
          )}>
            {product.stock > 0 ? `${t('b2b.stock')}: ${product.stock}` : t('b2b.outOfStock')}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * B2B 首页
 */
export default function B2BHomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'ru';

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();

  // 批发商权限检查
  const { data: wholesalerProfile } = useWholesalerProfile();
  const isApprovedWholesaler = wholesalerProfile?.status === 'approved';

  // Data hooks - 首页不再展示分页控件，而是按页异步追加加载，分类来源继续复用管理后台维护的 homepage_categories。
  const {
    data: feedData,
    isLoading: feedLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useB2BHomeFeedInfinite(selectedCategoryId);
  const { data: searchResults, isLoading: searchLoading } = useB2BSearch(searchQuery);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const handleSearch = useCallback(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length >= 2) {
      setSearchQuery(trimmed);
      setIsSearching(true);
    } else {
      setSearchQuery('');
      setIsSearching(false);
    }
  }, [searchInput]);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setIsSearching(false);
  }, []);

  const handleCategorySelect = useCallback((categoryId: string | undefined) => {
    setSelectedCategoryId(categoryId);
    // 用户选择分类时退出搜索结果，避免分类菜单与商品列表不一致。
    setSearchQuery('');
    setSearchInput('');
    setIsSearching(false);
  }, []);

  const handleProductClick = (productId: string) => {
    navigate(`/b2b/product/${productId}`);
  };

  const firstFeedPage = feedData?.pages?.[0];
  const feedProducts = useMemo(
    () => feedData?.pages.flatMap((pageData) => pageData.products) || [],
    [feedData]
  );

  useEffect(() => {
    if (isSearching || !hasNextPage || isFetchingNextPage) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '240px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isSearching, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Determine which products to display
  const products = isSearching ? (searchResults || []) : feedProducts;
  const totalProducts = isSearching ? (searchResults?.length || 0) : (firstFeedPage?.total || feedProducts.length);
  const isLoading = isSearching ? searchLoading : feedLoading;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-100 px-4 pt-3 pb-3 safe-area-top">
        <h1 className="text-lg font-bold text-gray-900 mb-2">{t('b2b.home')}</h1>

        {/* Search Bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('b2b.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {isSearching ? (
            <button
              onClick={clearSearch}
              className="px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg"
            >
              ✕
            </button>
          ) : (
            <button
              onClick={handleSearch}
              className="px-4 py-2 text-sm text-white bg-primary rounded-lg font-medium"
            >
              {t('b2b.search')}
            </button>
          )}
        </div>
      </div>

      {/* Banner 与分类菜单：保留原首页展示能力，数据来自 B2B 首页 RPC，分类继续与管理后台维护项一致。 */}
      {!isSearching && (
        <div className="pt-3">
          <div className="px-3">
            <BannerCarousel banners={firstFeedPage?.banners as any} />
          </div>
            <CategoryGrid
              categories={(firstFeedPage?.categories || []) as any}
              selectedId={selectedCategoryId}
              onSelect={handleCategorySelect}
              isLoading={feedLoading}
            />
        </div>
      )}

      {/* Content */}
      <div className="px-3 pt-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📦</div>
            <p className="text-gray-500">{t('b2b.noProducts')}</p>
          </div>
        ) : (
          <>
            {/* Product Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              {products.map((product) => (
                <B2BProductCard
                  key={product.id}
                  product={product}
                  onClick={() => handleProductClick(product.id)}
                  lang={lang}
                  t={t}
                  showPrice={isApprovedWholesaler}
                />
              ))}
            </div>

            {/* Async load sentinel (only for non-search) */}
            {!isSearching && (
              <div ref={loadMoreRef} className="flex items-center justify-center mt-6 mb-4 min-h-10">
                {isFetchingNextPage ? (
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : hasNextPage ? (
                  <button
                    onClick={() => fetchNextPage()}
                    className="px-4 py-2 text-sm text-gray-600 bg-white border rounded-lg"
                  >
                    {t('common.loadMore') || 'Load more'}
                  </button>
                ) : totalProducts > 0 ? (
                  <span className="text-xs text-gray-400">{t('common.noMore') || 'No more products'}</span>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
