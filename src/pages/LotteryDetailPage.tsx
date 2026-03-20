import { useParams, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { Tables, Enums } from '../types/supabase';
import { ArrowLeftIcon, ClockIcon, UserGroupIcon, StarIcon, XCircleIcon, ChevronLeftIcon, ChevronRightIcon, TicketIcon } from '@heroicons/react/24/outline';
import { LazyImage } from '../components/LazyImage';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import {
  formatCurrency,
  formatDateTime,
  getLotteryStatusText,
  getLotteryStatusColor,
  getTimeRemaining,
  cn,
  getLocalizedText,
} from '../lib/utils';
import toast from 'react-hot-toast';
import { lotteryService } from '../lib/supabase';
import { motion } from 'framer-motion';
import { CountdownTimer } from '../components/CountdownTimer';
import { useState, useEffect, useCallback } from 'react';

type Lottery = Tables<'lotteries'>;
type Showoff = Tables<'showoffs'> & {
  user: Tables<'profiles'>;
  image_urls?: string[];
};

// 比价清单项类型
interface PriceComparisonItem {
  platform: string;
  price: number;
}

const LotteryDetailPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { supabase } = useSupabase();
  const { user, wallets, refreshWallets } = useUser();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [lottery, setLottery] = useState<Lottery | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState<ReturnType<typeof getTimeRemaining> | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);

  // 自动播放图片（修复：移除activeImageIndex依赖，避免定时器冲突）
  useEffect(() => {
    if (!lottery?.image_urls || lottery.image_urls.length <= 1 || !autoPlayEnabled) return;
    
    const timer = setInterval(() => {
      setActiveImageIndex((prev) => 
        prev === lottery.image_urls.length - 1 ? 0 : prev + 1
      );
    }, 3000); // 每3秒切换

    return () => clearInterval(timer);
  }, [lottery?.image_urls, lottery?.image_urls?.length, autoPlayEnabled]);
  const [randomShowoffs, setRandomShowoffs] = useState<Showoff[]>([]);
  const [quantity, setQuantity] = useState<number>(1);
  const [isPurchasing, setIsPurchasing] = useState<boolean>(false);
  const [isFullPurchasing, setIsFullPurchasing] = useState<boolean>(false);
  const [myTickets, setMyTickets] = useState<string[]>([]);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState<boolean>(false);
  const [useCoupon, setUseCoupon] = useState<boolean>(true);
  const [validCouponCount, setValidCouponCount] = useState<number>(0);
  const [couponTotalAmount, setCouponTotalAmount] = useState<number>(0);

  // 获取用户有效抵扣券数量和总面额
  const fetchCouponCount = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('coupons')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'VALID')
        .gt('expires_at', new Date().toISOString());
      if (!error && data) {
        setValidCouponCount(data.length);
        setCouponTotalAmount(data.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0));
        setUseCoupon(data.length > 0);
      }
    } catch (e) {
      console.error('Failed to fetch coupon count:', e);
    }
  }, [user, supabase]);

  const fetchMyTickets = useCallback(async () => {
    if (!id || !user) return;
    try {
      const { data, error } = await supabase
        .from('lottery_entries')
        .select('participation_code')
        .eq('lottery_id', id)
        .eq('user_id', user.id);

      if (error) throw error;
      if (data) {
        setMyTickets(data.map((entry: any) => entry.participation_code).filter(Boolean));
      }
    } catch (error) {
      console.error('Failed to fetch my tickets:', error);
    }
  }, [id, user, supabase]);

  const fetchLottery = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      // 获取商品信息，包含关联的库存商品信息
      const { data, error } = await supabase
        .from('lotteries')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      // 如果有关联的库存商品ID，单独查询库存商品信息
      let inventoryProductData = null;
      const inventoryProductId = (data as any)?.inventory_product_id;
      if (inventoryProductId) {
        const { data: invData } = await supabase
          .from('inventory_products' as any)
          .select('id, stock, original_price, status')
          .eq('id', inventoryProductId)
          .single();
        inventoryProductData = invData;
      }

      // 将库存商品信息附加到lottery对象
      const lotteryWithInventory = {
        ...data,
        inventory_product: inventoryProductData
      };

      setLottery(lotteryWithInventory);
      
      // 如果已售罄或已开奖，跳转到开奖页面
      if (data && (data.status === 'SOLD_OUT' || data.status === 'COMPLETED')) {
        navigate(`/lottery/${id}/result`);
      }

      // 获取我的参与码
      if (user) {
        fetchMyTickets();
      }
    } catch (error) {
      console.error('Failed to fetch lottery:', error);
      toast.error(t('error.networkError'));
    } finally {
      setIsLoading(false);
    }
  }, [id, supabase, t, user, fetchMyTickets]);

  const fetchRandomShowoffs = useCallback(async () => {
    try {
      // 获取最近的 3 个已审核晒单（包含 display_username 和 display_avatar_url 字段）
      const { data: showoffsData, error: showoffsError } = await supabase
        .from('showoffs')
        .select('*')
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false })
        .limit(3);

      if (showoffsError) throw showoffsError;

      if (showoffsData && showoffsData.length > 0) {
        // 批量获取真实用户信息（仅针对有 user_id 的晒单）
        const userIds = [...new Set(showoffsData.map((s: any) => s.user_id).filter(Boolean))];
        let usersMap: Record<string, any> = {};

        if (userIds.length > 0) {
          const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id, phone_number, first_name, avatar_url')
            .in('id', userIds);

          if (!usersError && usersData) {
            usersData.forEach((u: any) => {
              usersMap[u.id] = u;
            });
          }
        }

        // 合并数据：优先使用运营晒单的 display_username/display_avatar_url，
        // 其次使用真实用户的 first_name/phone_number/avatar_url
        const enrichedShowoffs = showoffsData.map((showoff: any) => ({
          ...showoff,
          image_urls: showoff.image_urls || showoff.images || [],
          user: usersMap[showoff.user_id] || null
        }));

        setRandomShowoffs(enrichedShowoffs);
      } else {
        setRandomShowoffs([]);
      }
    } catch (error) {
      console.error('Failed to fetch random showoffs:', error);
      setRandomShowoffs([]);
    }
  }, [supabase]);

  useEffect(() => {
    fetchLottery();
    fetchRandomShowoffs();
    fetchCouponCount();
  }, [fetchLottery, fetchRandomShowoffs, fetchCouponCount]);

  // 移除活动结束时间倒计时，只保留售罄后的 180 秒开奖倒计时

  if (isLoading) {
    return <div className="text-center py-10">{t('common.loading')}...</div>;
  }

  if (!lottery) {
    return <div className="text-center py-10 text-red-500">{t('lottery.notFound')}</div>;
  }

  // 处理 title：优先使用 title_i18n，如果为空则尝试解析 title 是否为 JSON 字符串
  let title = getLocalizedText(lottery.title_i18n, i18n.language);
  if (!title) {
    title = getLocalizedText(lottery.title as any, i18n.language) || lottery.title;
  }

  // 处理 description：优先使用 description_i18n，如果为空则尝试解析 description 是否为 JSON 字符串
  let description = getLocalizedText(lottery.description_i18n, i18n.language);
  if (!description) {
    description = getLocalizedText(lottery.description as any, i18n.language) || lottery.description || '';
  }

  const specifications = getLocalizedText(lottery.specifications_i18n, i18n.language);
  const material = getLocalizedText(lottery.material_i18n, i18n.language);
  const details = getLocalizedText(lottery.details_i18n, i18n.language);

  const progress = (lottery.sold_tickets / lottery.total_tickets) * 100;
  const isActive = lottery.status === 'ACTIVE';
  const isSoldOut = lottery.status === 'SOLD_OUT';
  const isUpcoming = lottery.status === 'UPCOMING' || lottery.status === 'PENDING';

  // 获取比价清单数据
  const priceComparisons: PriceComparisonItem[] = (() => {
    try {
      const data = (lottery as any).price_comparisons;
      if (Array.isArray(data)) {
        return data;
      }
      return [];
    } catch {
      return [];
    }
  })();

  // 计算全款购买价格和库存
  const remainingTickets = lottery.total_tickets - lottery.sold_tickets;
  
  // 获取关联的库存商品信息
  const inventoryProduct = (lottery as any).inventory_product;
  
  // 全款购买是否启用
  const fullPurchaseEnabled = (lottery as any).full_purchase_enabled !== false;
  
  // 全款购买库存：仅使用库存商品库存，如果没有关联库存商品则显示为无限（不影响一元购物份数）
  // 重要：份数（total_tickets/sold_tickets）和库存（inventory_products.stock）是两个独立的概念
  // 份数用于一元购物抽奖，库存用于全款购买
  const fullPurchaseStock = inventoryProduct ? inventoryProduct.stock : 999999;
  
  // 全款购买价格：优先使用full_purchase_price，其次使用库存商品原价，最后使用计算价格
  const fullPurchasePrice = (lottery as any).full_purchase_price 
    || (inventoryProduct?.original_price) 
    || (lottery as any).original_price 
    || (lottery.ticket_price * lottery.total_tickets);
  
  // 全款购买是否可用
  const canFullPurchase = fullPurchaseEnabled && fullPurchaseStock > 0 && lottery.status === 'ACTIVE';

  const handlePurchase = async () => {
    // 检查登录状态
    if (!user) {
      toast.error(t('error.notLoggedIn') || t('errors.pleaseLogin'));
      return;
    }

    if (!isActive || quantity < 1) {
      toast.error(t('lottery.pleaseEnterQuantity'));
      return;
    }

    if (!lottery) {
      toast.error(t('error.unknownError'));
      return;
    }

    // 计算需要的总金额
    const totalCost = lottery.ticket_price * quantity;
    
    // 计算抵扣券可抵扣金额（最多抵扣一张，不超过总价）
    const couponDeduction = (useCoupon && validCouponCount > 0) ? Math.min(couponTotalAmount, totalCost) : 0;
    const actualPointsNeeded = totalCost - couponDeduction;
    
    // 【修复 M3】检查总可用资产（TJS + LUCKY_COIN + 抵扣券）
    // 后端 process_mixed_payment 支持三级混合支付：抵扣券 → TJS → LUCKY_COIN
    const tjsWallet = wallets.find(w => w.type === 'TJS');
    const tjsBalance = tjsWallet?.balance || 0;
    const luckyCoinsWallet = wallets.find(w => w.type === 'LUCKY_COIN');
    const luckyCoinsBalance = luckyCoinsWallet?.balance || 0;
    const totalAvailable = tjsBalance + luckyCoinsBalance;
    
    if (totalAvailable < actualPointsNeeded) {
      toast.error(t('wallet.insufficientBalance'));
      return;
    }

    // 检查剩余票数
    if (quantity > (lottery.total_tickets - lottery.sold_tickets)) {
      toast.error(t('lottery.sharesNotEnough'));
      return;
    }

    // 检查用户限购
    if (lottery.max_per_user && quantity > lottery.max_per_user) {
      toast.error(t('lottery.maxQuantityHint', { max: lottery.max_per_user }));
      return;
    }

    setIsPurchasing(true);
    
    try {
      // 调用购买 API，传入 user.id 和 useCoupon 参数
      const order = await lotteryService.purchaseTickets(lottery.id, quantity, user.id, useCoupon && validCouponCount > 0);
      
      console.log('Purchase successful:', order);
      toast.success(t('lottery.purchaseSuccess'));
      
      // 刷新抽奖数据和钱包
      await fetchLottery();
      await refreshWallets();
      
      // 重置数量为 1
      setQuantity(1);
      
      // 如果售罄，跳转到开奖页面
      const { data: updatedLottery } = await supabase
        .from('lotteries')
        .select('status')
        .eq('id', id)
        .single();
      
      if (updatedLottery?.status === 'SOLD_OUT') {
        toast.success(t('lottery.soldOutRedirect'));
        navigate(`/lottery/${id}/result`);
      }
      
    } catch (error: any) {
      console.error('Purchase failed:', error);
      
      // 处理特定错误
      if (error.message?.includes(t('errors.insufficientBalance'))) {
        toast.error(t('wallet.insufficientBalance'));
      } else if (error.message?.includes(t('lottery.soldOut'))) {
        toast.error(t('lottery.soldOut'));
      } else if (error.message?.includes(t('errors.exceedsLimit'))) {
        toast.error(t('lottery.maxQuantityHint', { max: lottery.max_per_user }));
      } else {
        toast.error(error.message || t('error.purchaseFailed'));
      }
      
      // 刷新抽奖数据以获取最新状态
      await fetchLottery();
    } finally {
      setIsPurchasing(false);
    }
  };

  // 全款购买处理 - 使用原价购买，跳转到确认页
  const handleFullPurchase = async () => {
    // 检查登录状态
    if (!user) {
      toast.error(t('error.notLoggedIn') || t('errors.pleaseLogin'));
      return;
    }

    // 检查全款购买是否启用
    if (!fullPurchaseEnabled) {
      toast.error(t('lottery.fullPurchaseDisabled'));
      return;
    }

    // 检查库存（使用库存商品库存或剩余份数）
    if (fullPurchaseStock <= 0) {
      toast.error(t('lottery.fullPurchaseOutOfStock'));
      return;
    }

    if (!isActive) {
      toast.error(t('lottery.notActive'));
      return;
    }

    if (!lottery) {
      toast.error(t('error.unknownError'));
      return;
    }

    // 检查积分余额（考虑抵扣券抵扣后）
    const couponDeduction = (useCoupon && validCouponCount > 0) ? Math.min(couponTotalAmount, fullPurchasePrice) : 0;
    const actualNeeded = fullPurchasePrice - couponDeduction;
    const luckyCoinsWallet = wallets.find(w => w.type === 'LUCKY_COIN');
    const luckyCoinsBalance = luckyCoinsWallet?.balance || 0;
    
    if (luckyCoinsBalance < actualNeeded) {
      toast.error(t('lottery.fullPurchaseInsufficientBalance', { 
        required: actualNeeded, 
        current: luckyCoinsBalance 
      }));
      return;
    }

    // 全款购买使用原价，跳转到商品确认页选择自提点
    navigate(`/full-purchase-confirm/${lottery.id}`);
  };

  const handleQuantityChange = (delta: number) => {
    const newQuantity = quantity + delta;
    if (newQuantity >= 1 && lottery && newQuantity <= (lottery.total_tickets - lottery.sold_tickets)) {
      setQuantity(newQuantity);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center space-x-2 text-gray-700 hover:text-gray-900"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            <span>{t('common.back')}</span>
          </button>
          <h1 className="text-lg font-bold text-gray-900 truncate max-w-[70%]">{title}</h1>
          <div className="w-10"></div> {/* Placeholder for alignment */}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* Image Carousel */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div 
            className="relative overflow-hidden bg-gray-50"
            style={{ height: '375px' }} // 固定高度，类似淘宝/拼多多
            onTouchStart={(e) => {
              setAutoPlayEnabled(false); // 用户交互时暂停自动播放
              const touch = e.touches[0];
              (e.currentTarget as any)._touchStartX = touch.clientX;
            }}
            onTouchEnd={(e) => {
              const touch = e.changedTouches[0];
              const startX = (e.currentTarget as any)._touchStartX;
              const diff = startX - touch.clientX;
              
              if (Math.abs(diff) > 50 && lottery.image_urls) {
                if (diff > 0 && activeImageIndex < lottery.image_urls.length - 1) {
                  setActiveImageIndex(activeImageIndex + 1);
                } else if (diff < 0 && activeImageIndex > 0) {
                  setActiveImageIndex(activeImageIndex - 1);
                }
              }
              
              // 重新启动自动播放
              setTimeout(() => setAutoPlayEnabled(true), 5000);
            }}
            onClick={() => setIsImageModalOpen(true)}
          >
            {lottery.image_urls && lottery.image_urls.length > 0 ? (
              <img
                src={lottery.image_urls[activeImageIndex]}
                alt={title}
                style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer', display: 'block', maxWidth: 'none' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-200">
                <StarIcon className="w-12 h-12 text-gray-400" />
              </div>
            )}
            
            {/* Navigation Arrows */}
            {lottery.image_urls && lottery.image_urls.length > 1 && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setActiveImageIndex((prev) => prev === 0 ? lottery.image_urls.length - 1 : prev - 1);
                    setAutoPlayEnabled(false);
                    setTimeout(() => setAutoPlayEnabled(true), 5000);
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-3 rounded-full hover:bg-black/70 active:bg-black/80 transition-colors z-20"
                  aria-label="Previous image"
                >
                  <ChevronLeftIcon className="w-6 h-6" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setActiveImageIndex((prev) => prev === lottery.image_urls.length - 1 ? 0 : prev + 1);
                    setAutoPlayEnabled(false);
                    setTimeout(() => setAutoPlayEnabled(true), 5000);
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-3 rounded-full hover:bg-black/70 active:bg-black/80 transition-colors z-20"
                  aria-label="Next image"
                >
                  <ChevronRightIcon className="w-6 h-6" />
                </button>
              </>
            )}
            
            {/* Image Indicators */}
            {lottery.image_urls && lottery.image_urls.length > 1 && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center space-x-2">
                {lottery.image_urls.map((_, index) => (
                  <button
                    key={index}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setActiveImageIndex(index);
                      setAutoPlayEnabled(false);
                      setTimeout(() => setAutoPlayEnabled(true), 5000);
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                    }}
                    className={cn(
                      "w-2.5 h-2.5 rounded-full transition-all",
                      index === activeImageIndex ? "bg-white w-5" : "bg-white/60"
                    )}
                    aria-label={`Switch to image ${index + 1}`}
                  />
                ))}
              </div>
            )}
            {/* Image Counter */}
            {lottery.image_urls && lottery.image_urls.length > 1 && (
              <div className="absolute top-3 right-3 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                {activeImageIndex + 1}/{lottery.image_urls.length}
              </div>
            )}
          </div>
        </div>

        {/* Image Modal */}
        {isImageModalOpen && lottery.image_urls && (
          <div 
            className="fixed inset-0 z-50 bg-black flex items-center justify-center"
            onClick={() => setIsImageModalOpen(false)}
          >
            <button
              onClick={() => setIsImageModalOpen(false)}
              className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full transition-colors z-10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="relative w-full h-full flex items-center justify-center p-4">
              <img
                src={lottery.image_urls[activeImageIndex]}
                alt={title}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'pointer' }}
                onClick={() => setIsImageModalOpen(false)}
              />
              {lottery.image_urls.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveImageIndex((prev) => prev === 0 ? lottery.image_urls.length - 1 : prev - 1);
                    }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/20 text-white p-3 rounded-full hover:bg-white/30 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveImageIndex((prev) => prev === lottery.image_urls.length - 1 ? 0 : prev + 1);
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/20 text-white p-3 rounded-full hover:bg-white/30 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/50 text-white px-4 py-2 rounded-full text-sm">
                    {activeImageIndex + 1} / {lottery.image_urls.length}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 参与码展示区域 */}
        <div className="space-y-4">
          {/* 用户已拥有的参与码 */}
          {user && myTickets.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl shadow-md p-4 border border-blue-100"
            >
              <h3 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
                <TicketIcon className="w-5 h-5 text-blue-600" />
                {t('lottery.myTickets')}
              </h3>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
                {myTickets.map((code, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 rounded-lg font-mono text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {code}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {/* 用户购买后将获得的参与码展示 - 仅在商品未售罄时显示 */}
          {isActive && remainingTickets > 0 && quantity > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl shadow-md p-4 border border-purple-200"
            >
              <h3 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
                {t('lottery.willGetParticipationCodes')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: quantity }, (_, i) => {
                  // 参与码从0开始，sold_tickets表示已售出数量，下一个参与码就是sold_tickets + i
                  const nextCodeNumber = lottery.sold_tickets + i;
                  const codeStr = String(nextCodeNumber).padStart(7, '0');
                  return (
                    <span
                      key={i}
                      className="px-3 py-1.5 rounded-lg font-mono text-sm font-semibold bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-sm"
                    >
                      {codeStr}
                    </span>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {t('lottery.participationCodeHint')}
              </p>
            </motion.div>
          )}
        </div>

        {/* Lottery Info Card */}
        <div className="bg-white rounded-xl shadow-md p-4 space-y-4">
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
            <span className={cn(
              "px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap",
              getLotteryStatusColor(lottery.status)
            )}>
              {getLotteryStatusText(lottery.status, t)}
            </span>
          </div>

          {/* 补贴标签与免运费标签 */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-100">
              🎁 {t('subsidyPool.subsidyTag')}
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-100">
              🚚 {t('subsidyPool.freeShippingTag')}
            </span>
          </div>

          {/* 商品介绍 - 智能分段 + 折叠展开 */}
          {description && (
            <div className="space-y-2">
              <div className={cn(
                "text-gray-600 leading-relaxed whitespace-pre-line",
                !isDescriptionExpanded && "line-clamp-3"
              )}>
                {/* 智能分段：将文本按句号分段 */}
                {description.split(/(?<=[.。!！?？])\s+/).map((paragraph, index) => (
                  <p key={index} className="mb-2 last:mb-0">{paragraph.trim()}</p>
                ))}
              </div>
              {/* 展开/收起按钮 */}
              {description.length > 100 && (
                <button
                  onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  className="text-blue-600 text-sm font-medium hover:text-blue-700 transition-colors flex items-center gap-1"
                >
                  {isDescriptionExpanded ? (
                    <>
                      <span>{t('common.collapse')}</span>
                      <ChevronRightIcon className="w-4 h-4 transform rotate-90" />
                    </>
                  ) : (
                    <>
                      <span>{t('common.expandMore')}</span>
                      <ChevronRightIcon className="w-4 h-4 transform -rotate-90" />
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Price Display */}
          <div className="text-center py-2">
            <p className="text-xs text-gray-500 mb-1">{t('lottery.ticketPrice')}</p>
            <p className="text-3xl font-bold text-red-500">{formatCurrency(lottery.currency, lottery.ticket_price)}</p>
          </div>

          {/* 比价清单 */}
          {priceComparisons.length > 0 && (
            <div className="bg-gray-100 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-gray-700">{t('lottery.priceComparison')}</p>
              {priceComparisons.map((item, index) => (
                <div key={index} className="flex items-center text-sm text-gray-600">
                  <XCircleIcon className="w-4 h-4 text-red-500 mr-2" />
                  <span>{item.platform}:</span>
                  <span className="ml-2 text-gray-500">{formatCurrency(lottery.currency, item.price)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Price and Tickets */}
          <div className="grid grid-cols-3 gap-4 text-center border-t pt-4">
            <div>
              <p className="text-xs text-gray-500">{t('lottery.ticketPrice')}</p>
              <p className="text-lg font-bold text-green-600">{formatCurrency(lottery.currency, lottery.ticket_price)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('lottery.totalTickets')}</p>
              <p className="text-lg font-bold text-gray-900">{lottery.total_tickets}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('lottery.maxPerUser')}</p>
              <p className="text-lg font-bold text-gray-900">{lottery.max_per_user}</p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="pt-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center text-sm text-gray-500">
                <UserGroupIcon className="w-4 h-4 mr-1" />
                {t('lottery.soldTickets')}: {lottery.sold_tickets}/{lottery.total_tickets}
              </div>
              <span className="text-sm text-gray-500">
                {progress.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          </div>

          {/* 移除活动结束倒计时 */}

          {/* 180秒开奖倒计时 */}
          {isSoldOut && lottery.draw_time && (
            <CountdownTimer 
              drawTime={lottery.draw_time} 
              onCountdownEnd={async () => {
                // 倒计时结束后调用统一开奖入口 auto-lottery-draw
                try {
                  console.log('[LotteryDetail] 倒计时结束，开始开奖:', id);
                  const { data, error } = await supabase.functions.invoke('auto-lottery-draw', {
                    body: { lotteryId: id }
                  });
                  if (error || !data?.success) {
                    console.error('[LotteryDetail] Draw failed:', error?.message || data?.error);
                  } else {
                    console.log('[LotteryDetail] Draw successful:', data);
                  }
                  // 刷新页面查看开奖结果
                  await fetchLottery();
                } catch (error: any) {
                  console.error('[LotteryDetail] Draw error:', error);
                  // 即使开奖失败也刷新页面，可能已经被其他路径开奖了
                  await fetchLottery();
                }
              }}
            />
          )}

          {/* 购买区域 - 左右两栏布局 */}
          <div className="bg-white rounded-xl shadow-md p-4 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">{t('lottery.purchaseOptions')}</h3>
            
            <div className="space-y-3">
              {/* 购买信息卡片 */}
              <div className="grid grid-cols-2 gap-4">
                {/* 左侧：一元夺宝信息 */}
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-medium text-gray-700 text-center">{t('lottery.luckyPurchase')}</h4>
                  
                  {/* 数量选择器 */}
                  <div className="flex items-center justify-center space-x-3">
                    <button
                      onClick={() => handleQuantityChange(-1)}
                      disabled={quantity <= 1}
                      className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center justify-center text-lg font-bold"
                    >
                      -
                    </button>
                    <span className="text-xl font-bold text-gray-900 w-12 text-center">{quantity}</span>
                    <button
                      onClick={() => handleQuantityChange(1)}
                      disabled={!lottery || quantity >= (lottery.total_tickets - lottery.sold_tickets)}
                      className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center justify-center text-lg font-bold text-white"
                    >
                      +
                    </button>
                  </div>
                  
                  <div className="text-center">
                    <p className="text-xs text-gray-500">{t('lottery.totalPrice')}</p>
                    <p className="text-lg font-bold text-blue-600">
                      {formatCurrency(lottery?.currency || 'TJS', (lottery?.ticket_price || 0) * quantity)}
                    </p>
                  </div>

                  <p className="text-xs text-center text-gray-500 border-t border-gray-100 pt-2 mt-2">
                    {t('lottery.remainingTickets')}: {lottery ? lottery.total_tickets - lottery.sold_tickets : 0}
                  </p>
                  {/* 未中奖返券提示 */}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                    <p className="text-xs text-amber-700 font-medium text-center">
                      🛡️ {t('coupon.refundNotice')}
                    </p>
                  </div>
                </div>

                {/* 右侧：全款购买信息 */}
                <div className="border border-orange-200 bg-orange-50 rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-medium text-orange-700 text-center">{t('lottery.fullPurchase')}</h4>
                  
                  <p className="text-xs text-center text-orange-600">{t('lottery.fullPurchaseHint')}</p>
                  
                  <div className="text-center">
                    <p className="text-xs text-gray-500">{t('lottery.fullPurchasePrice')}</p>
                    <p className="text-lg font-bold text-orange-600">
                      {formatCurrency(lottery?.currency || 'TJS', fullPurchasePrice)}
                    </p>
                  </div>

                  {/* 补贴标签 */}
                  <div className="bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                    <p className="text-xs text-red-600 font-medium text-center">
                      🎁 {t('subsidyPool.subsidyTag')}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* 支付明细区域 - 抵扣券开关与动态计算 */}
              {isActive && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-700">{t('payment.detail')}</h4>
                  
                  {/* 抵扣券开关 */}
                  {validCouponCount > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">{t('coupon.switchLabel')}</span>
                        <span className="text-xs text-gray-400">{t('coupon.remaining', { count: validCouponCount })}</span>
                      </div>
                      <button
                        onClick={() => setUseCoupon(!useCoupon)}
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                          useCoupon ? "bg-green-500" : "bg-gray-300"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                            useCoupon ? "translate-x-6" : "translate-x-1"
                          )}
                        />
                      </button>
                    </div>
                  )}

                  {/* 支付明细计算 - 一元购模式 */}
                  {(() => {
                    const totalPrice = lottery.ticket_price * quantity;
                    const couponDeduct = (useCoupon && validCouponCount > 0) ? Math.min(couponTotalAmount, totalPrice) : 0;
                    const pointsPay = Math.max(0, totalPrice - couponDeduct);
                    return (
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between text-gray-600">
                          <span>{t('payment.totalAmount')}</span>
                          <span className="font-medium">{formatCurrency('TJS', totalPrice)}</span>
                        </div>
                        {couponDeduct > 0 && (
                          <div className="flex justify-between text-green-600">
                            <span>{t('payment.couponDeduction')}</span>
                            <span className="font-medium">-{formatCurrency('TJS', couponDeduct)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-gray-600">
                          <span>🍀 {t('payment.pointsPayment')}</span>
                          <span className="font-medium">{formatCurrency('TJS', pointsPay)}</span>
                        </div>
                        <div className="border-t border-gray-200 pt-1.5 flex justify-between font-semibold text-gray-900">
                          <span>{t('payment.actualPayment')}</span>
                          <span>{formatCurrency('TJS', pointsPay)}</span>
                        </div>
                        <p className="text-xs text-blue-500">🍀 {t('payment.pointsAsValue')}</p>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 底部按钮 - 水平对齐 */}
              <div className="grid grid-cols-2 gap-4">
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handlePurchase}
                  disabled={!isActive || isSoldOut || isPurchasing}
                  className={cn(
                    "py-3 rounded-xl font-semibold text-sm shadow-md transition-all duration-200",
                    isActive && !isSoldOut && !isPurchasing
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:shadow-lg"
                      : "bg-gray-300 text-gray-600 cursor-not-allowed"
                  )}
                >
                  {isPurchasing ? t('common.submitting') : isSoldOut ? t('lottery.soldOut') : isActive ? t('lottery.participateNow') : t('lottery.upcoming')}
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleFullPurchase}
                  disabled={!canFullPurchase || isSoldOut || isFullPurchasing}
                  className={cn(
                    "py-3 rounded-xl font-semibold text-sm shadow-md transition-all duration-200",
                    canFullPurchase && !isSoldOut && !isFullPurchasing
                      ? "bg-gradient-to-r from-orange-500 to-red-500 text-white hover:shadow-lg"
                      : "bg-gray-300 text-gray-600 cursor-not-allowed"
                  )}
                >
                  {isFullPurchasing ? t('common.submitting') : !fullPurchaseEnabled ? t('lottery.fullPurchaseDisabled') : fullPurchaseStock <= 0 ? t('lottery.fullPurchaseOutOfStock') : t('lottery.buyAllNow')}
                </motion.button>
              </div>
            </div>
          </div>
        </div>

        {/* Product Details - 只在有内容时显示 */}
        {(specifications || material || details) && (
          <div className="bg-white rounded-xl shadow-md p-4 space-y-4">
            {/* Specifications and Material */}
            {(specifications || material) && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {specifications && (
                  <div>
                    <p className="font-semibold text-gray-700">{t('lottery.specifications')}</p>
                    <p className="text-gray-600 whitespace-pre-wrap">{specifications}</p>
                  </div>
                )}
                {material && (
                  <div>
                    <p className="font-semibold text-gray-700">{t('lottery.material')}</p>
                    <p className="text-gray-600 whitespace-pre-wrap">{material}</p>
                  </div>
                )}
              </div>
            )}

            {/* Rich Text Details */}
            {details && (
              <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(details) }} />
            )}
          </div>
        )}

        {/* Random Showoffs Section */}
        <div className="bg-white rounded-xl shadow-md p-4 space-y-4">
          <h3 className="text-xl font-bold text-gray-900 border-b pb-2">{t('showoff.recentShowoffs')}</h3>
          {randomShowoffs.length > 0 ? (
            <div className="space-y-4">
              {randomShowoffs.map((showoff, index) => {
                // 优先级：运营晒单的 display_username > 真实用户的 first_name > 匿名
                const displayName = (showoff as any).display_username 
                  || (showoff.user as any)?.first_name 
                  || t('errors.anonymousUser');
                const displayAvatar = (showoff as any).display_avatar_url 
                  || showoff.user?.avatar_url;
                const avatarInitial = displayName ? displayName.charAt(0).toUpperCase() : 'U';

                return (
                  <div key={showoff.id} className="border-b last:border-b-0 pb-4">
                    <div className="flex items-center space-x-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center text-sm font-bold text-blue-600 overflow-hidden flex-shrink-0">
                        {displayAvatar ? (
                          <img 
                            src={displayAvatar} 
                            alt="" 
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).parentElement!.innerText = avatarInitial;
                            }}
                          />
                        ) : (
                          avatarInitial
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{displayName}</p>
                        <p className="text-xs text-gray-400">{formatDateTime(showoff.created_at)}</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 mb-2 line-clamp-3">{showoff.content}</p>
                    {showoff.image_urls && showoff.image_urls.length > 0 && (
                      <div className="flex space-x-2 overflow-x-auto">
                        {showoff.image_urls.slice(0, 3).map((url, imgIndex) => (
                          <div key={imgIndex} style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0, borderRadius: '0.5rem', overflow: 'hidden' }}>
                            <LazyImage
                              src={url}
                              alt={`Showoff Image ${imgIndex + 1}`}
                              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <Button variant="outline" className="w-full" onClick={() => navigate('/showoff')}>
                {t('showoff.viewAll')}
              </Button>
            </div>
          ) : (
            <div className="text-center py-4 text-gray-500">
              {t('showoff.noShowoffsYet')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LotteryDetailPage;
