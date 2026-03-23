import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ShoppingBagIcon,
  MapPinIcon,
  ClockIcon,
  CheckCircleIcon,
  DocumentDuplicateIcon,
  PhoneIcon,
  CalendarIcon,
  CurrencyDollarIcon,
  TicketIcon,
  TruckIcon,
  GiftIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
import { LazyImage } from '../components/LazyImage';
import { LogisticsStatus } from '../components/LogisticsStatus';
import { formatDateTime, formatCurrency, copyToClipboard } from '../lib/utils';
import toast from 'react-hot-toast';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

interface OrderDetail {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  currency: string;
  pickup_code: string | null;
  pickup_status?: string;
  logistics_status?: string | null;
  batch_id?: string | null;
  claimed_at: string | null;
  created_at: string;
  metadata: any;
  lottery_id: string;
  shipment_batch?: {
    china_tracking_no: string | null;
    tajikistan_tracking_no: string | null;
    estimated_arrival_date: string | null;
  } | null;
  lotteries: {
    title: string;
    title_i18n: any;
    image_url: string;
    image_urls?: string[];
    original_price: number;
  } | null;
  pickup_point: {
    name: string;
    name_i18n: any;
    address: string;
    address_i18n: any;
    contact_phone: string;
    is_active: boolean;
    photos?: string[];
  } | null;
  available_pickup_points?: Array<{
    id: string;
    name: string;
    name_i18n: any;
    address: string;
    address_i18n: any;
    contact_phone: string;
  }>;
}

