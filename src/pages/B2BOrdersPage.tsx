/**
 * B2B 订单列表页
 * 
 * 功能：
 * - 展示批发商的历史订单
 * - 按状态筛选：全部 / 处理中 / 配送中 / 已送达 / 已取消
 * - 点击展开订单详情（懒加载明细）
 * - 可取消状态的订单支持取消
 * - 完整 i18n 支持
 *
 * 状态流转（基于后端 fulfillment_status 双轨状态机）：
 *   下单 → pending → confirmed → picking → ready_to_ship → shipping → delivered
 *                                    ↓
 *                              cancelled（用户/管理员取消）
 *
 * 前端展示使用 Edge Function 返回的 display_status（中文映射）和 fulfillment_status（原始值）
 *
 * 路由: /b2b/orders
 * 依赖: b2b-orders Edge Function (POST action=list/detail/cancel)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, CheckCircleIcon, ChevronDownIcon, ChevronUpIcon, XCircleIcon, BellAlertIcon } from '@heroicons/react/24/outline';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { useB2BOrderRealtime, B2BOrderUpdate, B2BNotification } from '../hooks/useB2BOrderRealtime';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';

// ============================================================
// 类型定义
// ============================================================
interface B2BOrder {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total_amount: number;
  item_count: number;
  total_quantity: number;
  delivery_address: string;
  estimated_delivery_date: string | null;
  created_at: string;
  updated_at: string;
  // P0-7 新增安全字段（由 Edge Function toSafeOrder 返回）
  display_status: string;
  fulfillment_status: string;
  display_financial_status: string;
  financial_status: string;
  receivable_total?: number;
  paid_total?: number;
  balance_due?: number;
}

interface B2BOrderDetail extends B2BOrder {
  delivery_note: string | null;
  payment_method: string;
  items: Array<{
    id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    // P0-7 新增结构化字段
    product_name_zh?: string;
    product_name_original?: string;
    sku?: string;
    image_url?: string;
    unit_measure?: string;
    display_item_status?: string;
    // 兼容旧字段
    snapshot_data: {
      name?: string;
      name_i18n?: { zh?: string; ru?: string; tg?: string };
      image_url?: string;
      unit_measure?: string;
    } | null;
  }>;
  payments?: Array<{
    id: string;
    amount: number;
    display_payment_method?: string;
    display_status?: string;
    created_at: string;
  }>;
}

// ============================================================
// 状态配置
// 使用 fulfillment_status 进行筛选，display_status 进行展示
// ============================================================
const STATUS_TABS = ['all', 'processing', 'delivering', 'delivered', 'cancelled'] as const;

/**
 * 将 fulfillment_status 映射为前端 Tab 分类
 * 后端有 pending/confirmed/picking/shortage/ready_to_ship/shipping/delivered/cancelled 等精细状态
 * 前端 Tab 归类为 4 个大类：processing / delivering / delivered / cancelled
 */
function mapFulfillmentToTab(fulfillmentStatus: string): string {
  switch (fulfillmentStatus) {
    case 'pending':
    case 'confirmed':
    case 'picking':
    case 'shortage':
    case 'ready_to_ship':
      return 'processing';
    case 'shipping':
      return 'delivering';
    case 'delivered':
    case 'closed':
      return 'delivered';
    case 'cancelled':
    case 'returned':
      return 'cancelled';
    default:
      return 'processing';
  }
}

/**
 * 判断订单是否允许用户取消
 * 基于后端 fulfillment_status，与 b2b_cancel_order_tx RPC 的校验逻辑一致
 */
function canUserCancel(fulfillmentStatus: string): boolean {
  return ['pending', 'confirmed'].includes(fulfillmentStatus);
}

