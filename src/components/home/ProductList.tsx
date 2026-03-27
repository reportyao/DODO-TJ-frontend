import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatCurrency, getLocalizedText } from '../../lib/utils';

interface PriceComparison {
  price: number;
  platform: string;
}

interface BaseProduct {
  id: string;
  image_url: string | null;
  price: number;           // 总价 (original_price)
  ticket_price?: number;   // 单份价格
  title?: string;
  title_i18n?: Record<string, string> | null;
  name_i18n?: Record<string, string> | null;
  created_at: string;
  price_comparisons?: PriceComparison[] | null;
}

interface LotteryProduct extends BaseProduct {
  type: 'lottery';
  sold_tickets: number;
  total_tickets: number;
  status: string;
}

interface GroupBuyProduct extends BaseProduct {
  type: 'groupbuy';
  group_size: number;
  original_price: number;
  active_sessions_count?: number;
}

type Product = LotteryProduct | GroupBuyProduct;

interface ProductListProps {
  title: string;
  products: Product[];
  isLoading?: boolean;
  emptyText?: string;
  linkPrefix: string;
  /** 未登录时点击商品是否跳转登录页（默认 false） */
  requireAuthOnClick?: boolean;
}

/**
 * 首页商品列表组件 - 双列网格布局
 * 上图下文卡片样式，突出商品总价和竞品对比
 * 支持 requireAuthOnClick：未登录用户点击商品跳转登录页
 */
export const ProductList: React.FC<ProductListProps> = ({
  title,
  products,
  isLoading = false,
  emptyText,
  linkPrefix,
  requireAuthOnClick = false,
}) => {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const getProductTitle = (product: Product) => {
    const localizedName = getLocalizedText(product.name_i18n as Record<string, string> | null, i18n.language);
    const localizedTitle = getLocalizedText(product.title_i18n as Record<string, string> | null, i18n.language);
    return localizedName || localizedTitle || product.title || '';
  };

  const handleProductClick = (e: React.MouseEvent, productId: string) => {
    if (requireAuthOnClick) {
      e.preventDefault();
      const targetPath = `${linkPrefix}/${productId}`;
      navigate(`/login?redirect=${encodeURIComponent(targetPath)}`);
    }
    // 已登录时不拦截，Link 正常跳转
  };

  // 获取竞品最高价格（用于划线对比）
  const getHighestCompetitorPrice = (product: Product): number | null => {
    if (!product.price_comparisons || product.price_comparisons.length === 0) return null;
    return Math.max(...product.price_comparisons.map(pc => pc.price));
  };

  // 计算节省百分比
  const getSavingsPercent = (ourPrice: number, competitorPrice: number): number => {
    if (competitorPrice <= 0) return 0;
    return Math.round((1 - ourPrice / competitorPrice) * 100);
  };

  return (
    <div className="space-y-3 px-4 mt-4">
      <h2 className="text-lg font-bold text-gray-800">{title}</h2>
      
      {isLoading ? (
        /* 骨架屏 - 双列网格 */
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
              <div style={{ paddingBottom: '100%', position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundColor: '#e5e7eb' }} />
              </div>
              <div className="p-3 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-5 bg-gray-200 rounded w-1/2"></div>
                <div className="h-3 bg-gray-200 rounded w-2/3"></div>
              </div>
            </div>
          ))}
        </div>
      ) : products.length > 0 ? (
        /* 双列网格布局 */
        <div className="grid grid-cols-2 gap-3">
          {products.map((product) => {
            const competitorPrice = getHighestCompetitorPrice(product);
            const savingsPercent = competitorPrice ? getSavingsPercent(product.price, competitorPrice) : 0;
            
            return (
              <Link
                key={product.id}
                to={`${linkPrefix}/${product.id}`}
                onClick={(e) => handleProductClick(e, product.id)}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow relative"
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
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={getProductTitle(product)}
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
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23f0f0f0" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-size="14"%3ENo Image%3C/text%3E%3C/svg%3E';
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
                  <h3 className="text-sm font-medium text-gray-800 line-clamp-2 leading-tight mb-2" style={{ minHeight: '2.5rem' }}>
                    {getProductTitle(product)}
                  </h3>
                  
                  {/* 价格区域 - 展示总价 + 补贴价标签 */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-lg font-bold text-red-500">
                      {formatCurrency('TJS', product.price)}
                    </span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-500 border border-red-100 whitespace-nowrap">
                      {t('subsidyPool.subsidyPrice')}
                    </span>
                  </div>

                  {/* 竞品价格划线对比 */}
                  {competitorPrice && competitorPrice > product.price && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] text-gray-400 line-through">
                        {formatCurrency('TJS', competitorPrice)}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {product.price_comparisons?.[0]?.platform || ''}
                      </span>
                    </div>
                  )}

                  {/* 单份价格提示 - "低至 X TJS/份" */}
                  {product.ticket_price && product.ticket_price > 0 && (
                    <div className="flex items-center mt-1">
                      <span className="text-[11px] text-orange-500 font-medium">
                        {t('product.startFrom')} {formatCurrency('TJS', product.ticket_price)}/{t('product.perUnit')}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
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
          <p className="text-gray-400 text-sm">{emptyText || t('common.noData')}</p>
        </div>
      )}
    </div>
  );
};

export default ProductList;
