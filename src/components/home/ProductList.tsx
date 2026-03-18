import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatCurrency, getLocalizedText } from '../../lib/utils';
import { UserGroupIcon } from '@heroicons/react/24/outline';

interface BaseProduct {
  id: string;
  image_url: string | null;
  price: number;
  title?: string;
  title_i18n?: Record<string, string> | null;
  name_i18n?: Record<string, string> | null;
  created_at: string;
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
}

/**
 * 首页商品列表组件 - 双列网格布局
 * 上图下文卡片样式，突出商品图片和补贴价
 */
export const ProductList: React.FC<ProductListProps> = ({
  title,
  products,
  isLoading = false,
  emptyText,
  linkPrefix,
}) => {
  const { i18n, t } = useTranslation();

  const getProductTitle = (product: Product) => {
    const localizedName = getLocalizedText(product.name_i18n as Record<string, string> | null, i18n.language);
    const localizedTitle = getLocalizedText(product.title_i18n as Record<string, string> | null, i18n.language);
    return localizedName || localizedTitle || product.title || '';
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
          {products.map((product) => (
            <Link
              key={product.id}
              to={`${linkPrefix}/${product.id}`}
              className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* 商品图片 - 1:1 比例容器，使用原生 img + loading="lazy" */}
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
                
                {/* 价格区域 - 突出补贴价 */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-lg font-bold text-red-500">
                    {formatCurrency('TJS', product.price)}
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-500 border border-red-100 whitespace-nowrap">
                    {t('subsidyPool.subsidyPrice', '补贴价')}
                  </span>
                </div>

                {/* 进度信息 */}
                {product.type === 'lottery' && (
                  <div className="flex items-center text-xs text-gray-500">
                    <UserGroupIcon className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
                    <span>{product.sold_tickets}/{product.total_tickets}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          {emptyText || t('common.noData', '暂无数据')}
        </div>
      )}
    </div>
  );
};

export default ProductList;
