import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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
 * 获取用户的所有中奖记录
 * 支持 GET 和 POST 请求
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let session_token: string | null = null;

    // 支持 GET 和 POST 请求
    if (req.method === 'POST') {
      // 从 body 中获取 session_token
      const body = await req.json();
      session_token = body.session_token;
    } 
    
    // 如果 POST body 中没有，或者请求是 GET，则尝试从 Authorization header 获取
    if (!session_token) {
      const authHeader = req.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        // 只有当 token 不是 anon key 时才使用它作为 session_token
        if (token !== Deno.env.get('SUPABASE_ANON_KEY')) {
          session_token = token;
        }
      }
    }

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    // 验证用户 session
    const { userId, telegramId } = await validateSession(session_token);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    console.log('[GetMyPrizes] Fetching prizes for userId:', userId, 'and telegramId:', telegramId);

    // 获取用户的所有中奖记录（同时查询 userId 和 telegramId）
    // 先用 userId (UUID) 查询
    const prizesResponse1 = await fetch(
      `${supabaseUrl}/rest/v1/prizes?user_id=eq.${userId}&select=*&order=won_at.desc`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        }
      }
    );

    // 再用 telegramId 查询（兼容旧数据）
    const prizesResponse2 = await fetch(
      `${supabaseUrl}/rest/v1/prizes?user_id=eq.${telegramId}&select=*&order=won_at.desc`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        }
      }
    );

    let prizesByUserId = [];
    let prizesByTelegramId = [];

    if (prizesResponse1.ok) {
      prizesByUserId = await prizesResponse1.json();
    } else {
      console.error('[GetMyPrizes] Failed to fetch prizes by userId:', await prizesResponse1.text());
    }

    if (prizesResponse2.ok) {
      prizesByTelegramId = await prizesResponse2.json();
    } else {
      console.error('[GetMyPrizes] Failed to fetch prizes by telegramId:', await prizesResponse2.text());
    }

    // 合并两个查询结果，去重
    const allPrizes = [...prizesByUserId, ...prizesByTelegramId];
    const prizeIds = new Set();
    const prizes = allPrizes.filter((prize: any) => {
      if (prizeIds.has(prize.id)) return false;
      prizeIds.add(prize.id);
      return true;
    });

    console.log('[GetMyPrizes] Found prizes:', prizes.length, '(byUserId:', prizesByUserId.length, ', byTelegramId:', prizesByTelegramId.length, ')');

    // 如果有奖品，获取关联的 lottery 信息
    if (prizes.length > 0) {
      const lotteryIds = [...new Set(prizes.map((p: any) => p.lottery_id))];
      
      const lotteriesResponse = await fetch(
        `${supabaseUrl}/rest/v1/lotteries?id=in.(${lotteryIds.join(',')})&select=id,title,title_i18n,image_url,image_urls`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (lotteriesResponse.ok) {
        const lotteries = await lotteriesResponse.json();
        
        // 合并 lottery 信息到 prizes
        for (const prize of prizes) {
          prize.lottery = lotteries.find((l: any) => l.id === prize.lottery_id) || null;
        }
      }

      // 获取关联的 shipping 信息
      const prizeIds = prizes.map((p: any) => p.id);
      const shippingResponse = await fetch(
        `${supabaseUrl}/rest/v1/shipping?prize_id=in.(${prizeIds.join(',')})&select=*`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (shippingResponse.ok) {
        const shippings = await shippingResponse.json();
        
        // 合并 shipping 信息到 prizes
        for (const prize of prizes) {
          prize.shipping = shippings.find((s: any) => s.prize_id === prize.id) || null;
        }
      }

      // 获取关联的 market_listings 信息（检查奖品是否已上架转售）
      const marketResponse = await fetch(
        `${supabaseUrl}/rest/v1/market_listings?entry_id=in.(${prizeIds.join(',')})&select=*`,
        {
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (marketResponse.ok) {
        const listings = await marketResponse.json();
        
        // 合并 market_listing 信息到 prizes
        for (const prize of prizes) {
          prize.market_listing = listings.find((l: any) => l.entry_id === prize.id) || null;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: prizes || []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[GetMyPrizes] Error:', error);
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
