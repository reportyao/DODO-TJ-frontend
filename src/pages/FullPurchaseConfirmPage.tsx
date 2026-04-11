import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { Tables } from '../types/supabase';
import { ArrowLeftIcon, MapPinIcon, CheckCircleIcon, PhotoIcon, XMarkIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { LazyImage } from '../components/LazyImage';
import { Button } from '../components/ui/button';
import { formatCurrency, getLocalizedText, cn } from '../lib/utils';
import toast from 'react-hot-toast';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { useTrackEvent } from '../hooks/useTrackEvent';

type Lottery = Tables<'lotteries'>;
type PickupPoint = Tables<'pickup_points'> & { photos?: string[]; working_hours?: any };

// 计算两点之间的距离（Haversine公式），返回公里数
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // 地球半径（公里）
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 格式化距离显示
function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  return `${km.toFixed(1)}km`;
}

const FullPurchaseConfirmPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { supabase } = useSupabase();
  const { user, wallets, refreshWallets } = useUser();
  const { lotteryId } = useParams<{ lotteryId: string }>();
  const navigate = useNavigate();
  const { track } = useTrackEvent();

  // 来源归因：从 URL 参数中提取（从LotteryDetailPage传递过来）
  const sourceAttribution = useRef({
    source_topic_id: new URLSearchParams(window.location.search).get('src_topic') || undefined,
    source_placement_id: new URLSearchParams(window.location.search).get('src_placement') || undefined,
    source_category_id: new URLSearchParams(window.location.search).get('src_category') || undefined,
    source_page: new URLSearchParams(window.location.search).get('src_page') || undefined,
  });

  const [lottery, setLottery] = useState<Lottery | null>(null);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useCoupon, setUseCoupon] = useState<boolean>(true);
  const [validCouponCount, setValidCouponCount] = useState<number>(0);
  const [couponTotalAmount, setCouponTotalAmount] = useState<number>(0);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [showAllPoints, setShowAllPoints] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);

  // 默认显示的自提点数量
  const DEFAULT_VISIBLE_COUNT = 3;

  // 获取用户位置
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationLoading(false);
        },
        () => {
          // 用户拒绝定位或定位失败
          setLocationLoading(false);
        },
        { timeout: 5000, maximumAge: 300000 }
      );
    } else {
      setLocationLoading(false);
    }
  }, []);

  const fetchLottery = useCallback(async () => {
    if (!lotteryId) return;
    try {
      const { data, error } = await supabase
        .from('lotteries')
        .select('*')
        .eq('id', lotteryId)
        .single();

      if (error) throw error;

      let inventoryProductData = null;
      const inventoryProductId = data?.inventory_product_id;
      if (inventoryProductId) {
        const { data: invData } = await supabase
          .from('inventory_products')
          .select('id, stock, original_price, status')
          .eq('id', inventoryProductId)
          .single();
        inventoryProductData = invData;
      }

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
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) throw error;
      if (data && data.length > 0) {
        setPickupPoints(data as PickupPoint[]);
      }
    } catch (error) {
      console.error('Failed to fetch pickup points:', error);
      toast.error(t('error.networkError'));
    }
  }, [supabase, t]);

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

  // 根据距离排序的自提点列表
  const sortedPickupPoints = useMemo(() => {
    if (!userLocation) return pickupPoints;
    
    return [...pickupPoints].sort((a, b) => {
      const aLat = a.latitude;
      const aLng = a.longitude;
      const bLat = b.latitude;
      const bLng = b.longitude;

      // 没有坐标的排到最后
      if (!aLat || !aLng) return 1;
      if (!bLat || !bLng) return -1;

      const distA = calculateDistance(userLocation.lat, userLocation.lng, aLat, aLng);
      const distB = calculateDistance(userLocation.lat, userLocation.lng, bLat, bLng);
      return distA - distB;
    });
  }, [pickupPoints, userLocation]);

  // 可见的自提点列表
  const visiblePoints = useMemo(() => {
    if (showAllPoints || sortedPickupPoints.length <= DEFAULT_VISIBLE_COUNT) {
      return sortedPickupPoints;
    }
    return sortedPickupPoints.slice(0, DEFAULT_VISIBLE_COUNT);
  }, [sortedPickupPoints, showAllPoints]);

  // 自动选中第一个（最近的）自提点
  useEffect(() => {
    if (sortedPickupPoints.length > 0 && !selectedPointId) {
      setSelectedPointId(sortedPickupPoints[0].id);
    }
  }, [sortedPickupPoints, selectedPointId]);

  // 获取自提点距离
  const getPointDistance = useCallback((point: PickupPoint): string | null => {
    if (!userLocation || !point.latitude || !point.longitude) return null;
    const dist = calculateDistance(userLocation.lat, userLocation.lng, point.latitude, point.longitude);
    return formatDistance(dist);
  }, [userLocation]);

  const handleConfirm = async () => {
    if (!user || !lottery || !selectedPointId) {
      toast.error(t('error.unknownError'));
      return;
    }

    setIsSubmitting(true);
    try {
      const sessionToken = localStorage.getItem('custom_session_token');
      if (!sessionToken) {
        throw new Error(t('common.pleaseLogin'));
      }

      const idempotencyKey = `full_purchase_${lotteryId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const { data, error } = await supabase.functions.invoke('create-full-purchase-order', {
        body: {
          lottery_id: lotteryId,
          pickup_point_id: selectedPointId,
          user_id: user.id,
          session_token: sessionToken,
          idempotency_key: idempotencyKey,
          useCoupon: useCoupon && validCouponCount > 0,
        },
      });

      if (error) {
        console.error('Edge Function error:', error);
        const errorMessage = await extractEdgeFunctionError(error);
        throw new Error(errorMessage);
      }

      if (data?.success) {
        toast.success(t('lottery.fullPurchaseSuccess'));
        await refreshWallets();
        const orderId = data.data?.order_id;

        // ============================================================
        // 订单链路埋点（文档 10.1 事件清单要求）
        // 全款购买成功 = order_create + order_pay_success
        // ============================================================
        const inventoryProductId = lottery?.inventory_product_id;
        const orderTrackBase = {
          page_name: 'full_purchase_confirm',
          entity_type: 'order' as any,
          entity_id: orderId || lotteryId,
          lottery_id: lotteryId,
          inventory_product_id: inventoryProductId || undefined,
          order_id: orderId || undefined,
          ...sourceAttribution.current,
          metadata: {
            purchase_type: 'full_purchase',
            total_cost: fullPurchasePrice,
            pickup_point_id: selectedPointId,
            used_coupon: useCoupon && validCouponCount > 0,
          },
        };
        track({ ...orderTrackBase, event_name: 'order_create' as any });
        track({ ...orderTrackBase, event_name: 'order_pay_success' as any });

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
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{t('common.loading')}...</p>
        </div>
      </div>
    );
  }

  if (!lottery) {
    return <div className="text-center py-10 text-red-500">{t('lottery.notFound')}</div>;
  }

  const title = getLocalizedText(lottery.title_i18n, i18n.language) || lottery.title;
  const inventoryProduct = (lottery as any).inventory_product;
  const fullPurchasePrice = lottery.full_purchase_price 
    || (inventoryProduct?.original_price) 
    || lottery.original_price 
    || (lottery.ticket_price * lottery.total_tickets);
  const fullPurchaseStock = inventoryProduct ? inventoryProduct.stock : 999999;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
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

      <div className="space-y-3 p-4">
        {/* Product Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-sm p-4"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">{t('lottery.productInfo')}</h3>
          
          <div className="flex gap-3">
            {lottery.image_urls && lottery.image_urls.length > 0 && (
              <div className="relative w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100">
                <LazyImage
                  src={lottery.image_urls[0]}
                  alt={title}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                />
              </div>
            )}
            
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-sm leading-tight line-clamp-2">{title}</p>
              <p className="text-xs text-gray-500 mt-1.5">
                {t('lottery.fullPurchasePrice')}: <span className="font-bold text-red-500">
                  {formatCurrency(lottery.currency, fullPurchasePrice)}
                </span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('lottery.quantity')}: <span className="font-bold">1</span>
              </p>
            </div>
          </div>

          <div className="border-t border-gray-100 mt-3 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 font-medium">{t('lottery.totalAmount')}</span>
              <span className="text-xl font-bold text-red-500">
                {formatCurrency(lottery.currency, fullPurchasePrice)}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Pickup Point Selection - Redesigned */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-white rounded-2xl shadow-sm p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <MapPinIcon className="w-5 h-5 text-primary" />
              {t('orders.selectPickupPoint')}
            </h3>
            {userLocation && (
              <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                {t('orders.locationEnabled')}
              </span>
            )}
            {!userLocation && !locationLoading && (
              <span className="text-xs text-gray-400">
                {t('orders.locationDisabled')}
              </span>
            )}
          </div>

          {sortedPickupPoints.length > 0 ? (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {visiblePoints.map((point, index) => {
                  const distance = getPointDistance(point);
                  const isSelected = selectedPointId === point.id;
                  const photos = (point as any).photos as string[] | undefined;
                  const hasPhotos = photos && photos.length > 0;

                  return (
                    <motion.div
                      key={point.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <button
                        onClick={() => setSelectedPointId(point.id)}
                        className={cn(
                          "w-full text-left rounded-xl border-2 transition-all duration-200 overflow-hidden",
                          isSelected
                            ? "border-primary bg-amber-50/50 shadow-sm"
                            : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50"
                        )}
                      >
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className={cn(
                                  "font-semibold text-sm leading-tight",
                                  isSelected ? "text-primary" : "text-gray-900"
                                )}>
                                  {getLocalizedPickupPointName(point)}
                                </p>
                                {index === 0 && userLocation && distance && (
                                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                                    {t('orders.nearest')}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                                {getLocalizedPickupPointAddress(point)}
                              </p>
                              <div className="flex items-center gap-3 mt-1.5">
                                {point.contact_phone && (
                                  <p className="text-xs text-gray-400">
                                    {point.contact_phone}
                                  </p>
                                )}
                                {distance && (
                                  <span className="text-xs text-primary font-medium flex items-center gap-0.5">
                                    <MapPinIcon className="w-3 h-3" />
                                    {distance}
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isSelected && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                                >
                                  <CheckCircleIcon className="w-6 h-6 text-primary" />
                                </motion.div>
                              )}
                            </div>
                          </div>

                          {/* 自提点图片缩略图 */}
                          {hasPhotos && (
                            <div className="mt-2.5 pt-2 border-t border-gray-100/80">
                              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                                {photos!.slice(0, 4).map((photo, photoIndex) => (
                                  <div
                                    key={photoIndex}
                                    className="relative w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 cursor-pointer group"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewPhoto(photo);
                                    }}
                                  >
                                    <img
                                      src={photo}
                                      alt={`${getLocalizedPickupPointName(point)} ${photoIndex + 1}`}
                                      className="w-full h-full object-cover transition-transform group-hover:scale-110"
                                      loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                      <PhotoIcon className="w-4 h-4 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                                    </div>
                                  </div>
                                ))}
                                {photos!.length > 4 && (
                                  <div
                                    className="relative w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-200 cursor-pointer flex items-center justify-center"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewPhoto(photos![4]);
                                    }}
                                  >
                                    <span className="text-xs font-medium text-gray-600">+{photos!.length - 4}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* 展开/收起按钮 */}
              {sortedPickupPoints.length > DEFAULT_VISIBLE_COUNT && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setShowAllPoints(!showAllPoints)}
                  className="w-full py-2.5 text-center text-sm text-primary font-medium hover:bg-amber-50 rounded-xl transition-colors flex items-center justify-center gap-1"
                >
                  {showAllPoints ? (
                    <>
                      {t('common.collapse')}
                      <ChevronUpIcon className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      {t('orders.viewAllPoints') || `查看全部 ${sortedPickupPoints.length} 个自提点`}
                      <ChevronDownIcon className="w-4 h-4" />
                    </>
                  )}
                </motion.button>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <MapPinIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('orders.noPickupPoints')}</p>
            </div>
          )}
        </motion.div>

        {/* Order Summary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl shadow-sm p-4"
        >
          <h3 className="text-base font-bold text-gray-900 mb-3">{t('lottery.orderSummary')}</h3>
          
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{t('lottery.productPrice')}</span>
              <span className="text-gray-900 font-medium">
                {formatCurrency(lottery.currency, fullPurchasePrice)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('lottery.quantity')}</span>
              <span className="text-gray-900 font-medium">1</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('subsidyPool.shippingFee')}</span>
              <span className="text-gray-900 font-medium">{formatCurrency(lottery.currency, 15)}</span>
            </div>
            <div className="flex justify-between text-green-600">
              <span>{t('subsidyPool.platformSubsidy')}</span>
              <span className="font-medium">-{formatCurrency(lottery.currency, 15)}</span>
            </div>
            
            {/* 抵扣券开关 */}
            {validCouponCount > 0 && (
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">{t('coupon.switchLabel')}</span>
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
                  <div className="flex justify-between text-gray-500">
                    <span>{t('payment.pointsPayment')}</span>
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
                <div className="border-t border-gray-100 pt-2.5 mt-1 flex justify-between">
                  <span className="text-gray-900 font-semibold">{t('payment.actualPayment')}</span>
                  <span className="text-lg font-bold text-red-500">
                    {formatCurrency(lottery.currency, finalPayAmount)}
                  </span>
                </div>
              );
            })()}
            <p className="text-xs text-primary mt-1">{t('payment.pointsAsValue')}</p>
          </div>
        </motion.div>

        {/* 补贴提示 */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <p className="text-xs text-green-700 text-center">
            {t('subsidyPool.paymentSubsidy')}
          </p>
        </div>

        {/* Confirm Button */}
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleConfirm}
          disabled={isSubmitting || !selectedPointId}
          className={cn(
            "w-full py-3.5 rounded-xl font-semibold text-white shadow-md transition-all duration-200 sticky bottom-4",
            !isSubmitting && selectedPointId
              ? "bg-gradient-to-r from-primary to-primary-dark hover:shadow-lg active:shadow-sm"
              : "bg-gray-300 cursor-not-allowed"
          )}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t('common.submitting')}
            </span>
          ) : (
            t('lottery.confirmOrder')
          )}
        </motion.button>

        {/* Free Shipping Promo */}
        <p className="text-center text-xs text-gray-400 mt-2">
          {t('common.freeShippingPromo').split('0 TJS').map((part: string, i: number) => (
            <span key={i}>
              {i > 0 && <span className="font-bold text-red-500">0 TJS</span>}
              {part}
            </span>
          ))}
        </p>
      </div>

      {/* 图片预览模态框 */}
      <AnimatePresence>
        {previewPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setPreviewPhoto(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="relative max-w-full max-h-full"
            >
              <img
                src={previewPhoto}
                alt="Preview"
                className="max-w-full max-h-[85vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setPreviewPhoto(null)}
                className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg text-gray-600 hover:text-gray-900 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FullPurchaseConfirmPage;
