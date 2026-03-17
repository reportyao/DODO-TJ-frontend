import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-customer-header',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// 敏感词库
const sensitiveKeywords = [
  // 宗教相关
  'ислом', 'исломӣ', 'мусулмон', 'масҷид', 'намоз', 'рӯза', 'ҳаҷ', 'закот',
  'қуръон', 'ҳадис', 'шариат', 'имом', 'муллоҳ', 'мазҳаб', 'ваҳҳобӣ', 'салафӣ',
  'ислам', 'мусульман', 'мечеть', 'молитва', 'коран', 'хадис', 'шариат',
  'islam', 'muslim', 'mosque', 'quran', 'hadith', 'sharia', 'imam',
  // 政治相关
  'президент', 'ҳукумат', 'парлумон', 'интихобот', 'ҳизб', 'сиёсат', 'оппозиция',
  'раҳмон', 'эмомалӣ', 'набиев', 'рахмонов',
  'правительство', 'парламент', 'выборы', 'партия', 'политика', 'оппозиция',
  'president', 'government', 'parliament', 'election', 'party', 'politics', 'opposition',
  // 历史敏感
  'ҷанги шаҳрвандӣ', 'гражданская война', 'civil war',
  // 违禁内容
  'терроризм', 'экстремизм', 'terrorism', 'extremism'
];

// System Prompt
const SYSTEM_PROMPT = `You are TezBarakat AI (ТезБаракат AI) for Tajikistan users.

RULES:
1. Language: Tajik (Cyrillic), formal 'Шумо'.
2. ALWAYS HELP:
   - Business & Work (selling, jobs, prices, market rules).
   - Daily Life (weather, cooking, travel, shopping).
   - Education (languages, math, general knowledge).
   - Writing & Translation.
3. REFUSE ONLY: Politics, religion (doctrines/figures), extremism, sensitive history (civil war).`;

const REFUSAL_MESSAGE = 'Мебахшед, ман наметавонам дар бораи ин мавзӯъ сӯҳбат кунам. Ман метавонам дар масъалаҳои рӯзмарра, омӯзиш, навиштани матн ё тарҷумаи матни бетараф кӯмак кунам. Шумо чӣ мехоҳед?';

// 检查敏感内容
function containsSensitiveContent(text: string): boolean {
  const lowerText = text.toLowerCase();
  return sensitiveKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

// 验证session
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

  return {
    userId: session.user_id,
    session: session
  };
}

/**
 * 获取最近一天的 bonus_quota 值
 * 最近一天的值已经包含了之前所有继承的值，所以直接取即可
 */
async function getLatestBonusQuota(userId: string, excludeDate: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const response = await fetch(
    `${supabaseUrl}/rest/v1/ai_chat_quota?user_id=eq.${userId}&date=neq.${excludeDate}&select=bonus_quota,date&order=date.desc&limit=1`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  const records = await response.json();
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  return records[0].bonus_quota || 0;
}

// 获取或创建今日配额（继承最近一天的 bonus_quota）
async function getOrCreateQuota(userId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const today = new Date().toISOString().split('T')[0];
  
  // 查询今日配额
  const quotaResponse = await fetch(
    `${supabaseUrl}/rest/v1/ai_chat_quota?user_id=eq.${userId}&date=eq.${today}&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    }
  );

  const quotas = await quotaResponse.json();
  
  if (quotas.length > 0) {
    return quotas[0];
  }

  // 创建新配额时，继承最近一天的 bonus_quota
  const latestBonus = await getLatestBonusQuota(userId, today);
  console.log(`[AI-Chat] Creating new daily quota for user ${userId}, carrying over latest bonus: ${latestBonus}`);

  const createResponse = await fetch(
    `${supabaseUrl}/rest/v1/ai_chat_quota`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        user_id: userId,
        date: today,
        base_quota: 10,
        bonus_quota: latestBonus,
        used_quota: 0
      })
    }
  );

  const newQuota = await createResponse.json();
  return newQuota[0];
}

// 消耗配额
async function consumeQuota(userId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  const today = new Date().toISOString().split('T')[0];
  
  // 使用 RPC 调用来原子性地增加 used_quota
  await fetch(
    `${supabaseUrl}/rest/v1/rpc/increment_ai_quota_used`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_date: today
      })
    }
  );
}

// 保存聊天历史
async function saveChatHistory(userId: string, userMessage: string, aiResponse: string, isBlocked: boolean, responseTime?: number) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/ai_chat_history`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userId,
          user_message: userMessage,
          ai_response: aiResponse,
          is_blocked: isBlocked,
          response_time: responseTime
        })
      }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[AI-Chat] Failed to save history:', error);
  }
}

