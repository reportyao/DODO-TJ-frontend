/**
 * 回滚已分配的彩票
 */
async function rollbackAllocatedTickets(
  supabaseUrl: string,
  serviceRoleKey: string,
  tickets: any[],
  context?: {
    userId?: string;
    lotteryId?: string;
    orderId?: string;
  }
) {
  if (!tickets || tickets.length === 0) {
    return;
  }

  const ticketIds = tickets.map((t) => t.id);
  console.log(`Rolling back ${ticketIds.length} tickets:`, ticketIds);

  try {
    // 删除已分配的彩票
    const deleteResponse = await fetch(
      `${supabaseUrl}/rest/v1/lottery_entries?id=in.(${ticketIds.join(',')})`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error('Failed to delete tickets during rollback:', errorText);
      // 记录到错误日志，需要人工处理
      logOrphanedTickets(ticketIds, `Rollback failed: ${errorText}`, context);
    } else {
      console.log(`Successfully rolled back ${ticketIds.length} tickets`);
    }
  } catch (error) {
    console.error('Error during ticket rollback:', error);
    // 记录到错误日志
    logOrphanedTickets(
      ticketIds,
      `Rollback exception: ${error instanceof Error ? error.message : String(error)}`,
      context
    );
  }
}

/**
 * 记录孤儿彩票（需要人工处理）
 */
