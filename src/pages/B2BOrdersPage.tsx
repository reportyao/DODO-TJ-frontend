/**
 * B2B 订单列表页
 * 
 * 功能：
 * - 展示批发商的历史订单
 * - 按状态筛选：全部 / 处理中 / 配送中 / 已送达 / 已取消
 * - 点击展开订单详情（懒加载明细）
 * - 处理中的订单支持取消
 * - 完整 i18n 支持
 *
 * 状态流转：
 *   下单 → 处理中(processing/pending) → 配送中(delivering) → 已送达(delivered)
 *                    ↓
 *               已取消(cancelled)  ← 用户主动取消（仅处理中可取消）
 *
 * 路由: /b2b/orders
 * 依赖: b2b-orders Edge Function (POST action=list/detail/cancel)
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
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
}

interface B2BOrderDetail extends B2BOrder {
  delivery_note: string | null;
  payment_method: string;
  admin_note: string | null;
  confirmed_at: string | null;
  items: Array<{
    id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    snapshot_data: {
      name?: string;
      name_i18n?: { zh?: string; ru?: string; tg?: string };
      image_url?: string;
      unit_measure?: string;
    } | null;
  }>;
}

// ============================================================
// 状态配置 — 简化为4个有效状态
// 数据库中 pending 和 processing 在前端统一显示为"处理中"
// ============================================================
const STATUS_TABS = ['all', 'processing', 'delivering', 'delivered', 'cancelled'] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-primary/10 text-primary-dark',
  processing: 'bg-primary/10 text-primary-dark',
  delivering: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

/**
 * 获取订单项的本地化商品名称
 */
function getItemName(
  snapshotData: { name?: string; name_i18n?: { zh?: string; ru?: string; tg?: string } } | null,
  lang: string,
  productId: string
): string {
  if (!snapshotData) return `${productId.slice(0, 8)}`;
  if (snapshotData.name_i18n) {
    const i18n = snapshotData.name_i18n;
    return i18n[lang as keyof typeof i18n] || i18n.ru || i18n.zh || i18n.tg || snapshotData.name || productId.slice(0, 8);
  }
  return snapshotData.name || productId.slice(0, 8);
}

/**
 * 将数据库状态映射为前端显示状态
 * pending 和 processing 统一显示为 processing
 */
function normalizeStatus(dbStatus: string): string {
  if (dbStatus === 'pending') return 'processing';
  if (dbStatus === 'paid') return 'delivered'; // paid 也视为已完成
  return dbStatus;
}

// ============================================================
// 主组件
// ============================================================
export default function B2BOrdersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const queryClient = useQueryClient();
  const lang = i18n.language || 'ru';
  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<Record<string, B2BOrderDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<string | null>(null);

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

      // 客户端筛选状态（pending 和 processing 统一归类为 processing）
      if (activeTab === 'all') return allOrders;
      return allOrders.filter((o) => {
        const normalized = normalizeStatus(o.status);
        return normalized === activeTab;
      });
    },
    enabled: !!user?.id && !!sessionToken,
    staleTime: 1000 * 60 * 2,
  });

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

  // 取消订单（仅处理中状态可取消）
  // 直接通过 Supabase 数据库操作，同时回补库存
  const handleCancelOrder = async (order: B2BOrder) => {
    const normalized = normalizeStatus(order.status);
    if (normalized !== 'processing') {
      toast.error(t('b2b.cannotCancelOrder', '只能取消处理中的订单'));
      return;
    }

    setCancellingOrder(order.id);
    try {
      // 使用类型断言绕过表名类型检查（b2b表未在前端类型定义中生成）
      const db = supabase as any;

      // 1. 获取订单明细以回补库存
      const { data: items, error: itemsError } = await db
        .from('b2b_order_items')
        .select('product_id, quantity')
        .eq('order_id', order.id);

      if (itemsError) throw new Error(itemsError.message);

      // 2. 回补库存
      if (items && items.length > 0) {
        for (const item of items as Array<{ product_id: string; quantity: number }>) {
          const { data: product } = await db
            .from('inventory_products')
            .select('id, stock')
            .eq('id', item.product_id)
            .single();

          if (product) {
            await db
              .from('inventory_products')
              .update({
                stock: Number(product.stock || 0) + Number(item.quantity || 0),
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.product_id);
          }
        }
      }

      // 3. 更新订单状态为已取消
      const { error: updateError } = await db
        .from('b2b_orders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
        .eq('user_id', user?.id); // 安全：只能取消自己的订单

      if (updateError) throw new Error(updateError.message);

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
      </div>

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
            const displayStatus = normalizeStatus(order.status);
            const canCancel = displayStatus === 'processing';

            return (
              <div key={order.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
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
                        STATUS_COLORS[displayStatus] || 'bg-gray-100 text-gray-600'
                      )}>
                        {STATUS_LABELS[displayStatus] || displayStatus}
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
                                {getItemName(item.snapshot_data, lang, item.product_id)}
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
                          {orderDetails[order.id].admin_note && (
                            <div className="flex items-start gap-1">
                              <span className="flex-shrink-0">💬</span>
                              <span className="text-primary-dark">{orderDetails[order.id].admin_note}</span>
                            </div>
                          )}
                        </div>

                        {/* Cancel Button - 仅处理中状态可取消 */}
                        {canCancel && (
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
