import { mapErrorCode } from '../_shared/errorResponse.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false',
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

  const expiresAt = new Date(session.expires_at);
  const now = new Date();
  
  if (expiresAt < now) {
    throw new Error('未授权：会话已过期');
  }

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
    phoneNumber: users[0].phone_number,
    user: users[0],
    session: session
  };
}

// 生成唯一的6位数字提货码
async function generatePickupCode(supabase: any): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    // 生成6位随机数字
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 检查是否在prizes表中已存在
    const { data: existingPrize } = await supabase
      .from('prizes')
      .select('id')
      .eq('pickup_code', code)
      .single();
    
    // 检查是否在full_purchase_orders表中已存在
    const { data: existingFullPurchase } = await supabase
      .from('full_purchase_orders')
      .select('id')
      .eq('pickup_code', code)
      .single();
    
    if (!existingPrize && !existingFullPurchase) {
      return code;
    }
    
    attempts++;
  }
  
  throw new Error('生成提货码失败，请重试');
}

/**
 * 全款购买积分商城商品
 * 【业务重构】支持混合支付：抵扣券 + TJS余额 + LUCKY_COIN积分
 * 
 * 重要逻辑修改（2026-01-08）：
 * - 全款购买从关联的库存商品(inventory_products)扣减库存
 * - 不再修改lotteries表的sold_tickets字段
 * - 一元购物的份数和全款购买的库存独立管理
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    // 【修改】接收 useCoupon 参数
    const { lottery_id, pickup_point_id, user_id, session_token, useCoupon, idempotency_key } = body;

    console.log('[CreateFullPurchaseOrder] Received request:', { 
      lottery_id,
      pickup_point_id,
      user_id,
      useCoupon,
      session_token: session_token ? 'present' : 'missing'
    });

    // 获取 session token（优先从 body，其次从 header）
    let token = session_token;
    if (!token) {
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        token = authHeader.replace('Bearer ', '');
      }
    }

    if (!token) {
      throw new Error('未授权：缺少 session_token');
    }

    if (!lottery_id) {
      throw new Error('缺少商品ID');
    }

    // 验证用户 session
    const { userId, user } = await validateSession(token);
    
    console.log('[CreateFullPurchaseOrder] User validated:', { userId });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 0. 幂等性保护：如果有提供 idempotency_key，检查是否已经处理过
    // 【R16修复】原查询的是不存在的 audit_logs 表，应改为 edge_function_logs
    if (idempotency_key) {
      const { data: existingLog } = await supabase
        .from('edge_function_logs')
        .select('id, details')
        .eq('function_name', 'create-full-purchase-order')
        .eq('action', 'FULL_PURCHASE')
        .eq('user_id', userId)
        .eq('status', 'success')
        .contains('details', { idempotency_key })
        .maybeSingle()

      if (existingLog) {
        console.log(`[CreateFullPurchaseOrder] Idempotency hit for key: ${idempotency_key}`)
        return new Response(
          JSON.stringify({
            success: true,
            message: '全款购买已成功处理（重复请求）',
            data: existingLog.details?.result_data
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 1. 获取商品信息（包含关联的库存商品ID）
    const { data: lottery, error: lotteryError } = await supabase
      .from('lotteries')
      .select('*')
      .eq('id', lottery_id)
      .single();

    if (lotteryError || !lottery) {
      console.error('[CreateFullPurchaseOrder] Lottery not found:', lotteryError);
      throw new Error('商品不存在');
    }

    // 2. 验证商品状态
    if (lottery.status !== 'ACTIVE') {
      throw new Error('该商品当前不可购买');
    }

    // 3. 验证全款购买是否启用
    if (lottery.full_purchase_enabled === false) {
      throw new Error('该商品不支持全款购买');
    }

    // 4. 获取关联的库存商品信息
    let inventoryProduct = null;
    if (lottery.inventory_product_id) {
      const { data: invProduct, error: invError } = await supabase
        .from('inventory_products')
        .select('*')
        .eq('id', lottery.inventory_product_id)
        .single();

      if (invError) {
        console.error('[CreateFullPurchaseOrder] Inventory product error:', invError);
        throw new Error('获取库存商品信息失败');
      }

      inventoryProduct = invProduct;

      // 【业务逻辑修改】不再检查 inventory_product 的状态
      // 只依赖 lottery 本身的 status 决定是否可购买
      // 原因：inventory_product 和 lottery 是独立管理的两个实体，
      // 管理员可能单独下架库存商品而不影响 lottery 的销售状态
      // lottery.status === 'ACTIVE' 已经是购买的唯一门槛

      // 验证库存是否充足
      if (inventoryProduct.stock <= 0) {
        throw new Error('库存不足，无法全款购买');
      }
    } else {
      // 如果没有关联库存商品，检查是否还有剩余份数可供全款购买
      if (lottery.sold_tickets >= lottery.total_tickets) {
        throw new Error('商品已售罄');
      }
    }

    // 5. 计算全款价格
    let fullPrice = lottery.full_purchase_price;
    if (!fullPrice && inventoryProduct) {
      fullPrice = inventoryProduct.original_price;
    }
    if (!fullPrice) {
      fullPrice = lottery.original_price || (lottery.ticket_price * lottery.total_tickets);
    }

    // 【修复】验证价格必须大于 0
    if (!fullPrice || fullPrice <= 0) {
      throw new Error('商品价格配置异常，请联系客服');
    }

    console.log('[CreateFullPurchaseOrder] Full price calculated:', { 
      fullPrice,
      full_purchase_price: lottery.full_purchase_price,
      inventory_original_price: inventoryProduct?.original_price,
      lottery_original_price: lottery.original_price
    });

    // ============================================================
    // 【业务重构】混合支付预检查
    // 获取 TJS + LUCKY_COIN + 抵扣券总可用资产
    // ============================================================

    // 获取 TJS 钱包余额
    const { data: tjsWallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'TJS')
      .single();
    const tjsBalance = tjsWallet ? (Number(tjsWallet.balance) || 0) : 0;

    // 获取 LUCKY_COIN 钱包余额
    const { data: lcWallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'LUCKY_COIN')
      .single();
    const lcBalance = lcWallet ? (Number(lcWallet.balance) || 0) : 0;

    // 检查抵扣券（如果选择使用）
    let couponValue = 0;
    if (useCoupon) {
      const { data: coupons } = await supabase
        .from('coupons')
        .select('amount')
        .eq('user_id', userId)
        .eq('status', 'VALID')
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true })
        .limit(1);
      if (coupons && coupons.length > 0) {
        couponValue = Number(coupons[0].amount) || 0;
      }
    }

    // 总可用资产预检查
    const totalAvailable = tjsBalance + lcBalance + couponValue;
    if (totalAvailable < fullPrice) {
      throw new Error(`总资产不足，需要 ${fullPrice}，当前可用 ${totalAvailable.toFixed(2)}（余额: ${tjsBalance.toFixed(2)}, 积分: ${lcBalance.toFixed(2)}, 抵扣券: ${couponValue.toFixed(2)}）`);
    }

    // 6. 验证自提点
    if (pickup_point_id) {
      const { data: pickupPoint, error: pointError } = await supabase
        .from('pickup_points')
        .select('id, status')
        .eq('id', pickup_point_id)
        .single();

      if (pointError || !pickupPoint) {
        throw new Error('自提点不存在');
      }

      if (pickupPoint.status !== 'ACTIVE') {
        throw new Error('该自提点当前不可用');
      }
    }

    // 7. 生成订单号
    const orderNumber = `FP${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // 8. 生成提货码
    const pickupCode = await generatePickupCode(supabase);

    // 9. 设置过期时间（30天后）
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // 10. 创建全款购买订单
    const { data: order, error: orderError } = await supabase
      .from('full_purchase_orders')
      .insert({
        user_id: userId,
        lottery_id: lottery_id,
        order_number: orderNumber,
        total_amount: fullPrice,
        currency: lottery.currency,
        status: 'PENDING',
        pickup_point_id: pickup_point_id || null,
        pickup_code: pickupCode,
        delivery_method: pickup_point_id ? 'PICKUP' : 'DELIVERY',
        metadata: {
          product_title: lottery.title,
          product_title_i18n: lottery.title_i18n,
          product_image: lottery.image_urls?.[0] || lottery.image_url || null,
          original_price: lottery.original_price,
          ticket_price: lottery.ticket_price,
          total_tickets: lottery.total_tickets,
          inventory_product_id: lottery.inventory_product_id,
          full_purchase_price: fullPrice,
        }
      })
      .select()
      .single();

    if (orderError) {
      console.error('[CreateFullPurchaseOrder] Create order error:', orderError);
      throw new Error('创建订单失败');
    }

    // ============================================================
    // 11. 【业务重构】调用 process_mixed_payment RPC 进行混合支付
    // 替代原有的手动 wallet update + 乐观锁逻辑
    // 支付优先级: 抵扣券 → TJS余额 → LUCKY_COIN积分
    // ============================================================
    const { data: paymentResult, error: paymentError } = await supabase.rpc(
      'process_mixed_payment',
      {
        p_user_id: userId,
        p_lottery_id: lottery_id,
        p_order_id: order.id,
        p_total_amount: fullPrice,
        p_use_coupon: useCoupon || false,
        p_order_type: 'FULL_PURCHASE'
      }
    );

    if (paymentError) {
      console.error('[CreateFullPurchaseOrder] process_mixed_payment RPC error:', paymentError);
      // 【P20修复】回滚订单状态为 CANCELLED（保留记录以便追踪）
      await supabase.from('full_purchase_orders').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', order.id);
      throw new Error(`支付失败: ${paymentError.message}`);
    }

    if (!paymentResult || !paymentResult.success) {
      const errorMsg = paymentResult?.error || 'UNKNOWN_PAYMENT_ERROR';
      console.error('[CreateFullPurchaseOrder] process_mixed_payment business error:', errorMsg);
      // 【P20修复】回滚订单状态为 CANCELLED
      await supabase.from('full_purchase_orders').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', order.id);
      throw new Error(`支付失败: ${errorMsg}`);
    }

    console.log('[CreateFullPurchaseOrder] Payment successful:', paymentResult);

    // 【佣金基数修复】佣金只按余额消费部分(tjs_deducted)计算，不包含积分消费和抵扣券
    const tjsDeducted = paymentResult.tjs_deducted || 0;
    if (tjsDeducted > 0) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && serviceRoleKey) {
          const commissionResponse = await fetch(`${supabaseUrl}/functions/v1/handle-purchase-commission`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              order_id: order.id,
              user_id: userId,
              order_amount: tjsDeducted
            }),
          });
          
          if (!commissionResponse.ok) {
            console.error('[CreateFullPurchaseOrder] Failed to process commission:', await commissionResponse.text());
          } else {
            console.log('[CreateFullPurchaseOrder] Commission processed successfully, based on TJS deducted:', tjsDeducted);
          }
        }
      } catch (commissionError: unknown) {
        console.error('[CreateFullPurchaseOrder] Commission processing error:', commissionError);
        // 佣金处理失败不影响主流程
      }
    } else {
      console.log('[CreateFullPurchaseOrder] No TJS deducted, skipping commission (paid entirely with points/coupons)');
    }

    // 【P17修复】支付成功后更新订单状态为 COMPLETED
    await supabase.from('full_purchase_orders').update({
      status: 'COMPLETED',
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);

    // 12. 更新库存（关键修改：从库存商品扣减，不影响一元购物份数）
    if (inventoryProduct) {
      // 有关联库存商品：从库存商品扣减库存（使用乐观锁防止并发超卖）
      const newStock = inventoryProduct.stock - 1;
      const { data: updatedInventory, error: updateInventoryError } = await supabase
        .from('inventory_products')
        .update({
          stock: newStock,
          updated_at: new Date().toISOString(),
        })
        .eq('id', inventoryProduct.id)
        .eq('stock', inventoryProduct.stock) // 乐观锁：确保库存未被其他并发请求修改
        .select()
        .maybeSingle();

      if (updateInventoryError) {
        console.error('[CreateFullPurchaseOrder] Update inventory error:', updateInventoryError);
        // 【P18修复】库存更新失败时，支付已完成，标记订单为 REFUND_PENDING 等待人工处理退款
        await supabase.from('full_purchase_orders').update({
          status: 'REFUND_PENDING',
          metadata: {
            ...order.metadata,
            refund_reason: 'INVENTORY_UPDATE_FAILED',
            refund_detail: updateInventoryError.message,
          },
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);
        console.error('[CreateFullPurchaseOrder] Order marked as REFUND_PENDING due to inventory error');
        throw new Error('库存更新失败，订单已标记为待退款，请联系客服');
      }

      if (!updatedInventory) {
        // 【P18修复】乐观锁冲突：库存已被其他请求修改，标记订单为 REFUND_PENDING
        console.error('[CreateFullPurchaseOrder] Optimistic lock conflict: inventory stock changed by another request');
        await supabase.from('full_purchase_orders').update({
          status: 'REFUND_PENDING',
          metadata: {
            ...order.metadata,
            refund_reason: 'INVENTORY_OPTIMISTIC_LOCK_CONFLICT',
          },
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);
        console.error('[CreateFullPurchaseOrder] Order marked as REFUND_PENDING due to optimistic lock conflict');
        throw new Error('库存已变动，订单已标记为待退款，请联系客服');
      }

      // 记录库存变动
      const { error: inventoryTransactionError } = await supabase
        .from('inventory_transactions')
        .insert({
          inventory_product_id: inventoryProduct.id,
          transaction_type: 'FULL_PURCHASE',
          quantity: -1,
          stock_before: inventoryProduct.stock,
          stock_after: newStock,
          related_order_id: order.id,
          related_lottery_id: lottery_id,
          notes: `全款购买订单 ${orderNumber}`,
        });

      if (inventoryTransactionError) {
        console.error('[CreateFullPurchaseOrder] Inventory transaction log error:', inventoryTransactionError);
        // 不影响主流程
      }

      console.log('[CreateFullPurchaseOrder] Inventory updated:', {
        inventoryProductId: inventoryProduct.id,
        stockBefore: inventoryProduct.stock,
        stockAfter: newStock,
      });
    } else {
      console.log('[CreateFullPurchaseOrder] No inventory product linked, full purchase completed without stock deduction:', {
        lotteryId: lottery_id,
        soldTickets: lottery.sold_tickets,
        totalTickets: lottery.total_tickets,
        note: 'Full purchase does not affect sold_tickets (lottery tickets). Consider linking an inventory product for proper stock management.'
      });
    }

       // 13. 记录操作日志
    await supabase
      .from('pickup_logs')
      .insert({
        prize_id: order.id,
        pickup_code: pickupCode,
        pickup_point_id: pickup_point_id || null,
        operation_type: 'FULL_PURCHASE',
        notes: `用户全款购买商品，生成提货码`,
      });

    const resultData = {
      order_id: order.id,
      order_number: orderNumber,
      pickup_code: pickupCode,
      expires_at: expiresAt.toISOString(),
      payment_detail: paymentResult,
    };

    // 记录审计日志（包含 idempotency_key）
    if (idempotency_key) {
      await supabase.rpc('log_edge_function_action', {
        p_function_name: 'create-full-purchase-order',
        p_action: 'FULL_PURCHASE',
        p_user_id: userId,
        p_target_type: 'lottery',
        p_target_id: lottery_id,
        p_details: {
          order_id: order.id,
          total_amount: fullPrice,
          use_coupon: useCoupon || false,
          idempotency_key: idempotency_key,
          result_data: resultData,
        },
        p_status: 'success',
        p_error_message: null,
      }).then(({ error: logErr }) => { if (logErr) console.error('Failed to write audit log:', logErr); });
    }

    console.log('[CreateFullPurchaseOrder] Success:', { 
      orderId: order.id, 
      orderNumber, 
      pickupCode,
      totalAmount: fullPrice,
      inventoryProductId: inventoryProduct?.id || null,
      paymentDetail: paymentResult,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: resultData,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[CreateFullPurchaseOrder] Error:', errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg, error_code: mapErrorCode(errMsg) }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
