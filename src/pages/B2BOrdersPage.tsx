/**
 * B2B 订单列表页
 * Phase 5: 前端交易链路
 *
 * 功能：
 * - 展示批发商的历史订单
 * - 按状态筛选（全部/待确认/配送中/已送达/已付款）
 * - 点击展开订单详情（懒加载明细）
 * - 状态映射与 Edge Function 对齐
 *
 * 路由: /b2b/orders
 * 依赖: b2b-orders Edge Function (POST action=list/detail)
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { cn } from '../lib/utils';

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
      image_url?: string;
      unit_measure?: string;
    } | null;
  }>;
}

// ============================================================
// 状态配置（与 b2b-orders Edge Function 对齐）
// ============================================================
const STATUS_TABS = ['all', 'pending', 'processing', 'delivering', 'delivered', 'paid', 'cancelled'] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  delivering: 'bg-purple-100 text-purple-700',
  delivered: 'bg-indigo-100 text-indigo-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  processing: '处理中',
  delivering: '配送中',
  delivered: '已送达',
  paid: '已付款',
  cancelled: '已取消',
};

// ============================================================
// 主组件
// ============================================================
export default function B2BOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<Record<string, B2BOrderDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  // 获取订单列表（使用 POST + action 模式）
  const { data: orders, isLoading } = useQuery<B2BOrder[]>({
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
        headers: { Authorization: `Bearer ${sessionToken}` },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      const allOrders: B2BOrder[] = data?.orders || [];

      // 客户端筛选状态
      if (activeTab === 'all') return allOrders;
      return allOrders.filter((o) => o.status === activeTab);
    },
    enabled: !!user?.id && !!sessionToken,
    staleTime: 1000 * 60 * 2,
  });

  // 获取订单详情（懒加载）
  const fetchOrderDetail = async (orderId: string) => {
    if (orderDetails[orderId]) return; // 已缓存
    if (!sessionToken) return;

    setLoadingDetail(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('b2b-orders', {
        method: 'POST',
        body: {
          action: 'detail',
          order_id: orderId,
        },
        headers: { Authorization: `Bearer ${sessionToken}` },
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
        <h1 className="text-base font-semibold text-gray-900">{t('b2b.myOrders')}</h1>
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
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {tab === 'all' ? '全部' : STATUS_LABELS[tab] || tab}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <div className="px-4 pt-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !orders || orders.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-500 text-sm">暂无订单</p>
            <button
              onClick={() => navigate('/b2b')}
              className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
            >
              去进货
            </button>
          </div>
        ) : (
          orders.map((order) => (
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
                      STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'
                    )}>
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm font-bold text-gray-900">
                      TJS {Number(order.total_amount).toFixed(2)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {order.item_count}种 · {order.total_quantity}件
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {new Date(order.created_at).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {order.estimated_delivery_date && (
                      <span className="ml-2 text-blue-500">
                        预计送达: {order.estimated_delivery_date}
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
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : orderDetails[order.id] ? (
                    <>
                      {/* Items */}
                      <div className="space-y-2 mb-3">
                        {orderDetails[order.id].items?.map((item) => (
                          <div key={item.id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-700 flex-1 truncate">
                              {item.snapshot_data?.name || `商品 ${item.product_id.slice(0, 8)}`}
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
                          <span>{orderDetails[order.id].delivery_address || '未填写地址'}</span>
                        </div>
                        {orderDetails[order.id].delivery_note && (
                          <div className="flex items-start gap-1">
                            <span className="flex-shrink-0">📝</span>
                            <span>{orderDetails[order.id].delivery_note}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <span className="flex-shrink-0">💰</span>
                          <span>
                            {orderDetails[order.id].payment_method === 'cod' ? '货到付款' : orderDetails[order.id].payment_method}
                            {' · '}
                            {orderDetails[order.id].payment_status === 'paid' ? (
                              <span className="text-green-600 font-medium">已付款</span>
                            ) : (
                              <span className="text-orange-500 font-medium">待付款</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-400 text-center py-3">
                      暂无详情
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
