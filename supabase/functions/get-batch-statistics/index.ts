/**
 * 获取批次统计数据 Edge Function
 * 
 * 功能：获取批次管理的统计数据
 * 权限：仅管理员可调用
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

interface BatchStatistics {
  // 批次统计
  total_batches: number
  in_transit_china_batches: number
  in_transit_tj_batches: number
  arrived_batches: number
  cancelled_batches: number
  
  // 订单统计
  total_orders: number
  pending_shipment_orders: number
  in_transit_orders: number
  ready_for_pickup_orders: number
  picked_up_orders: number
  
  // 到货统计
  normal_orders: number
  missing_orders: number
  damaged_orders: number
  
  // 时效统计
  avg_transit_days: number | null
  on_time_rate: number | null
  
  // 提货统计
  pickup_rate: number | null
  avg_pickup_days: number | null
  
  // 近期趋势
  recent_batches: Array<{
    date: string
    count: number
  }>
  
  // SKU统计
  top_skus: Array<{
    sku: string
    name: string
    count: number
  }>
}

serve(async (req) => {
  // 处理CORS预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const url = new URL(req.url)
    const days = parseInt(url.searchParams.get('days') || '30') // 统计天数

    const statistics: BatchStatistics = {
      total_batches: 0,
      in_transit_china_batches: 0,
      in_transit_tj_batches: 0,
      arrived_batches: 0,
      cancelled_batches: 0,
      total_orders: 0,
      pending_shipment_orders: 0,
      in_transit_orders: 0,
      ready_for_pickup_orders: 0,
      picked_up_orders: 0,
      normal_orders: 0,
      missing_orders: 0,
      damaged_orders: 0,
      avg_transit_days: null,
      on_time_rate: null,
      pickup_rate: null,
      avg_pickup_days: null,
      recent_batches: [],
      top_skus: [],
    }

    // 1. 批次统计
    const { data: batchStats, error: batchError } = await supabase
      .from('shipment_batches')
      .select('status', { count: 'exact' })

    if (!batchError && batchStats) {
      statistics.total_batches = batchStats.length
      statistics.in_transit_china_batches = batchStats.filter(b => b.status === 'IN_TRANSIT_CHINA').length
      statistics.in_transit_tj_batches = batchStats.filter(b => b.status === 'IN_TRANSIT_TAJIKISTAN').length
      statistics.arrived_batches = batchStats.filter(b => b.status === 'ARRIVED').length
      statistics.cancelled_batches = batchStats.filter(b => b.status === 'CANCELLED').length
    }

    // 2. 订单统计（批次订单项）
    const { data: orderItems, error: orderError } = await supabase
      .from('batch_order_items')
      .select('arrival_status')

    if (!orderError && orderItems) {
      statistics.total_orders = orderItems.length
      statistics.normal_orders = orderItems.filter(o => o.arrival_status === 'NORMAL').length
      statistics.missing_orders = orderItems.filter(o => o.arrival_status === 'MISSING').length
      statistics.damaged_orders = orderItems.filter(o => o.arrival_status === 'DAMAGED').length
    }

    // 3. 待发货订单统计
    const [fpPending, prizePending, gbPending] = await Promise.all([
      supabase
        .from('full_purchase_orders')
        .select('id', { count: 'exact', head: true })
        .or('logistics_status.is.null,logistics_status.eq.PENDING_SHIPMENT')
        .is('batch_id', null),
      supabase
        .from('prizes')
        .select('id', { count: 'exact', head: true })
        .or('logistics_status.is.null,logistics_status.eq.PENDING_SHIPMENT')
        .is('batch_id', null)
        .eq('status', 'CLAIMED'),
      supabase
        .from('group_buy_results')
        .select('id', { count: 'exact', head: true })
        .or('logistics_status.is.null,logistics_status.eq.PENDING_SHIPMENT')
        .is('batch_id', null),
    ])

    statistics.pending_shipment_orders = 
      (fpPending.count || 0) + (prizePending.count || 0) + (gbPending.count || 0)

    // 4. 运输中订单统计
    const [fpTransit, prizeTransit, gbTransit] = await Promise.all([
      supabase
        .from('full_purchase_orders')
        .select('id', { count: 'exact', head: true })
        .in('logistics_status', ['IN_TRANSIT_CHINA', 'IN_TRANSIT_TAJIKISTAN']),
      supabase
        .from('prizes')
        .select('id', { count: 'exact', head: true })
        .in('logistics_status', ['IN_TRANSIT_CHINA', 'IN_TRANSIT_TAJIKISTAN']),
      supabase
        .from('group_buy_results')
        .select('id', { count: 'exact', head: true })
        .in('logistics_status', ['IN_TRANSIT_CHINA', 'IN_TRANSIT_TAJIKISTAN']),
    ])

    statistics.in_transit_orders = 
      (fpTransit.count || 0) + (prizeTransit.count || 0) + (gbTransit.count || 0)

    // 5. 待提货订单统计
    const [fpPickup, prizePickup, gbPickup] = await Promise.all([
      supabase
        .from('full_purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('logistics_status', 'READY_FOR_PICKUP'),
      supabase
        .from('prizes')
        .select('id', { count: 'exact', head: true })
        .eq('logistics_status', 'READY_FOR_PICKUP'),
      supabase
        .from('group_buy_results')
        .select('id', { count: 'exact', head: true })
        .eq('logistics_status', 'READY_FOR_PICKUP'),
    ])

    statistics.ready_for_pickup_orders = 
      (fpPickup.count || 0) + (prizePickup.count || 0) + (gbPickup.count || 0)

    // 6. 已提货订单统计
    const [fpPickedUp, prizePickedUp, gbPickedUp] = await Promise.all([
      supabase
        .from('full_purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('logistics_status', 'PICKED_UP'),
      supabase
        .from('prizes')
        .select('id', { count: 'exact', head: true })
        .eq('logistics_status', 'PICKED_UP'),
      supabase
        .from('group_buy_results')
        .select('id', { count: 'exact', head: true })
        .eq('logistics_status', 'PICKED_UP'),
    ])

    statistics.picked_up_orders = 
      (fpPickedUp.count || 0) + (prizePickedUp.count || 0) + (gbPickedUp.count || 0)

    // 7. 时效统计（平均运输天数）
    const { data: arrivedBatches, error: arrivedError } = await supabase
      .from('shipment_batches')
      .select('shipped_at, arrived_at, estimated_arrival_date')
      .eq('status', 'ARRIVED')
      .not('arrived_at', 'is', null)

    if (!arrivedError && arrivedBatches && arrivedBatches.length > 0) {
      let totalDays = 0
      let onTimeCount = 0
      
      for (const batch of arrivedBatches) {
        if (batch.shipped_at && batch.arrived_at) {
          const shippedDate = new Date(batch.shipped_at)
          const arrivedDate = new Date(batch.arrived_at)
          const days = (arrivedDate.getTime() - shippedDate.getTime()) / (1000 * 60 * 60 * 24)
          totalDays += days
          
          // 检查是否准时到达
          if (batch.estimated_arrival_date) {
            const estimatedDate = new Date(batch.estimated_arrival_date)
            if (arrivedDate <= estimatedDate) {
              onTimeCount++
            }
          }
        }
      }
      
      statistics.avg_transit_days = Math.round((totalDays / arrivedBatches.length) * 10) / 10
      statistics.on_time_rate = Math.round((onTimeCount / arrivedBatches.length) * 100)
    }

    // 8. 提货率统计
    const totalReadyAndPickedUp = statistics.ready_for_pickup_orders + statistics.picked_up_orders
    if (totalReadyAndPickedUp > 0) {
      statistics.pickup_rate = Math.round((statistics.picked_up_orders / totalReadyAndPickedUp) * 100)
    }

    // 9. 近期批次趋势（按天统计）
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    const { data: recentBatches, error: recentError } = await supabase
      .from('shipment_batches')
      .select('created_at')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true })

    if (!recentError && recentBatches) {
      const dailyCounts: Record<string, number> = {}
      
      for (const batch of recentBatches) {
        const date = batch.created_at.split('T')[0]
        dailyCounts[date] = (dailyCounts[date] || 0) + 1
      }
      
      statistics.recent_batches = Object.entries(dailyCounts).map(([date, count]) => ({
        date,
        count,
      }))
    }

    // 10. 热门SKU统计
    const { data: skuStats, error: skuError } = await supabase
      .from('batch_order_items')
      .select('product_sku, product_name')
      .not('product_sku', 'is', null)

    if (!skuError && skuStats) {
      const skuCounts: Record<string, { name: string; count: number }> = {}
      
      for (const item of skuStats) {
        if (item.product_sku) {
          if (!skuCounts[item.product_sku]) {
            skuCounts[item.product_sku] = { name: item.product_name || '', count: 0 }
          }
          skuCounts[item.product_sku].count++
        }
      }
      
      statistics.top_skus = Object.entries(skuCounts)
        .map(([sku, data]) => ({ sku, name: data.name, count: data.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: statistics,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ success: false, error: '服务器内部错误' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
