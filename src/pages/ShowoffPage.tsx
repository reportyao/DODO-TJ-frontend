import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { useSupabase } from '../contexts/SupabaseContext';
import { ShowoffWithDetails, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import {
  PhotoIcon,
  HeartIcon,
  ShareIcon,
  PlusIcon,
  TrophyIcon,
  SparklesIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { LazyImage } from '../components/LazyImage';
import { HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { formatDateTime, getLocalizedText, copyToClipboard } from '../lib/utils';
import toast from 'react-hot-toast';

const ITEMS_PER_PAGE = 10;

// 全局缓存，避免每次切换 tab 都重新加载
interface ShowoffCache {
  data: ShowoffWithDetails[];
  timestamp: number;
  filter: string;
  hasMore: boolean;
  page: number;
}
let showoffCache: ShowoffCache | null = null;
const CACHE_DURATION = 2 * 60 * 1000; // 2分钟缓存

const ShowoffPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMyShowoffs = location.pathname === '/showoff/my';
  const { user } = useUser();
  const { showoffService } = useSupabase();

  // 从缓存初始化状态
  const [showoffs, setShowoffs] = useState<ShowoffWithDetails[]>(() => {
    if (!isMyShowoffs && showoffCache && (Date.now() - showoffCache.timestamp) < CACHE_DURATION) {
      return showoffCache.data;
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(() => {
    // 如果有有效缓存，不显示加载状态
    if (!isMyShowoffs && showoffCache && (Date.now() - showoffCache.timestamp) < CACHE_DURATION) {
      return false;
    }
    return true;
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'following' | 'popular'>(() => {
    // 从缓存恢复 filter
    if (showoffCache && (Date.now() - showoffCache.timestamp) < CACHE_DURATION) {
      return showoffCache.filter as any;
    }
    return 'all';
  });
  const [page, setPage] = useState(() => {
    // 从缓存恢复 page
    if (showoffCache && (Date.now() - showoffCache.timestamp) < CACHE_DURATION) {
      return showoffCache.page;
    }
    return 0;
  });
  const [hasMore, setHasMore] = useState(() => {
    if (showoffCache && (Date.now() - showoffCache.timestamp) < CACHE_DURATION) {
      return showoffCache.hasMore;
    }
    return true;
  });
  
  // 缓存数据更新
  useEffect(() => {
    if (!isMyShowoffs && showoffs.length > 0) {
      showoffCache = {
        data: showoffs,
        timestamp: Date.now(),
        filter,
        hasMore,
        page,
      };
    }
  }, [showoffs, filter, hasMore, page, isMyShowoffs]);
  
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const fetchShowoffs = useCallback(async (pageNum: number, isLoadMore: boolean = false) => {
    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const supabaseUrl = SUPABASE_URL;
      const supabaseKey = SUPABASE_ANON_KEY;
      
      const offset = pageNum * ITEMS_PER_PAGE;
      const limit = ITEMS_PER_PAGE;

      // 1. 先获取晒单数据（不使用关联查询）
      let url = `${supabaseUrl}/rest/v1/showoffs?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
      
      if (isMyShowoffs && user) {
        url += `&user_id=eq.${user.id}`;
      } else {
        // 只显示已审核通过且未被隐藏的晒单
        url += `&status=eq.APPROVED&is_hidden=eq.false`;
      }

      const showoffsResponse = await fetch(
        url,
        {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!showoffsResponse.ok) {
        throw new Error('Failed to fetch showoffs');
      }

      const showoffsData = await showoffsResponse.json();

      // 2. 获取所有用户ID、彩票ID和库存商品ID
      const userIds = [...new Set(showoffsData.map((s: any) => s.user_id).filter(Boolean))];
      const lotteryIds = [...new Set(showoffsData.map((s: any) => s.lottery_id).filter(Boolean))];
      const inventoryProductIds = [...new Set(showoffsData.map((s: any) => s.inventory_product_id).filter(Boolean))];

      // 3. 批量获取用户信息
      let usersMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const usersResponse = await fetch(
          `${supabaseUrl}/rest/v1/users?id=in.(${userIds.join(',')})&select=id,phone_number,first_name,avatar_url`,
          {
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
          }
        );
        if (usersResponse.ok) {
          const usersData = await usersResponse.json();
          usersData.forEach((u: any) => {
            usersMap[u.id] = u;
          });
        }
      }

      // 4. 批量获取彩票信息
      let lotteriesMap: Record<string, any> = {};
      if (lotteryIds.length > 0) {
        const lotteriesResponse = await fetch(
          `${supabaseUrl}/rest/v1/lotteries?id=in.(${lotteryIds.join(",")})&select=id,title,title_i18n,image_url`,
          {
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
          }
        );
        if (lotteriesResponse.ok) {
          const lotteriesData = await lotteriesResponse.json();
          lotteriesData.forEach((l: any) => {
            lotteriesMap[l.id] = l;
          });
        }
      }

      // 5. 批量获取库存商品信息（用于运营晒单关联的未上架商品）
      let inventoryProductsMap: Record<string, any> = {};
      if (inventoryProductIds.length > 0) {
        const inventoryResponse = await fetch(
          `${supabaseUrl}/rest/v1/inventory_products?id=in.(${inventoryProductIds.join(",")})&select=id,name,name_i18n,image_url`,
          {
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
          }
        );
        if (inventoryResponse.ok) {
          const inventoryData = await inventoryResponse.json();
          inventoryData.forEach((p: any) => {
            inventoryProductsMap[p.id] = p;
          });
        }
      }

      // 6. 查询当前用户的点赞状态
      let likedShowoffIds = new Set<string>();
      if (user && showoffsData.length > 0) {
        const showoffIds = showoffsData.map((s: any) => s.id);
        const likesResponse = await fetch(
          `${supabaseUrl}/rest/v1/likes?user_id=eq.${user.id}&post_id=in.(${showoffIds.join(',')})&select=post_id`,
          {
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
          }
        );
        if (likesResponse.ok) {
          const likesData = await likesResponse.json();
          likedShowoffIds = new Set(likesData.map((l: any) => l.post_id));
        }
      }

      // 7. 合并数据
      const enrichedData = showoffsData.map((showoff: any) => {
        // 获取关联的库存商品信息
        const inventoryProduct = inventoryProductsMap[showoff.inventory_product_id] || null;
        return {
          ...showoff,
          // 兼容数据库字段名差异：数据库可能使用 images 或 image_urls
          image_urls: showoff.image_urls || showoff.images || [],
          user: usersMap[showoff.user_id] || null,
          lottery: lotteriesMap[showoff.lottery_id] || null,
          inventory_product: inventoryProduct,
          is_liked: likedShowoffIds.has(showoff.id),
        };
      });

      // 如果是加载更多，追加到现有数据
      if (isLoadMore) {
        setShowoffs(prev => [...prev, ...enrichedData]);
      } else {
        setShowoffs(enrichedData);
      }

      // 如果返回的数据少于每页数量，说明没有更多了
      setHasMore(showoffsData.length === ITEMS_PER_PAGE);
    } catch (error: any) {
      console.error('Error fetching showoffs:', error);
      setError(error.message || t('error.networkError'));
      
      // 弱网环境下显示友好提示
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        toast.error(t('error.networkSlow'));
      } else {
        toast.error(t('error.networkError'));
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [t]);

  useEffect(() => {
    // 检查缓存是否有效且 filter 匹配
    const now = Date.now();
    if (!isMyShowoffs && showoffCache && 
        (now - showoffCache.timestamp) < CACHE_DURATION && 
        showoffCache.filter === filter &&
        showoffCache.data.length > 0) {
      // 缓存有效，跳过加载
      return;
    }
    
    // 重置状态并加载第一页
    setPage(0);
    setShowoffs([]);
    setHasMore(true);
    fetchShowoffs(0, false);
  }, [filter, fetchShowoffs, isMyShowoffs]);

  // 无限滚动加载
  useEffect(() => {
    if (isLoading || isLoadingMore || !hasMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          const nextPage = page + 1;
          setPage(nextPage);
          fetchShowoffs(nextPage, true);
        }
      },
      { threshold: 0.5 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [page, hasMore, isLoading, isLoadingMore, fetchShowoffs]);

  const handleLike = async (showoffId: string) => {
    if (!user) {
      toast.error(t('auth.pleaseLogin'));
      return;
    }
    try {
      const isLiked = showoffs.find(s => s.id === showoffId)?.is_liked;
      let newLikesCount: number;
      if (isLiked) {
        newLikesCount = await showoffService.unlikeShowoff(showoffId, user.id);
      } else {
        newLikesCount = await showoffService.likeShowoff(showoffId, user.id);
      }
      // 使用服务端返回的最新 likes_count
      setShowoffs(prev =>
        prev.map(showoff =>
          showoff.id === showoffId
            ? {
                ...showoff,
                is_liked: !showoff.is_liked,
                likes_count: newLikesCount
              }
            : showoff
        )
      );
    } catch (error: any) {
      toast.error(error.message || t('error.networkError'));
    }
  };

  const handleShare = async (showoff: ShowoffWithDetails) => {
    const code = user?.referral_code || user?.invite_code;
    if (!code) {
      toast.error(t('error.unknownError'));
      return;
    }
    
    // 【迁移修复】使用 PWA 域名生成分享链接
    const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin;
    const inviteLink = `${appDomain}?ref=${code}`;
    const shareText = `🎁 Барои Шумо 10 сомонӣ тӯҳфа!\nБо истиноди ман ворид шавед ва бонус гиред. Дар DODO арзон харед ва бурд кунед!`;
    
    // 【迁移修复】优先使用 Web Share API，回退到 WhatsApp
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'DODO',
          text: shareText,
          url: inviteLink
        });
      } catch (e) {
        console.error('Share failed:', e);
      }
    } else {
      // 回退到 WhatsApp 分享
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText + '\n' + inviteLink)}`;
      window.open(whatsappUrl, '_blank');
    }
  };

  const handleCreateShowoff = () => {
    navigate('/showoff/create');
  };

  const handleRetry = () => {
    setPage(0);
    setShowoffs([]);
    setHasMore(true);
    fetchShowoffs(0, false);
  };

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* 顶部导航 */}
      <div className="bg-white px-4 py-4 sticky top-0 z-10 shadow-sm flex items-center">
        <button onClick={() => navigate(-1)} className="mr-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900">
          {isMyShowoffs ? t('showoff.myShowoffs') : t('showoff.showoffGallery')}
        </h1>
      </div>

      {/* Showoffs List */}
      <div className="px-4 py-4">
        {isLoading && showoffs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : error && showoffs.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <PhotoIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">{error}</p>
            <button
              onClick={handleRetry}
              className="flex items-center space-x-2 mx-auto px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
            >
              <ArrowPathIcon className="w-5 h-5" />
              <span>{t('common.retry')}</span>
            </button>
          </div>
        ) : showoffs.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <picture>
              <source srcSet="/brand/empty_orders.webp" type="image/webp" />
              <img 
                src="/brand/empty_orders.png" 
                alt="No posts"
                className="w-32 h-32 mx-auto mb-4 opacity-80"
                style={{ objectFit: 'contain' }}
              />
            </picture>
            <p className="text-gray-500">{t('showoff.noShowoffs')}</p>
            <p className="text-sm text-gray-400 mt-2">{t('showoff.beTheFirst')}</p>
            <button
              onClick={handleCreateShowoff}
              className="mt-4 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
            >
              {t('showoff.publishNow')}
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {showoffs.map((showoff, index) => (
                <motion.div
                  key={showoff.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-white rounded-xl shadow-sm overflow-hidden"
                >
                  {/* User Info */}
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
	                      <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 font-bold overflow-hidden">
                            {/* 优先使用运营晒单的虚拟用户信息，否则使用真实用户信息 */}
                            {(showoff.display_avatar_url || showoff.user?.avatar_url) ? (
                              <img 
                                src={showoff.display_avatar_url || showoff.user?.avatar_url} 
                                alt="" 
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  const displayName = showoff.display_username || showoff.user?.first_name;
                                  (e.target as HTMLImageElement).parentElement!.innerText = displayName?.charAt(0) || 'U';
                                }}
                              />
                            ) : (
		                      (showoff.display_username || showoff.user?.first_name) ? (showoff.display_username || showoff.user?.first_name)?.charAt(0) : 'U'
                            )}
	                      </div>
                      <div>
                        {/* 优先使用运营晒单的虚拟用户昵称 */}
	                      <p className="font-medium text-gray-900">{showoff.display_username || showoff.user?.first_name || 'Anonymous'}</p>
                        <p className="text-xs text-gray-500">{formatDateTime(showoff.created_at)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Prize Info - 仅在有商品关联信息时显示 */}
                  {(showoff.title_i18n || showoff.title || showoff.lottery || showoff.inventory_product) && (
                  <div className="px-4 pb-3">
                    <div className="flex items-center space-x-2 p-3 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border border-yellow-200">
                      <TrophyIcon className="w-5 h-5 text-orange-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {getLocalizedText(showoff.title_i18n, i18n.language) || showoff.title || getLocalizedText(showoff.lottery?.title_i18n, i18n.language) || showoff.lottery?.title || getLocalizedText(showoff.inventory_product?.name_i18n, i18n.language) || showoff.inventory_product?.name || t('showoff.unknownLottery')}
                        </p>
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Content */}
                  <div className="px-4 pb-3">
                    <p className="text-gray-700 leading-relaxed">{showoff.content}</p>
                  </div>

                  {/* Images */}
	                  {showoff.image_urls && Array.isArray(showoff.image_urls) && showoff.image_urls.length > 0 && (
                    <div className={`px-4 pb-3 grid gap-2 ${
                      showoff.image_urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                    }`}>
	                      {(showoff.image_urls as string[]).map((image, idx) => (
                        <div
                          key={idx}
                          style={{
                            position: 'relative',
                            borderRadius: '0.5rem',
                            overflow: 'hidden',
                            width: '100%',
                            paddingBottom: (showoff.image_urls as string[]).length === 1 ? '75%' : '100%',
                          }}
                        >
		                          <LazyImage
		                            src={image}
		                            alt={`${t('showoff.showoffImage')} ${idx + 1}`}
		                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
		                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 积分奖励显示 */}
                  {showoff.reward_coins && showoff.reward_coins > 0 && (
                    <div className="px-4 pb-3">
                      <div className="flex items-center space-x-2 p-2 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-lg border border-amber-200">
                        <SparklesIcon className="w-5 h-5 text-amber-500" />
                        <span className="text-sm font-medium text-amber-700">
                          {t('showoff.earnedCoins', { coins: showoff.reward_coins })}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center space-x-6">
                      <button
                        onClick={() => handleLike(showoff.id)}
                        className="flex items-center space-x-2 group"
                      >
                        {showoff.is_liked ? (
                          <HeartIconSolid className="w-6 h-6 text-red-500" />
                        ) : (
                          <HeartIcon className="w-6 h-6 text-gray-400 group-hover:text-red-500 transition-colors" />
                        )}
                        <span className={`text-sm font-medium ${
                          showoff.is_liked ? 'text-red-500' : 'text-gray-500 group-hover:text-red-500'
                        }`}>
                          {showoff.likes_count}
                        </span>
                      </button>
                    </div>

                    <button
                      onClick={() => handleShare(showoff)}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <ShareIcon className="w-5 h-5 text-gray-600" />
                      <span className="text-sm font-medium text-gray-700">{t('common.share')}</span>
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Load More Trigger */}
            {hasMore && (
              <div ref={loadMoreRef} className="py-8 flex justify-center">
                {isLoadingMore && (
                  <div className="flex items-center space-x-2 text-primary">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    <span className="text-sm">{t('common.loading')}</span>
                  </div>
                )}
              </div>
            )}

            {/* No More Data */}
            {!hasMore && showoffs.length > 0 && (
              <div className="py-8 text-center text-gray-400 text-sm">
                {t('showoff.noMoreShowoffs')}
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Action Button (FAB) */}
      <motion.button
        onClick={handleCreateShowoff}
        className="fixed right-6 bottom-24 w-14 h-14 bg-gradient-to-r from-primary to-primary-dark text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-50"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
      >
        <PlusIcon className="w-7 h-7" />
      </motion.button>
    </div>
  );
};

export default ShowoffPage;
