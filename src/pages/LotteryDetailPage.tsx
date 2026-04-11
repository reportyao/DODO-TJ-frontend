import { useParams, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { Tables, Enums } from '../types/supabase';
import { ArrowLeftIcon, ClockIcon, UserGroupIcon, StarIcon, XCircleIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, TicketIcon, ShieldCheckIcon, SparklesIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
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
  isLotteryPurchasable,
} from '../lib/utils';
import toast from 'react-hot-toast';
import { lotteryService } from '../lib/supabase';
import { motion } from 'framer-motion';
import { CountdownTimer } from '../components/CountdownTimer';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTrackEvent } from '../hooks/useTrackEvent';

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
  const { track } = useTrackEvent();

  // ============================================================
  // 来源归因：从 URL 参数中提取来源信息
  // 支持 ?src_topic=xxx&src_placement=xxx&src_category=xxx&src_page=xxx
  // ============================================================
  const sourceAttribution = useRef({
    source_topic_id: new URLSearchParams(window.location.search).get('src_topic') || undefined,
    source_placement_id: new URLSearchParams(window.location.search).get('src_placement') || undefined,
    source_category_id: new URLSearchParams(window.location.search).get('src_category') || undefined,
    source_page: new URLSearchParams(window.location.search).get('src_page') || undefined,
  });

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
  const [isRulesExpanded, setIsRulesExpanded] = useState<boolean>(true);
  const [useCoupon, setUseCoupon] = useState<boolean>(true);
  const [validCouponCount, setValidCouponCount] = useState<number>(0);
  const [couponTotalAmount, setCouponTotalAmount] = useState<number>(0);

  // 获取用户有效抵扣券数量和最早到期那张券的面额
  // 【R14修复】每次订单只能使用一张抵扣券（最早到期），前端显示金额须与后端保持一致
  const fetchCouponCount = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('coupons')
        .select('amount')
        .eq('user_id', user.id)
        .eq('status', 'VALID')
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true })
        .limit(20);
      if (!error && data) {
        setValidCouponCount(data.length);
        // 只取最早到期的一张券面额（与后端 process_mixed_payment LIMIT 1 逻辑一致）
        setCouponTotalAmount(data.length > 0 ? (Number(data[0].amount) || 0) : 0);
        setUseCoupon(data.length > 0);
      }
    } catch (e) {
      console.error('Failed to fetch coupon count:', e);
    }
  }, [user, supabase]);

  const fetchMyTickets = useCallback(async () => {
    if (!id || !user) return;
    try {
      // 【BUG修复】同时查询 participation_code 和 numbers 字段，兼容新旧两种数据格式
      // 旧版 purchase_lottery_with_concurrency_control 只写入 numbers 字段
      // 新版 allocate_lottery_tickets 只写入 participation_code 字段
      const { data, error } = await supabase
        .from('lottery_entries')
        .select('participation_code, numbers')
        .eq('lottery_id', id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) throw error;
      if (data) {
        const codes = data.map((entry: any) => {
          // 优先使用 participation_code（新版字段）
          if (entry.participation_code) {
            return String(entry.participation_code);
          }
          // 兼容旧版 numbers 字段
          if (entry.numbers != null) {
            // numbers 可能是字符串或 JSON
            const numVal = typeof entry.numbers === 'string' ? entry.numbers : String(entry.numbers);
            return numVal;
          }
          return null;
        }).filter(Boolean) as string[];
        setMyTickets(codes);
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
      // 使用直接 fetch 绕过缓存，确保获取最新数据
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
      
      // 如果已完成开奖，检查是否有新一轮 ACTIVE 期（同一商品）
      if (data && data.status === 'COMPLETED') {
        try {
          // 查找同一商品的最新 ACTIVE 期
          const { data: nextRound } = await supabase
            .from('lotteries')
            .select('id')
            .eq('status', 'ACTIVE')
            .eq('title', data.title)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (nextRound && nextRound.id !== id) {
            // 有新一轮，跳转到新一轮的详情页
            navigate(`/lottery/${nextRound.id}`, { replace: true });
            return;
          }
        } catch (nextRoundError) {
          console.warn('[LotteryDetail] Failed to check next round:', nextRoundError);
        }
        // 没有新一轮，跳转到开奖结果页
        navigate(`/lottery/${id}/result`);
      } else if (data && data.status === 'SOLD_OUT') {
        // 已售罄但还未开奖，跳转到开奖结果页（等待开奖）
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

  // 轻量级刷新：仅更新 sold_tickets 和库存，不触发 loading 状态和跳转逻辑
  // 用于购买成功后立即刷新进度条，避免 fetchLottery 的 setIsLoading(true) 导致页面闪烁
  const refreshLotteryProgress = useCallback(async () => {
    if (!id) return;
    try {
      // 添加时间戳参数绕过任何可能的缓存
      const { data, error } = await supabase
        .from('lotteries')
        .select('sold_tickets, total_tickets, status')
        .eq('id', id)
        .single();

      if (error || !data) return;

      // 更新 lottery 状态中的 sold_tickets，保留其他字段不变
      setLottery(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sold_tickets: data.sold_tickets,
          total_tickets: data.total_tickets,
          status: data.status,
        };
      });
    } catch (err) {
      console.warn('[LotteryDetail] Failed to refresh progress:', err);
    }
  }, [id, supabase]);

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
            .in('id', userIds)
            .limit(50);

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

  // ============================================================
  // 商品详情页浏览埋点（文档 10.1 事件清单要求）
  // ============================================================
  useEffect(() => {
    if (id && !isLoading && lottery) {
      const inventoryProductId = (lottery as any)?.inventory_product_id;
      track({
        event_name: 'product_detail_view' as any,
        page_name: 'lottery_detail',
        entity_type: 'product' as any,
        entity_id: id,
        lottery_id: id,
        inventory_product_id: inventoryProductId || undefined,
        ...sourceAttribution.current,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isLoading]);

  // 页面重新可见时自动刷新数据（解决购买后刷新页面进度不更新的问题）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchLottery();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchLottery]);

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
  const isActive = isLotteryPurchasable(lottery);
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
  const canFullPurchase = fullPurchaseEnabled && fullPurchaseStock > 0 && isActive;

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
    
    // 【BUG修复】一元夺宝不使用抵扣券，直接用全额计算
    const actualPointsNeeded = totalCost;
    
    // 检查总可用资产（TJS + LUCKY_COIN，不包含抵扣券）
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

    // 检查用户限购（需要考虑已购数量）
    if (lottery.max_per_user) {
      const alreadyPurchased = myTickets.length;
      const remaining = lottery.max_per_user - alreadyPurchased;
      if (remaining <= 0) {
        toast.error(t('lottery.maxQuantityReached', { max: lottery.max_per_user }));
        return;
      }
      if (quantity > remaining) {
        toast.error(t('lottery.maxQuantityHint', { max: remaining }));
        return;
      }
    }

    setIsPurchasing(true);
    
    try {
      // 【BUG修复】一元夺宝购买强制不使用抵扣券，传入 false
      const order = await lotteryService.purchaseTickets(lottery.id, quantity, user.id, false);
      
      toast.success(t('lottery.purchaseSuccess'));
      
      // 【BUG修复】直接使用 Edge Function 返回的数据更新本地状态
      // 避免异步查询的时序问题导致 sold_tickets 和 myTickets 不同步
      const purchaseResult = order?.data || order;

      // ============================================================
      // 订单链路埋点（文档 10.1 事件清单要求）
      // 一元夺宝购买成功 = order_create + order_pay_success
      // ============================================================
      const orderId = purchaseResult?.order_id || purchaseResult?.id;
      const inventoryProductId = (lottery as any)?.inventory_product_id;
      const orderTrackBase = {
        page_name: 'lottery_detail',
        entity_type: 'order' as any,
        entity_id: orderId || id,
        lottery_id: id,
        inventory_product_id: inventoryProductId || undefined,
        order_id: orderId || undefined,
        ...sourceAttribution.current,
        metadata: {
          purchase_type: 'lottery',
          quantity,
          total_cost: lottery.ticket_price * quantity,
        },
      };
      track({ ...orderTrackBase, event_name: 'order_create' as any });
      track({ ...orderTrackBase, event_name: 'order_pay_success' as any });
      const newParticipationCodes: string[] = purchaseResult?.participation_codes || [];
      
      if (newParticipationCodes.length > 0) {
        // 立即更新参与码列表（追加新购买的参与码）
        setMyTickets(prev => [...prev, ...newParticipationCodes.map(String)]);
        // 立即更新 sold_tickets（原子性更新，与参与码同步）
        setLottery(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            sold_tickets: prev.sold_tickets + quantity,
          };
        });
      }
      
      // 后台刷新钱包余额（不影响参与码显示）
      refreshWallets();
      
      // 重置数量为 1
      setQuantity(1);
      
      // 延迟后再从数据库刷新，确保数据最终一致性
      await new Promise(resolve => setTimeout(resolve, 500));
      await Promise.all([
        refreshLotteryProgress(),
        fetchMyTickets()
      ]);
      
      // 检查是否售罄，优先使用 Edge Function 返回的结果
      const isSoldOut = purchaseResult?.is_sold_out;
      if (isSoldOut) {
        toast.success(t('lottery.soldOutRedirect'));
        navigate(`/lottery/${id}/result`);
      } else {
        // 如果 Edge Function 没有返回售罄状态，再查询数据库确认
        const { data: updatedLottery } = await supabase
          .from('lotteries')
          .select('status')
          .eq('id', id)
          .single();
        
        if (updatedLottery?.status === 'SOLD_OUT') {
          toast.success(t('lottery.soldOutRedirect'));
          navigate(`/lottery/${id}/result`);
        }
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

        {/* ============================================ */}
        {/* 区域一：商品信息区 */}
        {/* ============================================ */}
        <div className="bg-white rounded-xl shadow-md p-4 space-y-4">
          {/* 标题 + 状态标签 */}
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold text-gray-900 flex-1 mr-3">{title}</h2>
            <span className={cn(
              "px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0",
              getLotteryStatusColor(lottery.status)
            )}>
              {getLotteryStatusText(lottery.status, t)}
            </span>
          </div>

          {/* 补贴 + 免邮标签 */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-100">
              🎁 {t('subsidyPool.subsidyTag')}
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-100">
              🚚 {t('subsidyPool.freeShippingTag')}
            </span>
          </div>

          {/* 商品描述 - 默认3行折叠 */}
          {description && (
            <div className="space-y-2">
              <div className={cn(
                "text-gray-600 text-sm leading-relaxed whitespace-pre-line",
                !isDescriptionExpanded && "line-clamp-3"
              )}>
                {description.split(/(?<=[.。!！?？])\s+/).map((paragraph: string, index: number) => (
                  <p key={index} className="mb-1 last:mb-0">{paragraph.trim()}</p>
                ))}
              </div>
              {description.length > 80 && (
                <button
                  onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  className="text-primary text-sm font-medium hover:text-primary-dark transition-colors flex items-center gap-1"
                >
                  {isDescriptionExpanded ? (
                    <>
                      <span>{t('common.collapse')}</span>
                      <ChevronDownIcon className="w-4 h-4 transform rotate-180 transition-transform" />
                    </>
                  ) : (
                    <>
                      <span>{t('common.expandMore')}</span>
                      <ChevronDownIcon className="w-4 h-4 transition-transform" />
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* 价格 + 免邮 */}
          <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-extrabold text-red-500">
                  {formatCurrency(lottery.currency, fullPurchasePrice)}
                </p>
              </div>
              <div className="flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1.5 rounded-full text-sm font-medium">
                <span>🚚</span>
                <span>{t('subsidyPool.freeShippingTag')}</span>
              </div>
            </div>
          </div>

          {/* 比价清单 */}
          {priceComparisons.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                📊 {t('lottery.priceComparison')}
              </p>
              {priceComparisons.map((item: PriceComparisonItem, index: number) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{item.platform}</span>
                  <span className="text-gray-400 line-through">{formatCurrency(lottery.currency, item.price)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm border-t border-gray-200 pt-2">
                <span className="text-green-700 font-semibold">{t('lottery.ourPlatform')}</span>
                <span className="text-green-700 font-bold flex items-center gap-1">
                  {formatCurrency(lottery.currency, fullPurchasePrice)}
                  <CheckCircleIcon className="w-4 h-4" />
                </span>
              </div>
            </div>
          )}

          {/* 全款购买按钮 */}
          {isActive && (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleFullPurchase}
              disabled={!canFullPurchase || isSoldOut || isFullPurchasing}
              className={cn(
                "w-full py-3.5 rounded-xl font-bold text-base shadow-md transition-all duration-200",
                canFullPurchase && !isSoldOut && !isFullPurchasing
                  ? "bg-gradient-to-r from-orange-500 to-red-500 text-white hover:shadow-lg"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              )}
            >
              {isFullPurchasing 
                ? t('common.submitting') 
                : !fullPurchaseEnabled 
                  ? t('lottery.fullPurchaseDisabled') 
                  : fullPurchaseStock <= 0 
                    ? t('lottery.fullPurchaseOutOfStock') 
                    : `${formatCurrency(lottery.currency, fullPurchasePrice)} ${t('lottery.buyAllNow')}`
              }
            </motion.button>
          )}
        </div>

        {/* ============================================ */}
        {/* 过渡引导区 */}
        {/* ============================================ */}
        {isActive && remainingTickets > 0 && (
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary-light to-transparent" />
            <p className="text-sm font-semibold text-primary whitespace-nowrap flex items-center gap-1.5">
              <SparklesIcon className="w-4 h-4" />
              {t('lottery.tryLuckTransition')}
              <SparklesIcon className="w-4 h-4" />
            </p>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary-light to-transparent" />
          </div>
        )}

        {/* ============================================ */}
        {/* 区域二：福气活动区 */}
        {/* ============================================ */}
        {isActive && remainingTickets > 0 && (
          <div className="bg-gradient-to-br from-amber-50 via-white to-amber-50 rounded-xl shadow-md p-4 space-y-4 border border-amber-100">
            
            {/* 活动标题 */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
                <SparklesIcon className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">{t('lottery.luckyActivityTitle')}</h3>
            </div>

            {/* 每份价格 */}
            <div className="text-center py-2">
              <p className="text-sm text-gray-500 mb-1">{t('lottery.perSharePrice')}</p>
              <p className="text-3xl font-extrabold text-primary">
                {formatCurrency(lottery.currency, lottery.ticket_price)}
                <span className="text-sm font-normal text-gray-500 ml-1">/{t('lottery.perShare')}</span>
              </p>
            </div>

            {/* 玩法说明 - 折叠 */}
            <div className="bg-white/70 rounded-xl border border-amber-100">
              <button
                onClick={() => setIsRulesExpanded(!isRulesExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-primary-dark"
              >
                <span className="flex items-center gap-1.5">
                  <ShieldCheckIcon className="w-4 h-4" />
                  {t('lottery.howToPlay')}
                </span>
                <ChevronDownIcon className={cn(
                  "w-4 h-4 transition-transform duration-200",
                  isRulesExpanded && "rotate-180"
                )} />
              </button>
              {isRulesExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-amber-100 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</div>
                    <p className="text-sm text-gray-600">{t('lottery.ruleStep1')}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-amber-100 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</div>
                    <p className="text-sm text-gray-600">{t('lottery.ruleStep2')}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-amber-100 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</div>
                    <p className="text-sm text-gray-600">{t('lottery.ruleStep3')}</p>
                  </div>
                  {/* 核心保障：未获得商品返还等值抵扣券 */}
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 mt-2">
                    <p className="text-sm text-green-700 font-semibold flex items-center gap-1.5">
                      <ShieldCheckIcon className="w-4 h-4 flex-shrink-0" />
                      {t('lottery.refundGuarantee')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 活动进度 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center text-sm text-gray-500">
                  <UserGroupIcon className="w-4 h-4 mr-1" />
                  {t('lottery.soldTickets')}: {lottery.sold_tickets}/{lottery.total_tickets}
                </div>
                <span className="text-sm font-medium text-primary">
                  {progress.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-gradient-to-r from-primary to-primary-dark h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {t('lottery.remainingShares', { count: remainingTickets })}
              </p>
            </div>

            {/* 180秒开奖倒计时 */}
            {isSoldOut && lottery.draw_time && (
              <CountdownTimer 
                drawTime={lottery.draw_time} 
                onCountdownEnd={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke('auto-lottery-draw', {
                      body: { lotteryId: id }
                    });
                    if (error || !data?.success) {
                      console.error('[LotteryDetail] Draw failed:', error?.message || data?.error);
                    } else {
                    }
                    await fetchLottery();
                  } catch (error: any) {
                    console.error('[LotteryDetail] Draw error:', error);
                    await fetchLottery();
                  }
                }}
              />
            )}

            {/* 我的参与码 */}
            {user && myTickets.length > 0 && (
              <div className="bg-white/80 rounded-xl p-3 border border-amber-100">
                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                  <TicketIcon className="w-4 h-4 text-primary" />
                  {t('lottery.myTickets')}
                </h4>
                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                  {myTickets.map((code: string, index: number) => (
                    <span
                      key={index}
                      className="px-2.5 py-1 rounded-lg font-mono text-xs font-semibold bg-amber-50 text-primary-dark border border-amber-200"
                    >
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 购买份数选择 */}
            <div className="bg-white/80 rounded-xl p-4 border border-amber-100">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{t('lottery.selectShares')}</span>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => handleQuantityChange(-1)}
                    disabled={quantity <= 1}
                    className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center justify-center text-lg font-bold transition-colors"
                  >
                    -
                  </button>
                  <span className="text-xl font-bold text-gray-900 w-10 text-center">{quantity}</span>
                  <button
                    onClick={() => handleQuantityChange(1)}
                    disabled={!lottery || quantity >= remainingTickets}
                    className="w-8 h-8 rounded-full bg-primary hover:bg-primary disabled:bg-gray-100 disabled:cursor-not-allowed flex items-center justify-center text-lg font-bold text-white transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* 将获得的参与码预览 */}
              {quantity > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1.5">{t('lottery.willGetParticipationCodes')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: quantity }, (_, i) => {
                      const nextCodeNumber = 1000000 + lottery.sold_tickets + i;
                      const codeStr = String(nextCodeNumber).padStart(7, '0');
                      return (
                        <span
                          key={i}
                          className="px-2 py-1 rounded-md font-mono text-xs font-semibold bg-gradient-to-br from-primary to-primary-dark text-white"
                        >
                          {codeStr}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 【BUG修复】抵扣券开关已从一元夺宝区域移除 */}
            {/* iTJS优惠券仅适用于全款购买，不适用于一元夺宝(lottery) */}

            {/* 余额显示 + 合计 */}
            <div className="flex items-center justify-between text-sm px-1">
              <div className="flex items-center gap-3 text-gray-500">
                <span>💰 {formatCurrency('TJS', wallets.find(w => w.type === 'TJS')?.balance || 0)}</span>
                <span>🍀 {(wallets.find(w => w.type === 'LUCKY_COIN')?.balance || 0).toFixed(1)}</span>
              </div>
              <div className="text-right">
                <span className="text-gray-500">{t('payment.totalAmount')}: </span>
                <span className="text-lg font-bold text-primary">
                  {formatCurrency(lottery.currency, lottery.ticket_price * quantity)}
                </span>
              </div>
            </div>

            {/* 核心保障提示 */}
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <p className="text-xs text-green-700 font-medium text-center flex items-center justify-center gap-1">
                <ShieldCheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
                {t('lottery.refundGuarantee')}
              </p>
            </div>

            {/* 参与活动按钮 */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handlePurchase}
              disabled={!isActive || isSoldOut || isPurchasing}
              className={cn(
                "w-full py-3.5 rounded-xl font-bold text-base shadow-md transition-all duration-200",
                isActive && !isSoldOut && !isPurchasing
                  ? "bg-gradient-to-r from-primary to-primary-dark text-white hover:shadow-lg"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              )}
            >
              {isPurchasing 
                ? t('common.submitting') 
                : isSoldOut 
                  ? t('lottery.soldOut') 
                  : `${formatCurrency(lottery.currency, lottery.ticket_price * quantity)} ${t('lottery.participateNow')}`
              }
            </motion.button>
          </div>
        )}

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
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-amber-100 flex items-center justify-center text-sm font-bold text-primary overflow-hidden flex-shrink-0">
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
