import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { ShoppingBag, Users, Clock, ChevronRight } from 'lucide-react';
import { extractEdgeFunctionError } from '../../utils/edgeFunctionHelper'
// getOptimizedImageUrl removed to fix thumbnail enlargement issue

interface GroupBuyProduct {
  id: string;
  title: { zh: string; ru: string; tg: string };
  description: { zh: string; ru: string; tg: string };
  image_url: string;
  images?: string[]; // 多张图片数组
  original_price: number;
  price_per_person: number;
  group_size: number; // 数据库字段名
  timeout_hours: number;
  active_sessions_count: number;
  active_sessions: Array<{
    id: string;
    current_participants: number;
    group_size: number; // 数据库字段名
    expires_at: string;
  }>;
}

export default function GroupBuyListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [products, setProducts] = useState<GroupBuyProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('group-buy-list', {
        body: { type: 'products' },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (data?.success) {
        // 按创建时间从新到旧排序
        const sortedProducts = [...data.data].sort((a: any, b: any) => {
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });
        setProducts(sortedProducts);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      setLoading(false);
    }
  };

  const getLocalizedText = (text: any) => {
    if (!text) return '';
    if (typeof text === 'string') return text;
    if (typeof text !== 'object') return String(text);
    
    const currentLang = text[i18n.language];
    if (currentLang && typeof currentLang === 'string' && currentLang.trim()) {
      return currentLang;
    }
    
    const fallbackLangs = ['zh', 'ru', 'tg', 'en'];
    for (const lang of fallbackLangs) {
      if (text[lang] && typeof text[lang] === 'string' && text[lang].trim()) {
        return text[lang];
      }
    }
    
    return '';
  };

  const calculateDiscount = (original: number, perPerson: number) => {
    return Math.round(((original - perPerson) / original) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Subsidy Banner */}
      <div className="px-4 pt-4">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg p-3 text-center shadow-sm">
          <p className="text-white text-sm font-medium">
            {t('subsidy.banner')} | {t('subsidy.groupBuyHint')}
          </p>
        </div>
      </div>

      {/* Rules Card */}
      <div className="px-4 mt-4">
        <div className="bg-white rounded-2xl shadow-md p-4 border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-gradient-to-b from-primary to-primary-dark rounded-full"></div>
            <h2 className="font-semibold text-gray-800">{t('groupBuy.howItWorks.title')}</h2>
          </div>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex items-start gap-2">
              <span className="text-lg">🎉</span>
              <span>{t('groupBuy.howItWorks.winner')}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-lg">💰</span>
              <span>{t('groupBuy.howItWorks.participants')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Products Grid */}
      <div className="p-4 space-y-4 mt-4">
        {products.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingBag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('groupBuy.noProducts')}</p>
          </div>
        ) : (
          products.map((product) => (
            <div
              key={product.id}
              onClick={() => navigate(`/group-buy/${product.id}`)}
              className="bg-white rounded-2xl shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
            >
              {/* Product Images - 智能展示图片，根据图片数量自动调整布局 */}
              <div className="relative">
                {(() => {
                  const allImages = product.images && product.images.length > 0 
                    ? product.images 
                    : [product.image_url];
                  
                  // 单张图片：全宽展示
                  if (allImages.length === 1) {
                    return (
                      <img
                        src={allImages[0]}
                        alt={getLocalizedText(product.title)}
                        loading="lazy"
                        style={{ width: '100%', height: '192px', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                      />
                    );
                  }
                  
                  // 2张图片：左右平分
                  if (allImages.length === 2) {
                    return (
                      <div style={{ display: 'flex', height: '192px', gap: '2px', overflow: 'hidden' }}>
                        {allImages.map((img, index) => (
                          <div key={index} style={{ width: '50%', overflow: 'hidden' }}>
                            <img
                              src={img}
                              alt={`${getLocalizedText(product.title)} ${index + 1}`}
                              loading="lazy"
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  }
                  
                  // 3张图片：左边大图 + 右边两小图
                  if (allImages.length === 3) {
                    return (
                      <div style={{ display: 'flex', height: '192px', gap: '2px', overflow: 'hidden' }}>
                        <div style={{ width: '50%', overflow: 'hidden' }}>
                          <img
                            src={allImages[0]}
                            alt={`${getLocalizedText(product.title)} 1`}
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                          />
                        </div>
                        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {allImages.slice(1, 3).map((img, index) => (
                            <div key={index} style={{ height: '50%', overflow: 'hidden' }}>
                              <img
                                src={img}
                                alt={`${getLocalizedText(product.title)} ${index + 2}`}
                                loading="lazy"
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  
                  // 4张及以上图片：左边大图 + 右边三小图
                  const displayImages = allImages.slice(0, 4);
                  const remainingCount = allImages.length - 4;
                  
                  return (
                    <div style={{ display: 'flex', height: '192px', gap: '2px', overflow: 'hidden' }}>
                      <div style={{ width: '50%', overflow: 'hidden' }}>
                        <img
                          src={displayImages[0]}
                          alt={`${getLocalizedText(product.title)} 1`}
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                        />
                      </div>
                      <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {displayImages.slice(1, 4).map((img, index) => (
                          <div key={index} style={{ height: '33.333%', overflow: 'hidden', position: 'relative' }}>
                            <img
                              src={img}
                              alt={`${getLocalizedText(product.title)} ${index + 2}`}
                              loading="lazy"
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                            />
                            {/* 最后一张图片显示剩余数量 */}
                            {index === 2 && remainingCount > 0 && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <span className="text-white font-bold text-lg">+{remainingCount}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {product.active_sessions_count > 0 && (
                  <div className="absolute top-3 right-3 bg-gradient-to-r from-primary to-primary-dark text-white px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {product.active_sessions_count}
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="p-4">
                <h3 className="font-bold text-lg text-gray-800 mb-2">
                  {getLocalizedText(product.title)}
                </h3>
                <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                  {getLocalizedText(product.description)}
                </p>

                {/* Price Info */}
                <div className="flex items-end gap-2 mb-3">
                  <div className="text-primary font-bold text-2xl">
                    TJS {product.price_per_person}
                  </div>
                  <div className="text-gray-400 line-through text-sm mb-1">
                    TJS {product.original_price}
                  </div>
                </div>

                {/* Group Info */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 text-gray-600">
                      <Users className="w-4 h-4" />
                      <span>{product.group_size}{t('groupBuy.people')}</span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-600">
                      <Clock className="w-4 h-4" />
                      <span>{product.timeout_hours}{t('groupBuy.hours')}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>

                {/* Active Sessions Preview */}
                {product.active_sessions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="text-xs text-gray-500 mb-2">
                      {t('groupBuy.activeGroups')}:
                    </div>
                    <div className="flex gap-2 overflow-x-auto">
                      {product.active_sessions.slice(0, 3).map((session) => (
                        <div
                          key={session.id}
                          className="flex-shrink-0 bg-amber-50 rounded-lg px-3 py-2 text-xs"
                        >
                          <div className="font-medium text-primary">
                            {session.current_participants}/{session.group_size}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <button className="w-full mt-4 bg-gradient-to-r from-primary to-primary-dark text-white py-3 rounded-xl font-bold hover:from-primary-dark hover:to-primary-dark transition-colors">
                  {product.active_sessions_count > 0
                    ? t('groupBuy.joinGroup')
                    : t('groupBuy.startGroup')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
