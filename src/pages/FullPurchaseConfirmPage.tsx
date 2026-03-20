import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { Tables } from '../types/supabase';
import { ArrowLeftIcon, MapPinIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { LazyImage } from '../components/LazyImage';
import { Button } from '../components/ui/button';
import { formatCurrency, getLocalizedText, cn } from '../lib/utils';
import toast from 'react-hot-toast';
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

type Lottery = Tables<'lotteries'>;
type PickupPoint = Tables<'pickup_points'>;

const FullPurchaseConfirmPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { supabase } = useSupabase();
  const { user, wallets, refreshWallets } = useUser();
  const { lotteryId } = useParams<{ lotteryId: string }>();
  const navigate = useNavigate();

  const [lottery, setLottery] = useState<Lottery | null>(null);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useCoupon, setUseCoupon] = useState<boolean>(true);
  const [validCouponCount, setValidCouponCount] = useState<number>(0);
  const [couponTotalAmount, setCouponTotalAmount] = useState<number>(0);

  const fetchLottery = useCallback(async () => {
    if (!lotteryId) return;
    try {
      // 获取商品信息
      const { data, error } = await supabase
        .from('lotteries')
        .select('*')
        .eq('id', lotteryId)
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
    } catch (error) {
      console.error('Failed to fetch lottery:', error);
      toast.error(t('error.networkError'));
    }
  }, [lotteryId, supabase, t]);

  const fetchPickupPoints = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('pickup_points')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (data && data.length > 0) {
        setPickupPoints(data);
        setSelectedPointId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch pickup points:', error);
      toast.error(t('error.networkError'));
    }
  }, [supabase, t]);

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
        .order('expires_at', { ascending: true });
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

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchLottery(), fetchPickupPoints(), fetchCouponCount()]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchLottery, fetchPickupPoints, fetchCouponCount]);

  const handleConfirm = async () => {
    if (!user || !lottery || !selectedPointId) {
      toast.error(t('error.unknownError'));
      return;
    }

    setIsSubmitting(true);
    try {
      // 获取 session token
      const sessionToken = localStorage.getItem('custom_session_token');
      if (!sessionToken) {
        throw new Error(t('common.pleaseLogin'));
      }

      // 生成幂等性 key 防止重复提交
      const idempotencyKey = `full_purchase_${lotteryId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // 调用后端API创建全款购买订单
      const { data, error } = await supabase.functions.invoke('create-full-purchase-order', {
        body: {
          lottery_id: lotteryId,
          pickup_point_id: selectedPointId,
          user_id: user.id,
          session_token: sessionToken,
          idempotency_key: idempotencyKey,
          useCoupon: useCoupon && validCouponCount > 0, // 传递抵扣券使用状态
        },
      });

      if (error) {
        console.error('Edge Function error:', error);
        // 尝试从错误对象中提取详细信息
        const errorMessage = error.message || error.toString();
        throw new Error(errorMessage);
      }

      if (data?.success) {
        toast.success(t('lottery.fullPurchaseSuccess'));
        await refreshWallets();
        // 跳转到全款购买订单详情页
        const orderId = data.data?.order_id;
        if (orderId) {
          navigate(`/order-detail/${orderId}`);
        } else {
          navigate('/orders');
        }
      } else {
        const errorMsg = data?.error || t('error.unknownError');
        console.error('Full purchase failed:', errorMsg, data);
        throw new Error(errorMsg);
      }
    } catch (error: any) {
      console.error('Create full purchase order failed:', error);
      const errorMessage = error.message || error.toString() || t('error.purchaseFailed');
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getLocalizedPickupPointName = (point: PickupPoint) => {
    if (point.name_i18n) {
      return getLocalizedText(point.name_i18n, i18n.language) || point.name;
    }
    return point.name;
  };

  const getLocalizedPickupPointAddress = (point: PickupPoint) => {
    if (point.address_i18n) {
      return getLocalizedText(point.address_i18n, i18n.language) || point.address;
    }
    return point.address;
  };

  if (isLoading) {
    return <div className="text-center py-10">{t('common.loading')}...</div>;
  }

  if (!lottery) {
    return <div className="text-center py-10 text-red-500">{t('lottery.notFound')}</div>;
  }

  const title = getLocalizedText(lottery.title_i18n, i18n.language) || lottery.title;

  // 获取关联的库存商品信息
  const inventoryProduct = (lottery as any).inventory_product;
  
  // 全款购买价格：优先使用full_purchase_price，其次使用库存商品原价，最后使用计算价格
  const fullPurchasePrice = (lottery as any).full_purchase_price 
    || (inventoryProduct?.original_price) 
    || (lottery as any).original_price 
    || (lottery.ticket_price * lottery.total_tickets);
  
  // 全款购买库存：仅使用库存商品库存，如果没有关联库存商品则显示为无限
  // 重要：份数（total_tickets/sold_tickets）和库存（inventory_products.stock）是两个独立的概念
  const fullPurchaseStock = inventoryProduct ? inventoryProduct.stock : 999999;

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
          <h1 className="text-lg font-bold text-gray-900 truncate max-w-[70%]">
            {t('lottery.confirmOrder')}
          </h1>
          <div className="w-10"></div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* Product Info */}
        <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">{t('lottery.productInfo')}</h3>
          
          <div className="flex gap-4">
            {lottery.image_urls && lottery.image_urls.length > 0 && (
              <div style={{ position: 'relative', width: '96px', height: '96px', flexShrink: 0, borderRadius: '0.5rem', overflow: 'hidden' }}>
                <LazyImage
                  src={lottery.image_urls[0]}
                  alt={title}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                />
              </div>
            )}
            
            <div className="flex-1">
              <p className="font-bold text-gray-900">{title}</p>
              <p className="text-sm text-gray-600 mt-2">
                {t('lottery.fullPurchasePrice')}: <span className="font-bold text-red-500">
                  {formatCurrency(lottery.currency, fullPurchasePrice)}
                </span>
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {t('lottery.quantity')}: <span className="font-bold">1</span>
              </p>
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-medium">{t('lottery.totalAmount')}</span>
              <span className="text-2xl font-bold text-red-500">
                {formatCurrency(lottery.currency, fullPurchasePrice)}
              </span>
            </div>
          </div>
        </div>

        {/* Pickup Point Selection */}
        <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <MapPinIcon className="w-5 h-5 text-blue-500" />
            {t('orders.selectPickupPoint')}
          </h3>

          {pickupPoints.length > 0 ? (
            <div className="space-y-2">
              {pickupPoints.map((point) => (
                <motion.button
                  key={point.id}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => setSelectedPointId(point.id)}
                  className={cn(
                    "w-full text-left p-4 rounded-lg border-2 transition-all duration-200",
                    selectedPointId === point.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">
                        {getLocalizedPickupPointName(point)}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {getLocalizedPickupPointAddress(point)}
                      </p>
                      {point.contact_phone && (
                        <p className="text-sm text-gray-500 mt-1">
                          {t('orders.phone')}: {point.contact_phone}
                        </p>
                      )}
                    </div>
                    {selectedPointId === point.id && (
                      <CheckCircleIcon className="w-6 h-6 text-blue-500 flex-shrink-0 ml-2" />
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              {t('orders.noPickupPoints')}
            </div>
          )}
        </div>

        {/* Order Summary */}
        <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">{t('lottery.orderSummary')}</h3>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">{t('lottery.productPrice')}</span>
              <span className="text-gray-900 font-medium">
                {formatCurrency(lottery.currency, fullPurchasePrice)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">{t('lottery.quantity')}</span>
              <span className="text-gray-900 font-medium">1</span>
            </div>
            {/* 运费与补贴明细 */}
            <div className="flex justify-between">
              <span className="text-gray-600">🚚 {t('subsidyPool.shippingFee')}</span>
              <span className="text-gray-900 font-medium">{formatCurrency(lottery.currency, 15)}</span>
            </div>
            <div className="flex justify-between text-green-600">
              <span>🎁 {t('subsidyPool.platformSubsidy')}</span>
              <span className="font-medium">-{formatCurrency(lottery.currency, 15)}</span>
            </div>
            {/* 抵扣券开关 */}
            {validCouponCount > 0 && (
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">{t('coupon.switchLabel')}</span>
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
            {(() => {
              const couponDeduct = (useCoupon && validCouponCount > 0) ? Math.min(couponTotalAmount, fullPurchasePrice) : 0;
              const pointsPay = Math.max(0, fullPurchasePrice - couponDeduct);
              return (
                <>
                  {couponDeduct > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>{t('payment.couponDeduction')}</span>
                      <span className="font-medium">-{formatCurrency(lottery.currency, couponDeduct)}</span>
                    </div>
                  )}
                  {/* 支付明细 */}
                  <div className="flex justify-between text-gray-600">
                    <span>🍀 {t('payment.pointsPayment')}</span>
                    <span className="font-medium">
                      {formatCurrency(lottery.currency, pointsPay)}
                    </span>
                  </div>
                </>
              );
            })()}
            {(() => {
              const finalCouponDeduct = (useCoupon && validCouponCount > 0) ? Math.min(couponTotalAmount, fullPurchasePrice) : 0;
              const finalPayAmount = Math.max(0, fullPurchasePrice - finalCouponDeduct);
              return (
                <div className="border-t pt-2 flex justify-between">
                  <span className="text-gray-900 font-semibold">{t('payment.actualPayment')}</span>
                  <span className="text-lg font-bold text-red-500">
                    {formatCurrency(lottery.currency, finalPayAmount)}
                  </span>
                </div>
              );
            })()}
            <p className="text-xs text-blue-500">🍀 {t('payment.pointsAsValue')}</p>
          </div>
        </div>

        {/* 补贴提示 */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <p className="text-xs text-green-700 text-center">
            ✅ {t('subsidyPool.paymentSubsidy')}
          </p>
        </div>

        {/* Confirm Button */}
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={handleConfirm}
          disabled={isSubmitting || !selectedPointId}
          className={cn(
            "w-full py-3 rounded-xl font-semibold text-white shadow-md transition-all duration-200 sticky bottom-4",
            !isSubmitting && selectedPointId
              ? "bg-gradient-to-r from-green-500 to-emerald-600 hover:shadow-lg"
              : "bg-gray-300 cursor-not-allowed"
          )}
        >
          {isSubmitting ? t('common.submitting') : t('lottery.confirmOrder')}
        </motion.button>

        {/* Free Shipping Promo */}
        <p className="text-center text-xs text-gray-500 mt-3">
          {t('common.freeShippingPromo').split('0 TJS').map((part: string, i: number) => (
            <span key={i}>
              {i > 0 && <span className="font-bold text-red-500">0 TJS</span>}
              {part}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
};

export default FullPurchaseConfirmPage;