function logOrphanedTickets(
  ticketIds: string[],
  error: string,
  context?: {
    userId?: string;
    lotteryId?: string;
    orderId?: string;
  }
) {
  const logEntry = {
    level: 'ERROR',
    type: 'ORPHANED_TICKETS',
    ticket_ids: ticketIds,
    ticket_count: ticketIds.length,
    error_message: error,
    context: context || {},
    timestamp: new Date().toISOString(),
    action_required: 'Manual cleanup required - delete these tickets from lottery_entries table',
  };

  console.error('[ORPHANED_TICKETS_ALERT]', JSON.stringify(logEntry));
  
  console.error(`⚠️ ORPHANED TICKETS DETECTED:
  - Ticket IDs: ${ticketIds.join(', ')}
  - Error: ${error}
  - User ID: ${context?.userId || 'unknown'}
  - Lottery ID: ${context?.lotteryId || 'unknown'}
  - Order ID: ${context?.orderId || 'unknown'}
  - Timestamp: ${logEntry.timestamp}
  - Action: Please manually delete these tickets from lottery_entries table`);
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

/** 根据错误消息映射到标准化错误码 */
function mapErrorCode(msg: string): string {
  if (msg.includes('服务器配置错误')) return 'ERR_SERVER_CONFIG';
  if (msg.includes('缺少必要参数')) return 'ERR_PARAMS_MISSING';
  if (msg.includes('数量无效')) return 'ERR_QUANTITY_INVALID';
  if (msg.includes('未授权：缺少会话令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('未授权：缺少 session_token')) return 'ERR_MISSING_SESSION';
  if (msg.includes('未授权：缺少认证令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('未授权：无效的会话令牌')) return 'ERR_INVALID_TOKEN';
  if (msg.includes('未授权：无效的认证令牌')) return 'ERR_INVALID_TOKEN';
  if (msg.includes('未授权：会话不存在或已过期')) return 'ERR_INVALID_SESSION';
  if (msg.includes('未授权：会话不存在或已失效')) return 'ERR_INVALID_SESSION';
  if (msg.includes('未授权：会话已过期')) return 'ERR_SESSION_EXPIRED';
  if (msg.includes('未授权：用户不存在')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('验证会话失败')) return 'ERR_SESSION_VALIDATE_FAILED';
  if (msg.includes('用户不存在')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('商品不存在')) return 'ERR_PRODUCT_NOT_FOUND';
  if (msg.includes('库存不足')) return 'ERR_OUT_OF_STOCK';
  if (msg.includes('价格配置无效')) return 'ERR_PRICE_CONFIG_INVALID';
  if (msg.includes('余额不足')) return 'ERR_INSUFFICIENT_BALANCE';
  if (msg.includes('积分余额不足')) return 'ERR_INSUFFICIENT_POINTS';
  if (msg.includes('未找到用户钱包')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('获取钱包信息失败')) return 'ERR_WALLET_INFO_FAILED';
  if (msg.includes('冻结余额失败')) return 'ERR_FREEZE_BALANCE_FAILED';
  if (msg.includes('创建提现请求失败')) return 'ERR_WITHDRAW_CREATE_FAILED';
  if (msg.includes('充值金额必须大于0')) return 'ERR_DEPOSIT_AMOUNT_INVALID';
  if (msg.includes('提现金额必须大于0')) return 'ERR_WITHDRAW_AMOUNT_INVALID';
  if (msg.includes('金额必须大于0')) return 'ERR_AMOUNT_INVALID';
  if (msg.includes('兑换金额必须大于0')) return 'ERR_EXCHANGE_AMOUNT_INVALID';
  if (msg.includes('无效的兑换类型')) return 'ERR_EXCHANGE_TYPE_INVALID';
  if (msg.includes('未找到源钱包')) return 'ERR_SOURCE_WALLET_NOT_FOUND';
  if (msg.includes('未找到目标钱包')) return 'ERR_TARGET_WALLET_NOT_FOUND';
  if (msg.includes('源钱包和目标钱包类型必须不同')) return 'ERR_SAME_WALLET_TYPE';
  if (msg.includes('票据不存在或不属于您')) return 'ERR_TICKET_NOT_FOUND';
  if (msg.includes('该票据已在转售中')) return 'ERR_TICKET_ALREADY_RESALE';
  if (msg.includes('转售商品不存在')) return 'ERR_RESALE_ITEM_NOT_FOUND';
  if (msg.includes('该商品已下架或已售出')) return 'ERR_RESALE_ITEM_UNAVAILABLE';
  if (msg.includes('不能购买自己的商品')) return 'ERR_CANNOT_BUY_OWN';
  if (msg.includes('未找到奖品记录')) return 'ERR_PRIZE_NOT_FOUND';
  if (msg.includes('您不是该抽奖的中奖者')) return 'ERR_NOT_WINNER';
  if (msg.includes('创建奖品记录失败')) return 'ERR_PRIZE_CREATE_FAILED';
  if (msg.includes('生成提货码失败')) return 'ERR_PICKUP_CODE_FAILED';
  if (msg.includes('您不是地推人员')) return 'ERR_NOT_PROMOTER';
  if (msg.includes('您的地推人员账号未激活')) return 'ERR_PROMOTER_INACTIVE';
  if (msg.includes('自提点不存在或不可用')) return 'ERR_PICKUP_POINT_NOT_FOUND';
  if (msg.includes('搜索关键词不能为空')) return 'ERR_SEARCH_KEYWORD_EMPTY';
  if (msg.includes('记录不存在或不属于您')) return 'ERR_RECORD_NOT_FOUND';
  if (msg.includes('卖家钱包不存在')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('买家钱包不存在')) return 'ERR_WALLET_NOT_FOUND';
  if (msg.includes('源钱包不存在')) return 'ERR_SOURCE_WALLET_NOT_FOUND';
  if (msg.includes('目标钱包不存在')) return 'ERR_TARGET_WALLET_NOT_FOUND';
  if (msg.includes('缺少转售商品ID')) return 'ERR_RESALE_ID_MISSING';
  if (msg.includes('缺少会话令牌')) return 'ERR_MISSING_TOKEN';
  if (msg.includes('目标用户ID不能为空')) return 'ERR_PARAMS_MISSING';
  if (msg.includes('获取用户信息失败')) return 'ERR_USER_NOT_FOUND';
  if (msg.includes('钱包版本冲突')) return 'ERR_CONCURRENT_OPERATION';
  if (msg.includes('扣除余额失败')) return 'ERR_FREEZE_BALANCE_FAILED';
  if (msg.includes('增加卖家余额失败')) return 'ERR_SERVER_ERROR';
  if (msg.includes('兑换操作失败')) return 'ERR_EXCHANGE_FAILED';
  if (msg.includes('兑换操作缺少目标钱包类型')) return 'ERR_EXCHANGE_WALLET_MISSING';
  if (msg.includes('无效的目标钱包类型')) return 'ERR_EXCHANGE_WALLET_MISSING';
  if (msg.includes('无效的操作')) return 'ERR_INVALID_ACTION';
  if (msg.includes('操作失败')) return 'ERR_CONCURRENT_OPERATION';
  return 'ERR_SERVER_ERROR';
}


  try {
    // 获取 Supabase 配置
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');

    if (!serviceRoleKey || !supabaseUrl) {
      throw new Error('服务器配置错误');
    }

    // 【BUG修复】一元夺宝不允许使用抵扣券，强制忽略前端传入的 useCoupon 参数
    const { lotteryId, quantity, paymentMethod, session_token, useCoupon: _useCouponIgnored, idempotency_key } = await req.json();
    // 强制设为 false：iTJS抵扣券仅适用于全款购买，不适用于一元夺宝
    const useCoupon = false;

    if (!lotteryId || !quantity || !paymentMethod) {
      throw new Error('缺少必要参数');
    }

    if (quantity <= 0 || quantity > 100) {
      throw new Error('数量无效：必须在1到100之间');
    }

    // 【R15修复】幂等性查重：如果提供了 idempotency_key，在开始时查询 edge_function_logs
    // 防止网络超时后用户重试导致重复扣款
    if (idempotency_key) {
      const idempotencyCheckResponse = await fetch(
        `${supabaseUrl}/rest/v1/edge_function_logs?function_name=eq.lottery-purchase&status=eq.success&details->>idempotency_key=eq.${encodeURIComponent(idempotency_key)}&select=id,details&limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
          },
        }
      );
      if (idempotencyCheckResponse.ok) {
        const existingLogs = await idempotencyCheckResponse.json();
        if (existingLogs.length > 0) {
          // 找到重复请求，返回原始结果
          const cachedResult = existingLogs[0].details?.result_data;
          console.log('Idempotency hit, returning cached result for key:', idempotency_key);
          return new Response(JSON.stringify({ data: cachedResult, idempotency_hit: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ✅ 使用自定义 session token 验证用户
    let sessionToken = session_token;
    if (!sessionToken) {
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        sessionToken = authHeader.replace('Bearer ', '');
      }
    }
    
    if (!sessionToken) {
      throw new Error('未授权：缺少会话令牌');
    }

    // ✅ 查询 user_sessions 表验证 token
    const sessionResponse = await fetch(
      `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${sessionToken}&is_active=eq.true&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!sessionResponse.ok) {
      throw new Error('未授权：无效的会话令牌');
    }

    const sessions = await sessionResponse.json();
    if (sessions.length === 0) {
      throw new Error('未授权：会话不存在或已过期');
    }

    const session = sessions[0];

    // ✅ 检查 session 是否过期
    const expiresAt = new Date(session.expires_at);
    if (expiresAt < new Date()) {
      throw new Error('未授权：会话已过期');
    }

    // ✅ 单独查询用户信息
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${session.user_id}&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!userResponse.ok) {
      throw new Error('用户不存在');
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      throw new Error('用户不存在');
    }

    const user = users[0];
    const userId = user.id;

    // ✅ 获取彩票信息
    const lotteryResponse = await fetch(
      `${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );

    const lotteries = await lotteryResponse.json();
    if (lotteries.length === 0) {
      throw new Error('商品不存在');
    }

    const lottery = lotteries[0];

    // 验证彩票状态
    if (lottery.status !== 'ACTIVE') {
      throw new Error(`商品未在售中，当前状态: ${lottery.status}`);
    }

    // ✅ 检查是否有足够的票（预检查，实际检查在RPC函数中）
    if (lottery.sold_tickets + quantity > lottery.total_tickets) {
      throw new Error('库存不足');
    }

    // 检查用户购买限制
    const userEntriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/lottery_entries?user_id=eq.${userId}&lottery_id=eq.${lotteryId}&select=id`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );

    const userEntries = await userEntriesResponse.json();
    
    // ✅ 支持无限购买
    if (!lottery.unlimited_purchase && lottery.max_per_user) {
      if (userEntries.length + quantity > lottery.max_per_user) {
        throw new Error(`超出每人最大购买限制: ${lottery.max_per_user}`);
      }
    }

    // 计算总金额
    const totalAmount = lottery.ticket_price * quantity;
    // 【修复】验证总金额必须大于 0
    if (!totalAmount || totalAmount <= 0) {
      throw new Error('价格配置无效');
    }

    // ============================================================
    // 【业务重构】混合支付预检查
    // 获取用户 TJS 和 LUCKY_COIN 钱包余额 + 抵扣券数量，进行总资产预检查
    // 实际扣款由 process_mixed_payment RPC 在数据库事务中完成
    // ============================================================
    
    // 获取 TJS 钱包
    const tjsWalletResponse = await fetch(
      `${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}&type=eq.TJS&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );
    const tjsWallets = await tjsWalletResponse.json();
    const tjsBalance = tjsWallets.length > 0 ? (parseFloat(tjsWallets[0].balance) || 0) : 0;

    // 获取 LUCKY_COIN 钱包
    const lcWalletResponse = await fetch(
      `${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}&type=eq.LUCKY_COIN&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );
    const lcWallets = await lcWalletResponse.json();
    const lcBalance = lcWallets.length > 0 ? (parseFloat(lcWallets[0].balance) || 0) : 0;

    // 检查抵扣券（如果选择使用）
    let couponValue = 0;
    if (useCoupon) {
      const couponResponse = await fetch(
        `${supabaseUrl}/rest/v1/coupons?user_id=eq.${userId}&status=eq.VALID&expires_at=gt.${new Date().toISOString()}&select=amount&order=expires_at.asc&limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
          },
        }
      );
      const coupons = await couponResponse.json();
      if (coupons.length > 0) {
        couponValue = parseFloat(coupons[0].amount) || 0;
      }
    }

    // 总可用资产预检查
    const totalAvailable = tjsBalance + lcBalance + couponValue;
    if (totalAvailable < totalAmount) {
      throw new Error(`余额不足。可用: ${totalAvailable.toFixed(2)} (TJS: ${tjsBalance.toFixed(2)}, 积分: ${lcBalance.toFixed(2)}, 优惠券: ${couponValue.toFixed(2)}), 需要: ${totalAmount.toFixed(2)}`);
    }

    // 生成订单号
    const orderNumber = `LT${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    // 创建订单
    const orderData = {
      user_id: userId,
      order_number: orderNumber,
      type: 'LOTTERY_PURCHASE',
      total_amount: totalAmount,
      currency: lottery.currency,
      payment_method: paymentMethod,
      lottery_id: lotteryId,
      quantity: quantity,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const createOrderResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(orderData),
    });

    if (!createOrderResponse.ok) {
      const errorText = await createOrderResponse.text();
      throw new Error(`创建订单失败: ${errorText}`);
    }

    const orders = await createOrderResponse.json();
    const order = orders[0];

    // ✅ 使用原子性RPC函数分配ticket_number，防止并发冲突
    const allocateResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/allocate_lottery_tickets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_lottery_id: lotteryId,
        p_user_id: userId,
        p_quantity: quantity,
        p_order_id: order.id,
      }),
    });

    if (!allocateResponse.ok) {
      const errorText = await allocateResponse.text();
      // 回滚订单
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      throw new Error(`分配票失败: ${errorText}`);
    }

    const allocatedTickets = await allocateResponse.json();
    const participationCodes = allocatedTickets.map((t: any) => t.participation_code);

    // ============================================================
    // 【业务重构】调用 process_mixed_payment RPC 进行混合支付
    // 替代原有的手动 wallet PATCH 更新逻辑
    // 支付优先级: 抵扣券 → TJS余额 → LUCKY_COIN积分
    // ============================================================
    const paymentRpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/process_mixed_payment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_lottery_id: lotteryId,
        p_order_id: order.id,
        p_total_amount: totalAmount,
        p_use_coupon: useCoupon || false,
        p_order_type: 'LOTTERY_PURCHASE'
      }),
    });

    if (!paymentRpcResponse.ok) {
      const errorText = await paymentRpcResponse.text();
      console.error('process_mixed_payment RPC HTTP error:', errorText);
      // 回滚已分配的彩票和订单
      await rollbackAllocatedTickets(supabaseUrl, serviceRoleKey, allocatedTickets, {
        userId,
        lotteryId,
        orderId: order.id,
      });
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      throw new Error(`支付失败: ${errorText}`);
    }

    const paymentResult = await paymentRpcResponse.json();
    console.log('process_mixed_payment result:', paymentResult);

    // 检查 RPC 业务逻辑结果
    if (!paymentResult || !paymentResult.success) {
      const paymentError = paymentResult?.error || '未知支付错误';
      console.error('process_mixed_payment business error:', paymentError);
      // 回滚已分配的彩票和订单
      await rollbackAllocatedTickets(supabaseUrl, serviceRoleKey, allocatedTickets, {
        userId,
        lotteryId,
        orderId: order.id,
      });
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      throw new Error(`支付失败: ${paymentError}`);
    }

    // 更新订单状态
    await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'PAID',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    // ✅ 重新查询lottery获取最新的sold_tickets
    const updatedLotteryResponse = await fetch(
      `${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}&select=sold_tickets,total_tickets`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
      }
    );
    
    const updatedLotteries = await updatedLotteryResponse.json();
    const updatedLottery = updatedLotteries[0];
    const isSoldOut = updatedLottery.sold_tickets >= updatedLottery.total_tickets;

    // 如果售罄，更新状态和开奖时间
    if (isSoldOut) {
      const drawTime = new Date(Date.now() + 180 * 1000); // 180秒后开奖
      await fetch(`${supabaseUrl}/rest/v1/lotteries?id=eq.${lotteryId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'SOLD_OUT',
          draw_time: drawTime.toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });

      // 异步调用售罄检测函数
      fetch(`${supabaseUrl}/functions/v1/check-lottery-sold-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ lotteryId: lotteryId }),
      }).catch((err) => {
        console.error('Failed to trigger sold-out check:', err);
      });
    }

    // 处理推荐佣金
    // 【佣金基数修复】佣金只按余额消费部分(tjs_deducted)计算，不包含积分消费和抵扣券
    const tjsDeducted = paymentResult.tjs_deducted || 0;
    const hasReferrer = user.referred_by_id || user.referrer_id;
    if (hasReferrer && tjsDeducted > 0) {
      try {
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
          console.error('Failed to process commission:', await commissionResponse.text());
        }
      } catch (commissionError: unknown) {
        console.error('Commission processing error:', commissionError);
      }
    }

    // 【修改】计算支付后的剩余余额（从 RPC 返回值中获取）
    const remainingTjsBalance = tjsBalance - (paymentResult.tjs_deducted || 0);
    const remainingLcBalance = lcBalance - (paymentResult.lc_deducted || 0);

    // 返回购买结果
    const result = {
      success: true,
      order: {
        id: order.id,
        order_number: order.order_number,
        total_amount: totalAmount,
        status: 'PAID',
      },
      lottery_entries: allocatedTickets,
      participation_codes: participationCodes,
      remaining_balance: remainingTjsBalance,
      remaining_lc_balance: remainingLcBalance,
      payment_detail: {
        coupon_deducted: paymentResult.coupon_deducted || 0,
        tjs_deducted: paymentResult.tjs_deducted || 0,
        lc_deducted: paymentResult.lc_deducted || 0,
      },
      is_sold_out: isSoldOut,
    };

    // 记录操作日志（包含 idempotency_key）
    if (idempotency_key) {
      await fetch(`${supabaseUrl}/rest/v1/rpc/log_edge_function_action`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_function_name: 'lottery-purchase',
          p_action: 'LOTTERY_PURCHASE',
          p_user_id: userId,
          p_target_type: 'lottery',
          p_target_id: lotteryId,
          p_details: {
            quantity,
            payment_method: paymentMethod,
            total_amount: totalAmount,
            order_id: order.id,
            use_coupon: useCoupon || false,
            idempotency_key: idempotency_key,
            result_data: result,
          },
          p_status: 'success',
          p_error_message: null,
        }),
      }).catch(err => console.error('Failed to write audit log:', err));
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Lottery purchase error:', errMsg);

    const errorResponse = {
      error: {
        code: mapErrorCode(errMsg),
        message: errMsg,
      },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
