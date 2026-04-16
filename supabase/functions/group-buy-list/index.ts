import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// 使用环境变量获取Supabase配置
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Helper function to create response with CORS headers
function createResponse(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Helper function to map database fields to frontend expected fields
function mapProductToFrontend(product: any) {
  if (!product) {return null;}
  
  return {
    id: product.id,
    title: product.name_i18n || { zh: product.name || '', ru: '', tg: '' },
    description: product.description_i18n || { zh: product.description || '', ru: '', tg: '' },
    image_url: product.image_url,
    images: product.image_urls || (product.image_url ? [product.image_url] : []),
    original_price: product.original_price,
    price_per_person: product.group_price,
    group_size: product.max_participants || product.min_participants,
    timeout_hours: product.duration_hours,
    product_type: product.status || 'ACTIVE',
    price_comparisons: product.price_comparisons || [],
    currency: product.currency || 'TJS',
    stock: product.stock,
    status: product.status,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

// 辅助函数：将user_id（可能是telegram_id或UUID）转换为UUID
async function resolveUserIdToUUID(supabase: any, userId: string): Promise<string | null> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(userId)) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
    return user?.id || null;
  } else {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', userId)
      .single();
    return user?.id || null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { type, product_id, session_id, user_id } = await req.json();

    if (type === 'product') {
      // 获取单个商品信息
      if (!product_id) {
        return createResponse({ success: false, error: 'Product ID required' }, 400);
      }

      const { data: product, error } = await supabase
        .from('group_buy_products')
        .select('*')
        .eq('id', product_id)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (error) {
        return createResponse({ success: false, error: error.message }, 500);
      }

      if (!product) {
        return createResponse({ success: false, error: 'Product not found or inactive' }, 404);
      }

      return createResponse({ success: true, data: mapProductToFrontend(product) });
    } else if (type === 'products') {
      // 获取所有活跃的拼团商品（使用RPC函数合并N+1查询为单次SQL）
      const { data: rpcResult, error } = await supabase
        .rpc('get_active_products_with_sessions');

      if (error) {
        console.error('RPC get_active_products_with_sessions error:', error);
        return createResponse({ success: false, error: error.message }, 500);
      }

      // RPC返回的是原始数据库字段，需要通过 mapProductToFrontend 映射为前端格式
      const products = Array.isArray(rpcResult) ? rpcResult : [];
      const productsWithSessions = products.map((product: any) => ({
        ...mapProductToFrontend(product),
        active_sessions: product.active_sessions || [],
        active_sessions_count: Array.isArray(product.active_sessions) ? product.active_sessions.length : 0,
      }));

      return createResponse({ success: true, data: productsWithSessions });
    } else if (type === 'sessions') {
      // 获取指定商品的所有活跃拼团会话
      if (!product_id) {
        return createResponse({ success: false, error: 'Product ID required' }, 400);
      }

      const { data: sessions, error } = await supabase
        .from('group_buy_sessions')
        .select(`
          *,
          product:group_buy_products(*),
          orders:group_buy_orders(id, user_id, created_at)
        `)
        .eq('product_id', product_id)
        .eq('status', 'ACTIVE')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        return createResponse({ success: false, error: error.message }, 500);
      }

      // 获取所有参与者的用户信息
      const allUserIds = new Set<string>();
      sessions?.forEach((session: any) => {
        session.orders?.forEach((order: any) => {
          if (order.user_id) {allUserIds.add(order.user_id);}
        });
      });

      // 查询用户信息（同时支持 id 和 telegram_id 匹配）
      const usersMap: Record<string, any> = {};
      if (allUserIds.size > 0) {
        const userIdArray = Array.from(allUserIds);
        
        const { data: usersByUuid } = await supabase
          .from('users')
          .select('id, telegram_id, telegram_username, first_name, last_name, avatar_url')
          .in('id', userIdArray);
        
        const { data: usersByTelegramId } = await supabase
          .from('users')
          .select('id, telegram_id, telegram_username, first_name, last_name, avatar_url')
          .in('telegram_id', userIdArray);
        
        usersByUuid?.forEach((u: any) => {
          usersMap[u.id] = u;
        });
        usersByTelegramId?.forEach((u: any) => {
          usersMap[u.telegram_id] = u;
        });
      }

      // 将用户信息添加到订单中
      const sessionsWithUsers = sessions?.map((session: any) => ({
        ...session,
        orders: session.orders?.map((order: any) => ({
          ...order,
          users: usersMap[order.user_id] || null,
        })),
      }));

      return createResponse({ success: true, data: sessionsWithUsers });
    } else if (type === 'session-detail') {
      // 【新增】获取会话详情（包括超时会话）
      if (!session_id) {
        return createResponse({ success: false, error: 'Session ID required' }, 400);
      }

      const { data: session, error: sessionError } = await supabase
        .from('group_buy_sessions')
        .select(`
          *,
          product:group_buy_products(*)
        `)
        .eq('id', session_id)
        .single();

      if (sessionError || !session) {
        return createResponse({ success: false, error: 'Session not found' }, 404);
      }

      // 获取该会话的所有订单
      const { data: orders } = await supabase
        .from('group_buy_orders')
        .select('*')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

      // 获取用户信息
      const userIds = orders?.map(o => o.user_id) || [];
      const usersMap: Record<string, any> = {};
      
      if (userIds.length > 0) {
        const { data: usersByUuid } = await supabase
          .from('users')
          .select('id, telegram_id, telegram_username, first_name, last_name, avatar_url')
          .in('id', userIds);
        
        const { data: usersByTelegramId } = await supabase
          .from('users')
          .select('id, telegram_id, telegram_username, first_name, last_name, avatar_url')
          .in('telegram_id', userIds);
        
        usersByUuid?.forEach((u: any) => {
          usersMap[u.id] = u;
        });
        usersByTelegramId?.forEach((u: any) => {
          usersMap[u.telegram_id] = u;
        });
      }

      // 合并用户信息到订单
      const ordersWithUsers = orders?.map(order => ({
        ...order,
        user: usersMap[order.user_id] || null,
      })) || [];

      return createResponse({ 
        success: true, 
        data: {
          ...session,
          product: session.product ? mapProductToFrontend(session.product) : null,
          orders: ordersWithUsers,
        }
      });
    } else if (type === 'session-result') {
      // 获取拼团会话的开奖结果
      if (!session_id) {
        return createResponse({ success: false, error: 'Session ID required' }, 400);
      }

      // 首先获取会话信息
      const { data: session, error: sessionError } = await supabase
        .from('group_buy_sessions')
        .select(`
          *,
          product:group_buy_products(*)
        `)
        .eq('id', session_id)
        .single();

      if (sessionError || !session) {
        return createResponse({ success: false, error: 'Session not found' }, 404);
      }

      // 【关键修复】检查会话状态，处理不同情况
      if (session.status === 'TIMEOUT' || session.status === 'CANCELLED' || session.status === 'EXPIRED') {
        // 超时未开奖的会话
        // 获取该会话的所有订单
        const { data: orders } = await supabase
          .from('group_buy_orders')
          .select('*')
          .eq('session_id', session_id)
          .order('created_at', { ascending: true });

        return createResponse({ 
          success: true, 
          data: {
            session_id: session.id,
            status: session.status, // 使用实际的会话状态
            session: session,
            product: session.product ? mapProductToFrontend(session.product) : null,
            orders: orders || [],
            message: `Session ${session.status.toLowerCase()}: refund processed`,
          }
        });
      }

      if (session.status === 'ACTIVE') {
        // 会话仍在进行中
        return createResponse({ 
          success: true, 
          data: {
            session_id: session.id,
            status: 'ACTIVE',
            session: session,
            product: session.product ? mapProductToFrontend(session.product) : null,
            message: 'Session is still active',
          }
        });
      }

      // 已开奖的会话，查询结果
      const { data: result, error: resultError } = await supabase
        .from('group_buy_results')
        .select(`
          *,
          pickup_point:pickup_points(
            id,
            name,
            name_i18n,
            address,
            address_i18n,
            contact_phone
          )
        `)
        .eq('session_id', session_id)
        .maybeSingle();

      if (resultError) {
        return createResponse({ success: false, error: resultError.message }, 500);
      }

      // 获取所有参与者订单
      const { data: orders, error: ordersError } = await supabase
        .from('group_buy_orders')
        .select('*')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

      if (ordersError) {
        return createResponse({ success: false, error: ordersError.message }, 500);
      }

      // 获取参与者的用户信息（同时支持UUID和telegram_id）
      const userIds = orders?.map(o => o.user_id) || [];
      const usersMap: Record<string, any> = {};
      
      if (userIds.length > 0) {
        const { data: usersByUuid } = await supabase
          .from('users')
          .select('id, telegram_id, telegram_username, first_name, last_name, avatar_url')
          .in('id', userIds);
        
        const { data: usersByTelegramId } = await supabase
          .from('users')
          .select('id, telegram_id, telegram_username, first_name, last_name, avatar_url')
          .in('telegram_id', userIds);
        
        usersByUuid?.forEach((u: any) => {
          usersMap[u.id] = u;
        });
        usersByTelegramId?.forEach((u: any) => {
          usersMap[u.telegram_id] = u;
        });
      }

      // 合并用户信息到订单
      // 找到真实用户（非bot_squad）的用户名，用于替换机器人显示名
      let realUsername = '';
      orders?.forEach(order => {
        const u = usersMap[order.user_id];
        const uname = u?.telegram_username || u?.first_name || '';
        if (uname && !uname.startsWith('bot_squad') && !uname.startsWith('Bot_squad') && !realUsername) {
          realUsername = uname;
        }
      });

      const participants = orders?.map(order => {
        const user = usersMap[order.user_id];
        let displayName = user?.telegram_username || user?.first_name || `User ${order.user_id.slice(-4)}`;
        
        // 如果是机器人用户，直接显示真实用户的用户名
        if (displayName.startsWith('bot_squad') || displayName.startsWith('Bot_squad')) {
          displayName = realUsername || 'User';
        }
        
        return {
          user_id: order.user_id,
          username: displayName,
          avatar_url: user?.avatar_url,
          order_number: order.order_number,
          order_timestamp: order.order_timestamp,
          status: order.status,
          created_at: order.created_at,
        };
      }) || [];

      // 获取中奖者用户名
      let winnerUsername = 'Unknown';
      const winnerId = result?.winner_id || session.winner_id;
      if (winnerId) {
        const winnerUser = usersMap[winnerId];
        if (winnerUser) {
          winnerUsername = winnerUser.telegram_username || winnerUser.first_name || `User ${winnerId.slice(-4)}`;
        }
      }

      return createResponse({ 
        success: true, 
        data: { 
          ...result,
          session_id: session.id,
          status: session.status,
          session: session,
          winner_id: winnerId,
          winner_username: winnerUsername,
          participants,
          product: session.product ? mapProductToFrontend(session.product) : null,
        } 
      });
    } else if (type === 'my-orders') {
      // 获取用户的拼团订单
      if (!user_id) {
        return createResponse({ success: false, error: 'User ID required' }, 400);
      }

      // 解析用户UUID
      const userUUID = await resolveUserIdToUUID(supabase, user_id);
      
      // 查询订单（通过session间接获取product，因为group_buy_orders与group_buy_products之间没有外键关系）
      let ordersQuery = supabase
        .from('group_buy_orders')
        .select(`
          *,
          session:group_buy_sessions(
            *,
            product:group_buy_products(*)
          )
        `)
        .order('created_at', { ascending: false });

      // 使用OR条件同时匹配
      if (userUUID && userUUID !== user_id) {
        ordersQuery = ordersQuery.or(`user_id.eq.${user_id},user_id.eq.${userUUID}`);
      } else {
        ordersQuery = ordersQuery.eq('user_id', user_id);
      }

      const { data: orders, error } = await ordersQuery;

       if (error) {
        return createResponse({ success: false, error: error.message }, 500);
      }
      // 将product从session中提取出来，保持返回格式与前端兼容
      const mappedOrders = orders?.map(order => {
        const product = order.session?.product || null;
        return {
          ...order,
          product: product ? mapProductToFrontend(product) : null,
        };
      }) || [];

      return createResponse({ success: true, data: mappedOrders });
    } else {
      return createResponse({ success: false, error: 'Invalid type parameter' }, 400);
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Group buy list error:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return createResponse({ 
      success: false, 
      error: errMsg || 'Unknown error',
      details: (error as any)?.details || null,
      hint: (error as any)?.hint || null,
      code: (error as any)?.code || null
    }, 500);
  }
});
