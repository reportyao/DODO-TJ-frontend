/**
 * B2B 订单列表页
 * Phase 4: 前端核心展示层
 *
 * 功能：
 * - 展示批发商的历史订单
 * - 按状态筛选（全部/待确认/已确认/已发货/已完成）
 * - 订单详情展开
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '../contexts/SupabaseContext';
import { useUser } from '../contexts/UserContext';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper';
import { cn } from '../lib/utils';

interface B2BOrder {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  delivery_address: string;
  delivery_note: string | null;
  payment_method: string;
  created_at: string;
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }>;
}

const STATUS_TABS = ['all', 'pending', 'confirmed', 'shipped', 'completed', 'cancelled'] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  shipped: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
};

export default function B2BOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { supabase } = useSupabase();
  const { user, sessionToken } = useUser();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const { data: orders, isLoading } = useQuery<B2BOrder[]>({
    queryKey: ['b2b', 'orders', user?.id, activeTab],
    queryFn: async () => {
      if (!user?.id || !sessionToken) return [];
      const params: Record<string, string> = {};
      if (activeTab !== 'all') params.status = activeTab;

      const queryString = new URLSearchParams(params).toString();
      const { data, error } = await supabase.functions.invoke(
        `b2b-orders${queryString ? `?${queryString}` : ''}`,
        {
          method: 'GET',
          headers: { 'x-session-token': sessionToken },
        }
      );
      if (error) throw new Error(await extractEdgeFunctionError(error));
      return data?.orders || [];
    },
    enabled: !!user?.id && !!sessionToken,
    staleTime: 1000 * 60 * 2,
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1">
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
            <p className="text-gray-500">暂无订单</p>
          </div>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              {/* Order Header */}
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
              >
                <div>
                  <div className="text-xs text-gray-500 font-mono">{order.order_number}</div>
                  <div className="text-sm font-bold text-gray-900 mt-0.5">
                    TJS {Number(order.total_amount).toFixed(2)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={cn(
                    'text-[10px] font-medium px-2 py-0.5 rounded-full',
                    STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'
                  )}>
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(order.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Order Details (expanded) */}
              {expandedOrder === order.id && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  {/* Items */}
                  <div className="space-y-1.5 mb-3">
                    {order.items?.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700 flex-1 truncate">{item.product_name}</span>
                        <span className="text-gray-500 mx-2">x{item.quantity}</span>
                        <span className="text-gray-900 font-medium">TJS {Number(item.subtotal).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Address */}
                  <div className="text-xs text-gray-500 border-t border-gray-200 pt-2">
                    <div>📍 {order.delivery_address}</div>
                    {order.delivery_note && <div className="mt-1">📝 {order.delivery_note}</div>}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