// 调用阿里云通义千问
async function callQwenAI(userMessage: string): Promise<string> {
  const apiKey = Deno.env.get('DASHSCOPE_API_KEY');
  
  if (!apiKey) {
    throw new Error('AI服务未配置');
  }

  const response = await fetch(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        input: {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
          ]
        },
        parameters: {
          max_tokens: 1600,
          temperature: 0.7,
          top_p: 0.8,
          result_format: 'message'
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[AI-Chat] Qwen API error:', errorText);
    throw new Error('AI服务暂时不可用');
  }

  const data = await response.json();
  
  if (data?.output?.choices?.[0]?.message?.content) {
    let aiResponse = data.output.choices[0].message.content;
    // 限制长度
    if (aiResponse.length > 1600) {
      aiResponse = aiResponse.substring(0, 800) + '...';
    }
    return aiResponse;
  }

  throw new Error('AI响应格式错误');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { session_token, message } = body;

    console.log('[AI-Chat] Received request');

    if (!session_token) {
      throw new Error('未授权：缺少 session_token');
    }

    if (!message || typeof message !== 'string') {
      throw new Error('消息不能为空');
    }

    const trimmedMessage = message.trim();
    
    if (trimmedMessage.length === 0 || trimmedMessage.length > 1000) {
      throw new Error('消息长度必须在1-1000字符之间');
    }

    // 1. 验证用户
    const { userId } = await validateSession(session_token);
    console.log('[AI-Chat] User validated:', userId);

    // 2. 前置敏感词检查
    if (containsSensitiveContent(trimmedMessage)) {
      console.log('[AI-Chat] Blocked sensitive input from user:', userId);
      await saveChatHistory(userId, trimmedMessage, REFUSAL_MESSAGE, true);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'SENSITIVE_CONTENT',
          message: REFUSAL_MESSAGE
        }),
        { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
      );
    }

    // 3. 检查配额
    const quota = await getOrCreateQuota(userId);
    const totalQuota = quota.base_quota + quota.bonus_quota;
    const remainingQuota = totalQuota - quota.used_quota;

    if (remainingQuota <= 0) {
      console.log('[AI-Chat] User exceeded quota:', userId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'QUOTA_EXCEEDED',
          message: 'Шумо имрӯз ҳамаи саволҳоро истифода бурдед. Дӯстонро даъват кунед ё дар пулинг иштирок кунед!'
        }),
        { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
      );
    }

    // 4. 调用AI
    let aiResponse: string;
    try {
      aiResponse = await callQwenAI(trimmedMessage);
    } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
      console.error('[AI-Chat] AI call failed:', error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'AI_ERROR',
          message: 'Хатогӣ рух дод. Лутфан дубора кӯшиш кунед.'
        }),
        { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 500 }
      );
    }

    // 5. 后置敏感词检查
    let isBlocked = false;
    if (containsSensitiveContent(aiResponse)) {
      console.log('[AI-Chat] Blocked sensitive AI response for user:', userId);
      aiResponse = REFUSAL_MESSAGE;
      isBlocked = true;
    }

    // 6. 消耗配额
    await consumeQuota(userId);

    // 7. 保存历史
    const responseTime = Date.now() - startTime;
    await saveChatHistory(userId, trimmedMessage, aiResponse, isBlocked, responseTime);

    // 8. 返回结果
    const newRemainingQuota = remainingQuota - 1;
    console.log('[AI-Chat] Success, remaining quota:', newRemainingQuota);

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: {
          message: aiResponse,
          remaining_quota: newRemainingQuota
        }
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 200 }
    );

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[AI-Chat] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { "Content-Type": "application/json", ...corsHeaders }, status: 400 }
    );
  }
});