const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const { t, i18n } = useTranslation();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPickupPointId, setSelectedPickupPointId] = useState<string>('');
  const [isUpdatingPickupPoint, setIsUpdatingPickupPoint] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    fetchOrderDetail();
  }, [user, id]);

  const fetchOrderDetail = async () => {
    try {
      setLoading(true);
      
      // 使用 Edge Function 获取订单详情，绕过 RLS 限制
      // 【R17修复】传入 session_token 代替直接传入 user_id
      const sessionToken = localStorage.getItem('custom_session_token');
      const { data, error } = await supabase.functions.invoke('get-order-detail', {
        body: {
          order_id: id,
          session_token: sessionToken,
        }
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (!data) throw new Error('Order not found');

      setOrder(data);
    } catch (error) {
      console.error('Error fetching order detail:', error);
      toast.error(t('orders.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const getLocalizedText = (text: any): string => {
    if (!text) return '';
    if (typeof text === 'string') return text;
    return text[i18n.language] || text.zh || text.ru || text.tg || '';
  };

  // 根据订单元数据获取订单类型标签
  const getOrderTypeLabel = (orderData: OrderDetail): string => {
    const metaType = orderData.metadata?.type;
    switch (metaType) {
      case 'prize':
      case 'lottery':
        return t('order.oneYuanShopping');
      case 'full_purchase':
        return t('order.fullPurchase');
      case 'group_buy':
        return t('order.normalGroupBuy');
      case 'auto_group_buy':
      case 'squad':
        return t('order.autoGroupBuy');
      default:
        return t('order.fullPurchase');
    }
  };

  const copyPickupCode = async () => {
    if (order?.pickup_code) {
      const success = await copyToClipboard(order.pickup_code);
      if (success) {
        toast.success(t('lottery.winningCodeCopied'));
      } else {
        toast.error(t('common.copyFailed'));
      }
    }
  };

  const copyOrderNumber = async () => {
    if (order?.order_number) {
      const success = await copyToClipboard(order.order_number);
      if (success) {
        toast.success(t('order.orderNumberCopied'));
      } else {
        toast.error(t('common.copyFailed'));
      }
    }
  };

  // 更新自提点
  const handleUpdatePickupPoint = async () => {
    if (!selectedPickupPointId || !order) {
      toast.error(t('orders.pleaseSelectPickupPoint'));
      return;
    }

    setIsUpdatingPickupPoint(true);
    try {
      // 使用 Edge Function 更新自提点，避免类型问题
      const { data, error } = await supabase.functions.invoke('update-pickup-point', {
        body: {
          order_id: order.id,
          order_type: order.metadata?.type || 'prize',
          pickup_point_id: selectedPickupPointId,
          user_id: user?.id,
          session_token: sessionToken,
        }
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (!data?.success) throw new Error(data?.error || 'Update failed');

      toast.success(t('orders.pickupPointUpdated'));
      
      // 重新加载订单详情
      await fetchOrderDetail();
    } catch (error: any) {
      console.error('Error updating pickup point:', error);
      toast.error(t('orders.updatePickupPointError'));
    } finally {
      setIsUpdatingPickupPoint(false);
    }
  };

  const getStatusInfo = (status: string) => {
    const statusMap: Record<string, { text: string; color: string; bgColor: string; icon: React.ReactNode }> = {
      'PENDING': { 
        text: t('orders.statusPending'), 
        color: 'text-yellow-700', 
        bgColor: 'bg-yellow-100',
        icon: <ClockIcon className="w-5 h-5" />
      },
      'COMPLETED': { 
        text: t('orders.statusCompleted'), 
        color: 'text-green-700', 
        bgColor: 'bg-green-100',
        icon: <CheckCircleSolidIcon className="w-5 h-5" />
      },
      'PENDING_PICKUP': { 
        text: t('orders.statusPendingPickup'), 
        color: 'text-primary-dark', 
        bgColor: 'bg-amber-100',
        icon: <TruckIcon className="w-5 h-5" />
      },
      'PENDING_CLAIM': { 
        text: t('orders.statusPendingClaim'), 
        color: 'text-orange-700', 
        bgColor: 'bg-orange-100',
        icon: <GiftIcon className="w-5 h-5" />
      },
      'PICKED_UP': { 
        text: t('orders.statusPickedUp'), 
        color: 'text-green-700', 
        bgColor: 'bg-green-100',
        icon: <CheckCircleSolidIcon className="w-5 h-5" />
      },
      'EXPIRED': { 
        text: t('orders.statusExpired'), 
        color: 'text-red-700', 
        bgColor: 'bg-red-100',
        icon: <ClockIcon className="w-5 h-5" />
      },
      // 物流状态
      'PENDING_SHIPMENT': { 
        text: t('logistics.pendingShipment'), 
        color: 'text-gray-700', 
        bgColor: 'bg-gray-100',
        icon: <ClockIcon className="w-5 h-5" />
      },
      'IN_TRANSIT_CHINA': { 
        text: t('logistics.inTransitChina'), 
        color: 'text-primary-dark', 
        bgColor: 'bg-amber-100',
        icon: <TruckIcon className="w-5 h-5" />
      },
      'IN_TRANSIT_TAJIKISTAN': { 
        text: t('logistics.inTransitTajikistan'), 
        color: 'text-primary-dark', 
        bgColor: 'bg-amber-100',
        icon: <TruckIcon className="w-5 h-5" />
      },
      'READY_FOR_PICKUP': { 
        text: t('logistics.readyForPickup'), 
        color: 'text-green-700', 
        bgColor: 'bg-green-100',
        icon: <MapPinIcon className="w-5 h-5" />
      },
    };

    return statusMap[status] || { 
      text: status, 
      color: 'text-gray-700', 
      bgColor: 'bg-gray-100',
      icon: <ShoppingBagIcon className="w-5 h-5" />
    };
  };

  // 计算有效期（创建后30天）
  const getExpiryDate = () => {
    if (!order?.created_at) return null;
    const createdDate = new Date(order.created_at);
    const expiryDate = new Date(createdDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    return expiryDate;
  };

  // 检查是否已过期
  const isExpired = () => {
    const expiryDate = getExpiryDate();
    if (!expiryDate) return false;
    return new Date() > expiryDate;
  };

  // 获取剩余天数
  const getRemainingDays = () => {
    const expiryDate = getExpiryDate();
    if (!expiryDate) return 0;
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 flex flex-col items-center justify-center px-4">
        <GiftIcon className="w-16 h-16 text-gray-400 mb-4" />
        <p className="text-gray-600 mb-4">{t('orders.noOrders')}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition"
        >
          {t('common.back')}
        </button>
      </div>
    );
  }

  // 优先显示物流状态，其次是提货状态
  const displayStatus = order.logistics_status || order.pickup_status || order.status;
  const statusInfo = getStatusInfo(displayStatus);
  const productTitle = getLocalizedText(order.lotteries?.title_i18n) || order.metadata?.product_title || t('order.unknownProduct');
  const productImage = order.lotteries?.image_url || order.metadata?.product_image;
  const remainingDays = getRemainingDays();

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 pb-20">
      {/* 头部 */}
      <div className="bg-gradient-to-r from-primary via-primary to-orange-500 text-white shadow-lg">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => navigate(-1)}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <ArrowLeftIcon className="w-6 h-6" />
              </button>
              <h1 className="text-xl font-bold">{t('order.orderDetails')}</h1>
            </div>
            <button
              onClick={fetchOrderDetail}
              disabled={loading}
              className="p-2 hover:bg-white/20 rounded-lg transition disabled:opacity-50"
              title={t('common.refresh')}
            >
              <ArrowPathIcon className={`w-6 h-6 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* 订单状态卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-5 shadow-sm ${statusInfo.bgColor}`}
        >
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-full bg-white/50 ${statusInfo.color}`}>
              {statusInfo.icon}
            </div>
            <div className="flex-1">
              <h2 className={`text-lg font-bold ${statusInfo.color}`}>{statusInfo.text}</h2>
              {/* 显示物流状态描述 */}
              {order.logistics_status && (
                <p className="text-sm text-gray-600 mt-1">
                  {order.logistics_status === 'PENDING_SHIPMENT' && (t('logistics.pendingShipmentDesc'))}
                  {order.logistics_status === 'IN_TRANSIT_CHINA' && (t('logistics.inTransitChinaDesc'))}
                  {order.logistics_status === 'IN_TRANSIT_TAJIKISTAN' && (t('logistics.inTransitTajikistanDesc'))}
                  {order.logistics_status === 'READY_FOR_PICKUP' && (t('logistics.readyForPickupDesc'))}
                  {order.logistics_status === 'PICKED_UP' && (t('logistics.pickedUpDesc'))}
                </p>
              )}
              {/* 显示剩余提货天数 */}
              {order.logistics_status === 'READY_FOR_PICKUP' && !isExpired() && remainingDays > 0 && (
                <p className="text-sm text-orange-600 mt-1 font-medium">
                  {t('order.remainingDays', { days: remainingDays })}
                </p>
              )}
              {/* 待提货/已提货 - 运费补贴文案 */}
              {(order.logistics_status === 'READY_FOR_PICKUP' || order.logistics_status === 'PICKED_UP') && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('common.freeShippingPromo').split('0 TJS').map((part: string, i: number) => (
                    <span key={i}>
                      {i > 0 && <span className="font-bold text-red-500">0 TJS</span>}
                      {part}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* 商品信息卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <div className="flex items-center space-x-2 mb-4">
            <ShoppingBagIcon className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold text-gray-900">{t('order.productInfo')}</h2>
          </div>
          
          {/* 商品标题（多语言支持） */}
          <h3 className="font-semibold text-gray-900 mb-3 text-lg">{productTitle}</h3>
          
          {/* 多图轮播 */}
          {order.lotteries?.image_urls && order.lotteries.image_urls.length > 0 ? (
            <div className="mb-4">
              <div className="grid grid-cols-3 gap-2">
                {order.lotteries.image_urls.slice(0, 3).map((url, index) => (
                  <div key={index} style={{ position: 'relative', width: '100%', paddingBottom: '75%', borderRadius: '0.5rem', overflow: 'hidden' }}>
                    <LazyImage
                      src={url}
                      alt={`${productTitle} - ${index + 1}`}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : productImage ? (
            <div className="mb-4">
              <div style={{ position: 'relative', width: '100%', paddingBottom: '50%', borderRadius: '0.5rem', overflow: 'hidden' }}>
                <LazyImage
                  src={productImage}
                  alt={productTitle}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                />
              </div>
            </div>
          ) : null}
          
          {/* 支付金额 */}
          <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
            <span className="text-sm text-gray-600">{t('order.paymentAmount')}</span>
            <div className="flex items-baseline gap-1">
              <span className="text-sm text-gray-500">{order.currency}</span>
              <span className="text-xl font-bold text-primary">
                {order.total_amount}
              </span>
            </div>
          </div>
        </motion.div>

        {/* 物流状态卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <LogisticsStatus
            status={order.logistics_status || 'PENDING_SHIPMENT'}
            chinaTrackingNo={order.shipment_batch?.china_tracking_no}
            tajikistanTrackingNo={order.shipment_batch?.tajikistan_tracking_no}
            estimatedArrivalDate={order.shipment_batch?.estimated_arrival_date}
            pickupCode={order.pickup_code}
          />
        </motion.div>

        {/* 提货码卡片 */}
        {order.pickup_code && order.logistics_status === 'READY_FOR_PICKUP' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-primary to-primary rounded-2xl p-5 shadow-lg text-white"
          >
            <div className="flex items-center space-x-2 mb-4">
              <TicketIcon className="w-5 h-5" />
              <h2 className="text-base font-bold">{t('orders.pickupCode')}</h2>
            </div>

            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-black tracking-[0.3em]">
                  {order.pickup_code}
                </span>
                <button
                  onClick={copyPickupCode}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                  title={t('common.copy')}
                >
                  <DocumentDuplicateIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-sm opacity-90">
              <ClockIcon className="w-4 h-4" />
              <span>
                {t('orders.validUntil')}: {formatDateTime(getExpiryDate()?.toISOString() || '')}
              </span>
            </div>
          </motion.div>
        )}

        {/* 自提点信息卡片 */}
        {order.pickup_point && order.pickup_point.is_active && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center space-x-2 mb-4">
              <MapPinIcon className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-gray-900">{t('orders.pickupPointInfo')}</h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <MapPinIcon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{t('orders.pickupPointName')}</p>
                  <p className="font-medium text-gray-900">
                    {getLocalizedText(order.pickup_point.name_i18n) || order.pickup_point.name}
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <TruckIcon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">{t('orders.pickupPointAddress')}</p>
                  <p className="font-medium text-gray-900">
                    {getLocalizedText(order.pickup_point.address_i18n) || order.pickup_point.address}
                  </p>
                </div>
              </div>

              {order.pickup_point.contact_phone && (
                <div className="flex items-start space-x-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <PhoneIcon className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{t('orders.pickupPointPhone')}</p>
                    <a 
                      href={`tel:${order.pickup_point.contact_phone}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {order.pickup_point.contact_phone}
                    </a>
                  </div>
                </div>
              )}

              {/* 自提点照片 */}
              {order.pickup_point.photos && order.pickup_point.photos.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-sm text-gray-500 mb-2">{t('orders.pickupPointPhotos')}</p>
                  <div className="flex space-x-2">
                    {order.pickup_point.photos.map((photo, index) => (
                      <div
                        key={index}
                        className="w-20 h-20 rounded-lg overflow-hidden cursor-pointer border border-gray-200 hover:border-primary transition-colors"
                        onClick={() => setPreviewPhoto(photo)}
                      >
                        <img
                          src={photo}
                          alt={`${t('orders.pickupPointInfo')} ${index + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* 自提点选择器 - 当原自提点被禁用或未设置时显示 */}
        {(!order.pickup_point || !order.pickup_point.is_active) && order.available_pickup_points && order.available_pickup_points.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-5 shadow-sm border-2 border-amber-200"
          >
            <div className="flex items-center space-x-2 mb-4">
              <MapPinIcon className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-gray-900">{t('orders.selectPickupPoint')}</h2>
            </div>


            <div className="space-y-3">
              <select
                value={selectedPickupPointId}
                onChange={(e) => setSelectedPickupPointId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">{t('orders.pleaseSelect')}</option>
                {order.available_pickup_points.map((point) => (
                  <option key={point.id} value={point.id}>
                    {getLocalizedText(point.name_i18n) || point.name} - {getLocalizedText(point.address_i18n) || point.address}
                  </option>
                ))}
              </select>

              <button
                onClick={handleUpdatePickupPoint}
                disabled={!selectedPickupPointId || isUpdatingPickupPoint}
                className="w-full py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark focus:ring-4 focus:ring-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isUpdatingPickupPoint ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    {t('orders.updating')}
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-5 h-5 mr-2" />
                    {t('orders.confirmSelection')}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* 订单信息卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <div className="flex items-center space-x-2 mb-4">
            <CalendarIcon className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold text-gray-900">{t('order.orderInfo')}</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-500">{t('order.orderNumber')}</span>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-gray-900 text-sm">{order.order_number}</span>
                <button
                  onClick={copyOrderNumber}
                  className="p-1 hover:bg-gray-100 rounded transition"
                  title={t('common.copy')}
                >
                  <DocumentDuplicateIcon className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-500">{t('order.orderType')}</span>
              <span className="font-medium text-gray-900 text-sm">{getOrderTypeLabel(order)}</span>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-500">{t('order.orderTime')}</span>
              <span className="font-medium text-gray-900 text-sm">{formatDateTime(order.created_at)}</span>
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-500">{t('order.paymentAmount')}</span>
              <span className="font-bold text-primary">{formatCurrency(order.currency, order.total_amount)}</span>
            </div>
          </div>
        </motion.div>

        {/* 温馨提示 */}
        {order.pickup_status === 'PENDING_PICKUP' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4"
          >
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <GiftIcon className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <h3 className="font-medium text-amber-800 mb-1">{t('order.pickupTips')}</h3>
                <p className="text-sm text-amber-700">
                  {t('order.pickupTipsContent')}
                </p>
              </div>
            </div>
          </motion.div>
        )}
       </div>

      {/* 图片预览模态框 */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div className="relative max-w-full max-h-full">
            <img
              src={previewPhoto}
              alt="Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setPreviewPhoto(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg text-gray-600 hover:text-gray-900"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default OrderDetailPage;
