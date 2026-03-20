import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

// 通用的 session 验证函数（与 claim-prize 等保持一致）
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
  if (expiresAt < new Date()) {
    throw new Error('未授权：会话已过期');
  }

  return { userId: session.user_id };
}

/**
 * 用户申请发货
 * 用户中奖后选择发货，填写收货地址信息
 * 
 * 认证方式：自定义 session_token（通过 body 传递）
 * 兼容前端两种调用格式：
 *   - 新格式: { session_token, prize_id, shipping_info: { recipient_name, phone, address, city, postal_code, notes } }
 *   - 旧格式: { session_token, prizeId, recipientName, recipientPhone, recipientAddress, ... }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()

    // ============================================================
    // 1. 认证：优先使用 session_token，向后兼容 Authorization header
    // ============================================================
    let userId: string;

    if (body.session_token) {
      // 新的自定义 session 认证（PWA 模式）
      const result = await validateSession(body.session_token);
      userId = result.userId;
    } else {
      // 向后兼容：尝试 Authorization header（Supabase Auth，将来移除）
      const authHeader = req.headers.get('authorization');
      if (!authHeader) {
        throw new Error('未授权：缺少 session_token');
      }
      const token = authHeader.replace('Bearer ', '');
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError || !user) {
        throw new Error('未授权：无效的认证令牌');
      }
      userId = user.id;
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ============================================================
    // 2. 解析请求参数（兼容新旧两种格式）
    // ============================================================
    let prizeId: string;
    let recipientName: string;
    let recipientPhone: string;
    let recipientAddress: string;
    let recipientCity: string | null;
    let recipientRegion: string | null;
    let recipientPostalCode: string | null;
    let recipientCountry: string;
    let notes: string | null;

    if (body.shipping_info) {
      // 新格式：前端 MyPrizesPage ShippingModal 传递的格式
      prizeId = body.prize_id;
      recipientName = body.shipping_info.recipient_name;
      recipientPhone = body.shipping_info.phone;
      recipientAddress = body.shipping_info.address;
      recipientCity = body.shipping_info.city || null;
      recipientRegion = body.shipping_info.region || null;
      recipientPostalCode = body.shipping_info.postal_code || null;
      recipientCountry = body.shipping_info.country || 'Tajikistan';
      notes = body.shipping_info.notes || null;
    } else {
      // 旧格式：驼峰字段直接传递
      prizeId = body.prizeId || body.prize_id;
      recipientName = body.recipientName || body.recipient_name;
      recipientPhone = body.recipientPhone || body.recipient_phone;
      recipientAddress = body.recipientAddress || body.recipient_address;
      recipientCity = body.recipientCity || body.recipient_city || null;
      recipientRegion = body.recipientRegion || body.recipient_region || null;
      recipientPostalCode = body.recipientPostalCode || body.recipient_postal_code || null;
      recipientCountry = body.recipientCountry || body.recipient_country || 'Tajikistan';
      notes = body.notes || null;
    }

    if (!prizeId || !recipientName || !recipientPhone || !recipientAddress) {
      throw new Error('缺少必填字段：奖品ID、收件人姓名、电话和地址为必填项')
    }

    // ============================================================
    // 3. 验证 prize 是否属于当前用户
    // ============================================================
    const { data: prize, error: prizeError } = await supabaseClient
      .from('prizes')
      .select('*')
      .eq('id', prizeId)
      .eq('user_id', userId)
      .single()

    if (prizeError || !prize) {
      throw new Error('奖品不存在或不属于您')
    }

    // ============================================================
    // 4. 检查 prize 状态
    // ============================================================
    if (prize.status !== 'PENDING' && prize.status !== 'CLAIMED') {
      throw new Error(`当前奖品状态为 ${prize.status}，无法申请发货`)
    }

    // ============================================================
    // 5. 创建 shipping 记录
    // ============================================================
    const { data: shipping, error: shippingError } = await supabaseClient
      .from('shipping')
      .insert({
        prize_id: prizeId,
        user_id: userId,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        recipient_address: recipientAddress,
        recipient_city: recipientCity,
        recipient_region: recipientRegion,
        recipient_postal_code: recipientPostalCode,
        recipient_country: recipientCountry,
        status: 'PENDING',
        notes: notes,
        requested_at: new Date().toISOString()
      })
      .select()
      .single()

    if (shippingError) {
      throw new Error(`创建发货记录失败: ${shippingError.message}`)
    }

    // ============================================================
    // 6. 更新 prize 状态为 SHIPPING
    // ============================================================
    const { error: updatePrizeError } = await supabaseClient
      .from('prizes')
      .update({
        status: 'SHIPPING',
        processed_at: new Date().toISOString()
      })
      .eq('id', prizeId)

    if (updatePrizeError) {
      throw new Error(`更新奖品状态失败: ${updatePrizeError.message}`)
    }

    // ============================================================
    // 7. 创建 shipping 历史记录
    // ============================================================
    await supabaseClient
      .from('shipping_history')
      .insert({
        shipping_id: shipping.id,
        status: 'PENDING',
        description: '用户申请发货',
        created_at: new Date().toISOString()
      })

    // ============================================================
    // 8. 发送通知
    // ============================================================
    try {
      await supabaseClient.from('notifications').insert({
        user_id: userId,
        type: 'SHIPPING_REQUEST',
        title: '发货申请已提交',
        content: `您的奖品发货申请已提交，请等待处理`,
        data: {
          prize_id: prizeId,
          shipping_id: shipping.id
        },
        is_read: false
      })
    } catch (notifError: unknown) {
      console.error('Failed to send notification:', notifError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          shipping_id: shipping.id,
          prize_id: prizeId,
          status: 'PENDING'
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
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
