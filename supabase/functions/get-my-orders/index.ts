import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// 通用的 session 验证函数
async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    throw new Error('未授权：缺少认证令牌');
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('服务器配置错误');
  }

  // 查询 user_sessions 表验证 session
  const sessionResponse = await fetch(
    `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${sessionToken}&is_active=eq.true&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!sessionResponse.ok) {
    throw new Error('验证会话失败');
  }

  const sessions = await sessionResponse.json();
  
  if (sessions.length === 0) {
    throw new Error('未授权：会话不存在或已失效');
  }

  const session = sessions[0];

  // 检查 session 是否过期
  const expiresAt = new Date(session.expires_at);
  const now = new Date();
  
  if (expiresAt < now) {
    throw new Error('未授权：会话已过期');
  }

  // 单独查询用户数据
  const userResponse = await fetch(
    `${supabaseUrl}/rest/v1/users?id=eq.${session.user_id}&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!userResponse.ok) {
    throw new Error('查询用户信息失败');
  }

  const users = await userResponse.json();
  
  if (users.length === 0) {
    throw new Error('未授权：用户不存在');
  }

  return {
    userId: session.user_id,
    telegramId: users[0].telegram_id,
    user: users[0],
    session: session
  };
}

/**
 * 获取用户的所有订单记录（拼团、积分商城、抽奖中奖）
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { session_token, order_type, page = 1, page_size = 20 } = body

    console.log('[GetMyOrders] Received request:', { 
      session_token: session_token ? 'present' : 'missing',
      order_type,
      page,
      page_size
    });

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    // 验证用户 session
    const { userId, telegramId } = await validateSession(session_token);
    
    console.log('[GetMyOrders] User validated:', { userId, telegramId });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const orders: any[] = [];
    const offset = (page - 1) * page_size;

    // 1. 获取拼团订单
    if (!order_type || order_type === 'all' || order_type === 'group_buy') {
      console.log('[GetMyOrders] Fetching group buy orders for telegramId:', telegramId, 'and userId:', userId);
      
      // 同时使用 telegramId 和 userId 查询，因为 group_buy_orders 中的 user_id 可能是两者之一
      const { data: groupBuyOrders, error: groupBuyError } = await supabase
        .from('group_buy_orders')
        .select(`
          id,
          user_id,
          session_id,
          product_id,
          amount,
          status,
          order_number,
          order_timestamp,
          refund_lucky_coins,
          created_at
        `)
        .or(`user_id.eq.${telegramId},user_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (groupBuyError) {
        console.error('[GetMyOrders] Group buy orders error:', groupBuyError);
      } else if (groupBuyOrders && groupBuyOrders.length > 0) {
        console.log('[GetMyOrders] Found group buy orders:', groupBuyOrders.length);
        
        // 获取所有相关的 session_ids 和 product_ids
        const sessionIds = [...new Set(groupBuyOrders.map(o => o.session_id))];
        const productIds = [...new Set(groupBuyOrders.map(o => o.product_id))];
        
        // 批量查询 sessions
        const { data: sessions } = await supabase
          .from('group_buy_sessions')
          .select('id, session_code, status, current_participants, group_size, expires_at')
          .in('id', sessionIds);
        
        // 批量查询 products
        const { data: products } = await supabase
          .from('group_buy_products')
          .select('id, title, image_url, original_price, price_per_person')
          .in('id', productIds);
        
        // 批量查询中奖结果（同时使用 telegramId 和 userId 匹配 winner_id）
        const { data: groupBuyResults } = await supabase
          .from('group_buy_results')
          .select(`
            id, session_id, winner_id, pickup_code, pickup_status, 
            pickup_point_id, expires_at, claimed_at, picked_up_at
          `)
          .or(`winner_id.eq.${telegramId},winner_id.eq.${userId}`);
        
        // 如果有中奖结果，批量查询自提点
        let pickupPoints: any[] = [];
        if (groupBuyResults && groupBuyResults.length > 0) {
          const pickupPointIds = [...new Set(groupBuyResults.filter(r => r.pickup_point_id).map(r => r.pickup_point_id))];
          if (pickupPointIds.length > 0) {
            const { data: points } = await supabase
              .from('pickup_points')
              .select('id, name, name_i18n, address, address_i18n, contact_phone')
              .in('id', pickupPointIds);
            pickupPoints = points || [];
          }
        }
        
        // 创建映射
        const sessionsMap = new Map((sessions || []).map(s => [s.id, s]));
        const productsMap = new Map((products || []).map(p => [p.id, p]));
        const resultsMap = new Map((groupBuyResults || []).map(r => [r.session_id, r]));
        const pickupPointsMap = new Map(pickupPoints.map(p => [p.id, p]));
        
        groupBuyOrders.forEach((order: any) => {
          const session = sessionsMap.get(order.session_id);
          const product = productsMap.get(order.product_id);
          const result = resultsMap.get(order.session_id);
          const pickupPoint = result?.pickup_point_id ? pickupPointsMap.get(result.pickup_point_id) : null;
          
          orders.push({
            id: order.id,
            order_type: 'group_buy',
            order_number: order.order_number,
            amount: order.amount,
            status: order.status,
            refund_lucky_coins: order.refund_lucky_coins,
            created_at: order.created_at,
            product_id: order.product_id,
            product_title: product?.title || {},
            product_image: product?.image_url || '',
            original_price: product?.original_price || 0,
            price_per_person: product?.price_per_person || 0,
            session_status: session?.status || '',
            session_code: session?.session_code || '',
            current_participants: session?.current_participants || 0,
            group_size: session?.group_size || 3,
            expires_at: result?.expires_at || session?.expires_at || null,
            session_id: order.session_id,
            pickup_code: result?.pickup_code || null,
            pickup_status: order.status === 'WON' ? (result?.pickup_status || 'PENDING_CLAIM') : null,
            pickup_point: pickupPoint || null,
            claimed_at: result?.claimed_at || null,
            picked_up_at: result?.picked_up_at || null,
            result_id: result?.id || null,
          });
        });
      }
    }

    // 2. 获取抽奖中奖记录(积分商城) - 不使用关联查询
    // 3. 获取全款购买订单
    if (!order_type || order_type === 'all' || order_type === 'lottery') {
      console.log('[GetMyOrders] Fetching full purchase orders for userId:', userId);
      
      const { data: fullPurchaseOrders, error: fullPurchaseError } = await supabase
        .from('full_purchase_orders')
        .select(`
          id,
          user_id,
          lottery_id,
          order_number,
          total_amount,
          currency,
          status,
          pickup_point_id,
          pickup_code,
          claimed_at,
          metadata,
          created_at
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (fullPurchaseError) {
        console.error('[GetMyOrders] Full purchase orders error:', fullPurchaseError);
      } else if (fullPurchaseOrders && fullPurchaseOrders.length > 0) {
        console.log('[GetMyOrders] Found full purchase orders:', fullPurchaseOrders.length);
        
        // 获取所有相关的 lottery_ids 和 pickup_point_ids
        const lotteryIds = [...new Set(fullPurchaseOrders.map(o => o.lottery_id).filter(Boolean))];
        const pickupPointIds = [...new Set(fullPurchaseOrders.map(o => o.pickup_point_id).filter(Boolean))];
        
        // 批量查询 lotteries
        let lotteriesMap = new Map();
        if (lotteryIds.length > 0) {
          const { data: lotteries } = await supabase
            .from('lotteries')
            .select('id, title, title_i18n, image_url, original_price')
            .in('id', lotteryIds);
          lotteriesMap = new Map((lotteries || []).map(l => [l.id, l]));
        }
        
        // 批量查询 pickup_points
        let pickupPointsMap = new Map();
        if (pickupPointIds.length > 0) {
          const { data: pickupPoints } = await supabase
            .from('pickup_points')
            .select('id, name, name_i18n, address, address_i18n, contact_phone')
            .in('id', pickupPointIds);
          pickupPointsMap = new Map((pickupPoints || []).map(p => [p.id, p]));
        }
        
        fullPurchaseOrders.forEach((order: any) => {
          const lottery = lotteriesMap.get(order.lottery_id);
          const pickupPoint = order.pickup_point_id ? pickupPointsMap.get(order.pickup_point_id) : null;
          
          orders.push({
            id: order.id,
            order_type: 'full_purchase',
            order_number: order.order_number,
            amount: order.total_amount,
            status: order.status,
            created_at: order.created_at,
            // 商品信息
            product_title: order.metadata?.product_title_i18n || lottery?.title_i18n || { zh: order.metadata?.product_title || '全款购买' },
            product_image: order.metadata?.product_image || lottery?.image_url || '',
            original_price: order.total_amount,
            price_per_person: order.total_amount,
            // 全款购买信息
            lottery_id: order.lottery_id,
            // 自提信息
            pickup_code: order.pickup_code || null,
            pickup_status: order.pickup_code ? (order.claimed_at ? 'PICKED_UP' : 'PENDING_PICKUP') : null,
            pickup_point: pickupPoint || null,
            claimed_at: order.claimed_at || null,
          });
        });
      }
    }

    // 4. 获取一元购物订单和积分商城订单
    if (!order_type || order_type === 'all' || order_type === 'lottery' || order_type === 'exchange') {
      console.log('[GetMyOrders] Fetching one-yuan purchase orders for userId:', userId);
      
      // 查询 orders 表中的订单（包括积分商城购物记录）
      const { data: oneYuanOrders, error: oneYuanError } = await supabase
        .from('orders')
        .select('id, user_id, lottery_id, order_number, total_amount, currency, status, type, quantity, payment_method, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (oneYuanError) {
        console.error('[GetMyOrders] One-yuan orders error:', oneYuanError);
      } else if (oneYuanOrders && oneYuanOrders.length > 0) {
        console.log('[GetMyOrders] Found one-yuan orders:', oneYuanOrders.length);
        
        const lotteryIds = [...new Set(oneYuanOrders.map(o => o.lottery_id).filter(Boolean))];
        
        let lotteriesMap = new Map();
        if (lotteryIds.length > 0) {
          const { data: lotteries } = await supabase
            .from('lotteries')
            .select('id, title, title_i18n, image_url, ticket_price, status, winning_user_id')
            .in('id', lotteryIds);
          lotteriesMap = new Map((lotteries || []).map(l => [l.id, l]));
        }
        
        oneYuanOrders.forEach((order: any) => {
          const lottery = lotteriesMap.get(order.lottery_id);
          const orderType = order.type || 'LOTTERY_PURCHASE';
          
          /**
           * 订单类型说明：
           * - LOTTERY_PURCHASE: 积分商城购物（使用积分购买商品）
           * - MARKET_PURCHASE: 市场购买（二手转卖）
           * 
           * 支付方式：
           * - LUCKY_COIN_WALLET: 积分支付
           * - BALANCE_WALLET: 余额支付
           */
          let displayType = 'lottery';  // 积分商城订单统一显示为 lottery 类型
          let displayTitle = lottery?.title_i18n || { zh: lottery?.title || '积分商城购物' };
          
          // 根据支付方式确定显示名称
          const isPointsPurchase = order.payment_method === 'LUCKY_COIN_WALLET';
          if (isPointsPurchase) {
            displayTitle = lottery?.title_i18n || { zh: lottery?.title || '积分商城购物' };
          }
          
          if (orderType === 'MARKET_PURCHASE') {
            displayType = 'exchange';
            displayTitle = lottery?.title_i18n || { zh: lottery?.title || '市场购买' };
          }
          
          // 确定订单状态：基于lottery的状态和用户是否中奖
          let orderStatus = order.status || 'COMPLETED';
          if (lottery && displayType === 'lottery') {
            if (lottery.status === 'ACTIVE') {
              orderStatus = 'PENDING';  // 待开奖
            } else if (lottery.status === 'COMPLETED') {
              // 检查用户是否中奖
              if (lottery.winning_user_id === userId) {
                orderStatus = 'WON';  // 中奖
              } else {
                orderStatus = 'LOST';  // 未中奖
              }
            }
          }
          
          orders.push({
            id: order.id,
            order_type: displayType,
            order_number: order.order_number,
            amount: order.total_amount,
            status: orderStatus,
            created_at: order.created_at,
            product_title: displayTitle,
            product_image: lottery?.image_url || '',
            original_price: lottery?.ticket_price || order.total_amount,
            price_per_person: order.total_amount,
            lottery_id: order.lottery_id,
            // 额外信息
            quantity: order.quantity || 1,
            payment_method: order.payment_method,
          });
        });
      }
    }

    if (!order_type || order_type === 'all' || order_type === 'lottery') {
      console.log('[GetMyOrders] Fetching lottery prizes for userId:', userId);
      
      // 先查询 prizes 表（不使用关联查询）
      const { data: prizes, error: prizesError } = await supabase
        .from('prizes')
        .select(`
          id,
          lottery_id,
          user_id,
          winning_code,
          prize_value,
          prize_name,
          prize_image,
          status,
          won_at,
          created_at,
          pickup_code,
          pickup_status,
          pickup_point_id,
          expires_at,
          claimed_at,
          picked_up_at
        `)
        .eq('user_id', userId)
        .order('won_at', { ascending: false });

      if (prizesError) {
        console.error('[GetMyOrders] Prizes error:', prizesError);
      } else if (prizes && prizes.length > 0) {
        console.log('[GetMyOrders] Found prizes:', prizes.length);
        
        // 获取所有相关的 lottery_ids 和 pickup_point_ids
        const lotteryIds = [...new Set(prizes.map(p => p.lottery_id).filter(Boolean))];
        const pickupPointIds = [...new Set(prizes.map(p => p.pickup_point_id).filter(Boolean))];
        
        // 批量查询 lotteries
        let lotteriesMap = new Map();
        if (lotteryIds.length > 0) {
          const { data: lotteries } = await supabase
            .from('lotteries')
            .select('id, title, title_i18n, image_url, period, ticket_price')
            .in('id', lotteryIds);
          lotteriesMap = new Map((lotteries || []).map(l => [l.id, l]));
        }
        
        // 批量查询 pickup_points
        let pickupPointsMap = new Map();
        if (pickupPointIds.length > 0) {
          const { data: pickupPoints } = await supabase
            .from('pickup_points')
            .select('id, name, name_i18n, address, address_i18n, contact_phone')
            .in('id', pickupPointIds);
          pickupPointsMap = new Map((pickupPoints || []).map(p => [p.id, p]));
        }
        
        prizes.forEach((prize: any) => {
          const lottery = lotteriesMap.get(prize.lottery_id);
          const pickupPoint = prize.pickup_point_id ? pickupPointsMap.get(prize.pickup_point_id) : null;
          
          // 确定状态
          let displayStatus = prize.status || 'PENDING';

          // 计算显示金额：优先使用 ticket_price，否则使用 prize_value
          const displayAmount = lottery?.ticket_price || prize.prize_value || 0;
          
          orders.push({
            id: prize.id,
            order_type: 'lottery',
            order_number: prize.winning_code,
            amount: displayAmount,
            status: displayStatus,
            created_at: prize.won_at || prize.created_at,
            // 商品信息 - 优先使用 lottery 数据，否则使用 prize 自身数据
            product_title: lottery?.title_i18n || { zh: lottery?.title || prize.prize_name || '奖品' },
            product_image: lottery?.image_url || prize.prize_image || '',
            original_price: lottery?.ticket_price || prize.prize_value || 0,
            price_per_person: lottery?.ticket_price || 0,
            // 抽奖信息
            lottery_period: lottery?.period || '',
            lottery_id: prize.lottery_id,
            // 自提信息
            pickup_code: prize.pickup_code || null,
            pickup_status: prize.pickup_status || 'PENDING_CLAIM',
            pickup_point: pickupPoint || null,
            expires_at: prize.expires_at || null,
            claimed_at: prize.claimed_at || null,
            picked_up_at: prize.picked_up_at || null,
          });
        });
      }
    }

    // 按时间排序
    orders.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA;
    });

    // 分页
    const totalCount = orders.length;
    const paginatedOrders = orders.slice(offset, offset + page_size);

    console.log('[GetMyOrders] Success, total orders:', totalCount, 'returning:', paginatedOrders.length);

    return new Response(
      JSON.stringify({
        success: true,
        data: paginatedOrders,
        pagination: {
          page,
          page_size,
          total: totalCount,
          total_pages: Math.ceil(totalCount / page_size),
        },
        summary: {
          group_buy_count: orders.filter(o => o.order_type === 'group_buy').length,
          lottery_count: orders.filter(o => o.order_type === 'lottery').length,
          exchange_count: orders.filter(o => o.order_type === 'exchange').length,
          full_purchase_count: orders.filter(o => o.order_type === 'full_purchase').length,
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[GetMyOrders] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
