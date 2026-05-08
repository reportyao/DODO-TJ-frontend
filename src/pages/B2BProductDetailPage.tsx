/**
 * B2B 商品详情页
 * Phase 4: 前端核心展示层
 *
 * 功能：
 * - 商品图片轮播
 * - 批发价、建议零售价、利润空间展示（仅批发商可见）
 * - 起批量、库存、规格信息
 * - 数量选择器（步进为 min_order_quantity）
 * - 加入进货单（仅已认证批发商可用）
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ShoppingCartIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useB2BProductDetail, useB2BCartMutations, useWholesalerProfile } from '../hooks/useB2B';
import { LazyImage } from '../components/LazyImage';
import { useUser } from '../contexts/UserContext';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';

/**
 * 获取商品的本地化文本
 */
function getLocalized(i18n: { zh?: string; ru?: string; tg?: string } | null | undefined, lang: string, fallback: string = ''): string {
  if (!i18n) return fallback;
  return i18n[lang as keyof typeof i18n] || i18n.ru || i18n.zh || i18n.tg || fallback;
}

export default function B2BProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'ru';
  const { user } = useUser();

  const { data: product, isLoading } = useB2BProductDetail(productId || '');
  const { upsertItem } = useB2BCartMutations();
  // 批发商权限检查
  const { data: wholesalerProfile } = useWholesalerProfile();
  const isApprovedWholesaler = wholesalerProfile?.status === 'approved';

  const [quantity, setQuantity] = useState<number>(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Initialize quantity when product loads
  React.useEffect(() => {
    if (product && quantity === 0) {
      setQuantity(product.min_order_quantity || 1);
    }
  }, [product, quantity]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <p className="text-gray-500">{t('b2b.noProducts')}</p>
        <button onClick={() => navigate('/b2b')} className="text-blue-600 text-sm">
          {t('b2b.home')}
        </button>
      </div>
    );
  }

  const images = product.image_urls?.length ? product.image_urls : (product.image_url ? [product.image_url] : []);
  const isOutOfStock = product.stock <= 0;
  // 安全计算利润百分比，防止除以零
  const profitPercent = product.retail_price && product.wholesale_price && product.wholesale_price > 0
    ? Math.round(((product.retail_price - product.wholesale_price) / product.wholesale_price) * 100)
    : null;
  const profitAmount = product.retail_price && product.wholesale_price
    ? (product.retail_price - product.wholesale_price)
    : null;

  const minQty = product.min_order_quantity || 1;
  const subtotal = quantity * product.wholesale_price;

  const handleDecrease = () => {
    setQuantity(prev => Math.max(minQty, prev - minQty));
  };

  const handleIncrease = () => {
    setQuantity(prev => {
      const nextQuantity = prev + minQty;
      return nextQuantity > product.stock ? prev : nextQuantity;
    });
  };

  const handleAddToCart = async () => {
    if (!user) {
      toast.error(t('b2b.pleaseLogin'));
      navigate('/login');
      return;
    }
    // 检查批发商权限
    if (!isApprovedWholesaler) {
      toast.error(t('b2b.applyWholesaler'));
      return;
    }
    if (quantity < minQty) {
      toast.error(`${t('b2b.minOrder')} ${minQty}${product.unit_measure}`);
      return;
    }
    if (quantity > product.stock) {
      toast.error(t('b2b.outOfStock'));
      return;
    }
    try {
      await upsertItem.mutateAsync({ productId: product.id, quantity });
      toast.success(t('b2b.addToCart') + ' ✓');
    } catch (err: any) {
      toast.error(err.message || t('b2b.addToCart'));
    }
  };

  return (
    <div className="min-h-screen bg-white pb-24">
      {/* Top Bar */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeftIcon className="w-5 h-5 text-gray-700" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 truncate flex-1">
          {t('b2b.productDetail')}
        </h1>
      </div>

      {/* Image Carousel */}
      <div className="relative aspect-square bg-gray-50">
        {images.length > 0 ? (
          <>
            <LazyImage
              src={images[currentImageIndex]}
              alt={getLocalized(product.name_i18n, lang, product.sku || '')}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
              priority="high"
            />
            {images.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {images.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentImageIndex(idx)}
                    className={cn(
                      'w-2 h-2 rounded-full transition-all',
                      idx === currentImageIndex ? 'bg-blue-600 w-4' : 'bg-gray-300'
                    )}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-4xl">📦</div>
        )}
      </div>

      {/* Product Info */}
      <div className="px-4 pt-4">
        {/* Name */}
        <h2 className="text-lg font-bold text-gray-900 leading-tight">
          {getLocalized(product.name_i18n, lang)}
        </h2>

        {/* Price Section - 仅批发商可见 */}
        {isApprovedWholesaler ? (
          <div className="mt-3 bg-blue-50 rounded-xl p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-700">
                TJS {Number(product.wholesale_price).toFixed(2)}
              </span>
              <span className="text-sm text-gray-500">/{product.unit_measure}</span>
            </div>
            {product.retail_price && (
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-sm text-gray-500">
                  {t('b2b.retailPrice')}: <span className="line-through">TJS {Number(product.retail_price).toFixed(2)}</span>
                </span>
                {profitAmount && profitPercent && (
                  <span className="text-sm font-semibold text-green-600">
                    {t('b2b.profitMargin')}: +{profitPercent}% (TJS {profitAmount.toFixed(2)}/{product.unit_measure})
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 bg-gray-50 rounded-xl p-3">
            <p className="text-sm text-gray-500 italic">{t('b2b.applyWholesaler')}</p>
          </div>
        )}

        {/* Meta Info */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-gray-500">{t('b2b.minOrder')}</div>
            <div className="text-sm font-bold text-gray-900 mt-0.5">{minQty} {product.unit_measure}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-gray-500">{t('b2b.stock')}</div>
            <div className={cn(
              'text-sm font-bold mt-0.5',
              product.stock > 10 ? 'text-green-600' : product.stock > 0 ? 'text-orange-500' : 'text-red-500'
            )}>
              {product.stock}
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-gray-500">SKU</div>
            <div className="text-sm font-medium text-gray-700 mt-0.5 truncate">{product.sku || '-'}</div>
          </div>
        </div>

        {/* Specifications */}
        {getLocalized(product.specifications_i18n, lang) && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{t('b2b.specifications')}</h3>
            <p className="text-sm text-gray-600">{getLocalized(product.specifications_i18n, lang)}</p>
          </div>
        )}

        {/* Description */}
        {getLocalized(product.description_i18n, lang) && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{t('b2b.description')}</h3>
            <p className="text-sm text-gray-600 whitespace-pre-line">{getLocalized(product.description_i18n, lang)}</p>
          </div>
        )}

        {/* Material - 使用i18n */}
        {getLocalized(product.material_i18n, lang) && (
          <div className="mt-3">
            <span className="text-sm text-gray-500">{t('b2b.material')}: </span>
            <span className="text-sm text-gray-700">{getLocalized(product.material_i18n, lang)}</span>
          </div>
        )}

        {/* Barcode - 使用i18n */}
        {product.barcode && (
          <div className="mt-2">
            <span className="text-sm text-gray-500">{t('b2b.barcode')}: </span>
            <span className="text-sm text-gray-700 font-mono">{product.barcode}</span>
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-50 safe-area-bottom">
        <div className="flex items-center gap-3">
          {/* Quantity Selector */}
          <div className="flex items-center border rounded-lg overflow-hidden">
            <button
              onClick={handleDecrease}
              disabled={quantity <= minQty || !isApprovedWholesaler}
              className="px-3 py-2 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
            >
              <MinusIcon className="w-4 h-4" />
            </button>
            <span className="px-3 py-2 text-sm font-bold min-w-[3rem] text-center border-x">
              {quantity}
            </span>
            <button
              onClick={handleIncrease}
              disabled={quantity + minQty > product.stock || !isApprovedWholesaler}
              className="px-3 py-2 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Subtotal */}
          {isApprovedWholesaler && (
            <div className="flex-1 text-right">
              <div className="text-xs text-gray-500">{t('b2b.totalAmount')}</div>
              <div className="text-base font-bold text-blue-700">TJS {subtotal.toFixed(2)}</div>
            </div>
          )}

          {/* Add to Cart Button */}
          <button
            onClick={handleAddToCart}
            disabled={isOutOfStock || upsertItem.isPending || !isApprovedWholesaler}
            className={cn(
              'flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all',
              isOutOfStock || !isApprovedWholesaler
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white active:bg-blue-700'
            )}
          >
            <ShoppingCartIcon className="w-4 h-4" />
            {upsertItem.isPending ? '...' : isApprovedWholesaler ? t('b2b.addToCart') : t('b2b.applyWholesaler')}
          </button>
        </div>
      </div>
    </div>
  );
}