const STATUS_COLORS: Record<string, string> = {
  processing: 'bg-primary/10 text-primary-dark',
  delivering: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

/**
 * 获取订单项的本地化商品名称
 * 优先使用结构化字段，仅在缺失时降级到 snapshot_data
 */
function getItemName(
  item: { product_name_zh?: string; product_name_original?: string; snapshot_data?: { name?: string; name_i18n?: { zh?: string; ru?: string; tg?: string } } | null },
  lang: string,
  productId: string
): string {
  // 优先使用结构化字段
  if (lang === 'zh' && item.product_name_zh) return item.product_name_zh;
  if (item.product_name_original) return item.product_name_original;
  if (item.product_name_zh) return item.product_name_zh;

  // 降级到旧 snapshot_data
  const snapshotData = item.snapshot_data;
  if (!snapshotData) return productId.slice(0, 8);

  if (snapshotData.name_i18n) {
    const i18n = snapshotData.name_i18n;
    return i18n[lang as keyof typeof i18n] || i18n.ru || i18n.zh || i18n.tg || snapshotData.name || productId.slice(0, 8);
  }

  return snapshotData.name || productId.slice(0, 8);
}

// ============================================================
// 主组件
// ============================================================
export default function B2BOrdersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const queryClient = useQueryClient();
  const lang = i18n.language || 'ru';
  const checkoutState = location.state as {
    checkoutSuccess?: boolean;
    order?: Partial<B2BOrder>;
  } | null;
  const createdOrderId = searchParams.get('created') || checkoutState?.order?.id || null;
  const [showCheckoutSuccess, setShowCheckoutSuccess] = useState(Boolean(checkoutState?.checkoutSuccess || createdOrderId));
  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(createdOrderId);
  const [orderDetails, setOrderDetails] = useState<Record<string, B2BOrderDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<string | null>(null);

  // ============================================================
  // 实时订阅：订单状态变更自动刷新 + 通知推送
  // ============================================================
  const handleOrderUpdate = useCallback((order: B2BOrderUpdate) => {
    // 订单状态变更时自动刷新列表
    queryClient.invalidateQueries({ queryKey: ['b2b', 'orders'] });
    // 如果当前展开的订单被更新，也刷新详情
    if (expandedOrder === order.id) {
      setOrderDetails((prev) => {
        const updated = { ...prev };
        delete updated[order.id]; // 清除缓存，下次展开时重新加载
        return updated;
      });
    }
  }, [queryClient, expandedOrder]);

  const handleNotification = useCallback((notification: B2BNotification) => {
    // 根据当前语言选择通知文案
    const title = notification.title_i18n?.[lang] || notification.title || '';
    const message = notification.message_i18n?.[lang] || notification.content || '';

    // 根据通知类型选择 toast 样式
    const type = notification.type;
    if (type === 'B2B_ORDER_CANCELLED') {
      toast.error(`${title}\n${message}`, { duration: 5000, icon: '❌' });
    } else if (type === 'B2B_ORDER_DELIVERED') {
      toast.success(`${title}\n${message}`, { duration: 5000, icon: '✅' });
    } else if (type === 'B2B_ORDER_SHIPPING') {
      toast.success(`${title}\n${message}`, { duration: 5000, icon: '🚚' });
    } else if (type === 'B2B_PAYMENT_CONFIRMED') {
      toast.success(`${title}\n${message}`, { duration: 5000, icon: '💰' });
    } else {
      toast(`${title}\n${message}`, { duration: 4000, icon: '📦' });
    }
  }, [lang]);

  const { isSubscribed } = useB2BOrderRealtime({
    userId: user?.id || null,
    enabled: !!user?.id,
    onOrderUpdate: handleOrderUpdate,
    onNotification: handleNotification,
  });

  // i18n 状态标签映射
  const STATUS_LABELS: Record<string, string> = {
    all: t('b2b.orderStatusAll', '全部'),
    processing: t('b2b.orderStatusProcessing', '处理中'),
    delivering: t('b2b.orderStatusDelivering', '配送中'),
    delivered: t('b2b.orderStatusDelivered', '已送达'),
    cancelled: t('b2b.orderStatusCancelled', '已取消'),
  };

  // 获取订单列表
  const { data: orders, isLoading, refetch } = useQuery<B2BOrder[]>({
    queryKey: ['b2b', 'orders', user?.id, activeTab],
    queryFn: async () => {
      if (!user?.id || !sessionToken) return [];

      const { data, error } = await supabase.functions.invoke('b2b-orders', {
        method: 'POST',
        body: {
          action: 'list',
          page: 1,
          page_size: 50,
        },
        headers: { 'x-session-token': sessionToken },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      const allOrders: B2BOrder[] = data?.orders || [];

      // 基于 fulfillment_status 进行 Tab 筛选
      if (activeTab === 'all') return allOrders;
      return allOrders.filter((o) => {
        const tabCategory = mapFulfillmentToTab(o.fulfillment_status || o.status);
        return tabCategory === activeTab;
      });
    },
    enabled: !!user?.id && !!sessionToken,
    staleTime: 1000 * 60 * 2,
  });


  const createdOrder = useMemo(() => {
    if (!createdOrderId) return null;
    return orders?.find((order) => order.id === createdOrderId) || checkoutState?.order || null;
  }, [checkoutState?.order, createdOrderId, orders]);

  useEffect(() => {
    if (!createdOrderId || !orders?.length) return;
    const exists = orders.some((order) => order.id === createdOrderId);
    if (exists) {
      setExpandedOrder(createdOrderId);
    }
  }, [createdOrderId, orders]);

  // 获取订单详情（懒加载）
  const fetchOrderDetail = async (orderId: string) => {
    if (orderDetails[orderId]) return;
    if (!sessionToken) return;

    setLoadingDetail(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('b2b-orders', {
        method: 'POST',
        body: {
          action: 'detail',
          order_id: orderId,
        },
        headers: { 'x-session-token': sessionToken },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (data?.order) {
        setOrderDetails((prev) => ({ ...prev, [orderId]: data.order }));
      }
    } catch (err: any) {
      console.error('获取订单详情失败:', err);
    } finally {
      setLoadingDetail(null);
    }
  };

  // 取消订单
  // 基于 fulfillment_status 判断是否可取消，与后端 b2b_cancel_order_tx 校验一致
  const handleCancelOrder = async (order: B2BOrder) => {
    if (!canUserCancel(order.fulfillment_status || order.status)) {
      toast.error(t('b2b.cannotCancelOrder', '只能取消处理中的订单'));
      return;
    }

    setCancellingOrder(order.id);
    try {
      const { data, error } = await supabase.functions.invoke('b2b-orders', {
        method: 'POST',
        body: {
          action: 'cancel',
          order_id: order.id,
        },
        headers: { 'x-session-token': sessionToken },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (!data?.success) throw new Error(data?.error || t('b2b.cancelFailed', '取消失败'));

      toast.success(t('b2b.orderCancelled', '订单已取消'));
      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['b2b', 'orders'] });
      refetch();
    } catch (err: any) {
      toast.error(err.message || t('b2b.cancelFailed', '取消失败'));
    } finally {
      setCancellingOrder(null);
    }
  };

  // 展开/收起订单
  const toggleOrder = (orderId: string) => {
    if (expandedOrder === orderId) {
      setExpandedOrder(null);
    } else {
      setExpandedOrder(orderId);
      fetchOrderDetail(orderId);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1 -ml-1">
          <ArrowLeftIcon className="w-5 h-5 text-gray-700" />
        </button>
        <h1 className="text-base font-semibold text-gray-900">{t('b2b.myOrders', '我的订单')}</h1>
        {/* 实时连接状态指示器 */}
        {isSubscribed && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t('b2b.realtime', '实时')}
          </span>
        )}
      </div>

      {/* 下单成功回流提示 */}
      {showCheckoutSuccess && (
        <div className="px-4 pt-3">
          <div className="rounded-2xl border border-green-100 bg-green-50 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
                <CheckCircleIcon className="h-5 w-5 text-green-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">
                      {t('b2b.orderSuccess', '下单成功！')}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-gray-600">
                      {t('b2b.orderSubmittedWaiting', '订单已提交，等待配送')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCheckoutSuccess(false);
                      if (searchParams.has('created')) {
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.delete('created');
                        setSearchParams(nextParams, { replace: true });
                      }
                    }}
                    className="-mr-1 -mt-1 rounded-full px-2 py-1 text-xs font-medium text-green-700 active:bg-green-100"
                  >
                    {t('b2b.done', '完成')}
                  </button>
                </div>

                {createdOrder && (
                  <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs text-gray-600">
                    <div className="flex justify-between gap-3">
                      <span>{t('b2b.orderNumber', '订单号')}</span>
                      <span className="truncate font-mono text-gray-900">{createdOrder.order_number}</span>
                    </div>
                    <div className="mt-1.5 flex justify-between gap-3">
                      <span>{t('b2b.orderAmount', '订单金额')}</span>
                      <span className="font-semibold text-primary">TJS {Number(createdOrder.total_amount || 0).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/b2b')}
                    className="flex-1 rounded-xl border border-green-200 bg-white py-2 text-xs font-semibold text-green-700 active:bg-green-50"
                  >
                    {t('b2b.continueShopping', '继续进货')}
                  </button>
                  {createdOrderId && (
                    <button
                      type="button"
                      onClick={() => setExpandedOrder(createdOrderId)}
                      className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-white active:bg-primary-dark"
                    >
                      {t('b2b.viewOrder', '查看订单')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status Tabs */}
      <div className="bg-white border-b border-gray-100 px-2 py-2 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
                activeTab === tab
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {STATUS_LABELS[tab] || tab}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <div className="px-4 pt-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !orders || orders.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-500 text-sm">{t('b2b.noOrders', '暂无订单')}</p>
            <button
              onClick={() => navigate('/b2b')}
              className="mt-4 px-6 py-2 bg-primary text-white rounded-lg text-sm font-medium"
            >
              {t('b2b.goShopping', '去进货')}
            </button>
          </div>
        ) : (
          orders.map((order) => {
            // 使用 Edge Function 返回的 display_status 展示，fulfillment_status 判断逻辑
            const tabCategory = mapFulfillmentToTab(order.fulfillment_status || order.status);
            const orderCanCancel = canUserCancel(order.fulfillment_status || order.status);

            return (
              <div
                key={order.id}
                className={cn(
                  'bg-white rounded-xl shadow-sm overflow-hidden transition-all',
                  createdOrderId === order.id && 'ring-2 ring-primary/40 shadow-md'
                )}
              >
                {/* Order Header */}
                <div
                  className="px-4 py-3 flex items-center justify-between cursor-pointer active:bg-gray-50 transition-colors"
                  onClick={() => toggleOrder(order.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 font-mono">{order.order_number}</span>
                      <span className={cn(
                        'text-[10px] font-medium px-2 py-0.5 rounded-full',
                        STATUS_COLORS[tabCategory] || 'bg-gray-100 text-gray-600'
                      )}>
                        {order.display_status || STATUS_LABELS[tabCategory] || tabCategory}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-bold text-gray-900">
                        TJS {Number(order.total_amount).toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {order.item_count}{t('b2b.orderItemTypes', '种')} · {order.total_quantity}{t('b2b.orderItemPieces', '件')}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(order.created_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'ru-RU', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {order.estimated_delivery_date && (
                        <span className="ml-2 text-primary">
                          {t('b2b.estimatedDelivery', '预计送达')}: {order.estimated_delivery_date}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="ml-2 flex-shrink-0">
                    {expandedOrder === order.id ? (
                      <ChevronUpIcon className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDownIcon className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Order Details (expanded) */}
                {expandedOrder === order.id && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    {loadingDetail === order.id ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : orderDetails[order.id] ? (
                      <>
                        {/* Items */}
                        <div className="space-y-2 mb-3">
                          {orderDetails[order.id].items?.map((item) => (
                            <div key={item.id} className="flex items-center justify-between text-xs">
                              <span className="text-gray-700 flex-1 truncate">
                                {getItemName(item, lang, item.product_id)}
                              </span>
                              <span className="text-gray-500 mx-2 flex-shrink-0">
                                x{item.quantity}
                              </span>
                              <span className="text-gray-900 font-medium flex-shrink-0">
                                TJS {Number(item.subtotal).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                        {/* Address & Notes */}
                        <div className="text-xs text-gray-500 border-t border-gray-200 pt-2 space-y-1">
                          <div className="flex items-start gap-1">
                            <span className="flex-shrink-0">📍</span>
                            <span>{orderDetails[order.id].delivery_address || t('b2b.noAddress', '未填写地址')}</span>
                          </div>
                          {orderDetails[order.id].delivery_note && (
                            <div className="flex items-start gap-1">
                              <span className="flex-shrink-0">📝</span>
                              <span>{orderDetails[order.id].delivery_note}</span>
                            </div>
                          )}
                          {/* 付款信息 */}
                          {orderDetails[order.id].display_financial_status && (
                            <div className="flex items-start gap-1">
                              <span className="flex-shrink-0">💰</span>
                              <span className="text-primary-dark">{orderDetails[order.id].display_financial_status}</span>
                              {orderDetails[order.id].balance_due != null && orderDetails[order.id].balance_due! > 0 && (
                                <span className="text-red-500 ml-1">
                                  ({t('b2b.balanceDue', '待付')}: TJS {Number(orderDetails[order.id].balance_due).toFixed(2)})
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Cancel Button - 基于 fulfillment_status 判断 */}
                        {orderCanCancel && (
                          <div className="border-t border-gray-200 pt-3 mt-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelOrder(order);
                              }}
                              disabled={cancellingOrder === order.id}
                              className={cn(
                                'w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all',
                                cancellingOrder === order.id
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                  : 'bg-red-50 text-red-600 active:bg-red-100'
                              )}
                            >
                              {cancellingOrder === order.id ? (
                                <span className="w-3.5 h-3.5 border-2 border-red-300 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <XCircleIcon className="w-3.5 h-3.5" />
                              )}
                              {cancellingOrder === order.id
                                ? t('b2b.cancelling', '取消中...')
                                : t('b2b.cancelOrder', '取消订单')}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-gray-400 text-center py-3">
                        {t('b2b.noDetail', '暂无详情')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
