import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Helper function to create response with CORS headers
function createResponse(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { user_id, type, data, priority = 2 } = await req.json();

    if (!user_id || !type) {
      return createResponse({ 
        success: false, 
        error: 'user_id and type are required' 
      }, 400);
    }

    // 【迁移修复】查询 phone_number 和语言偏好（替代原来的 telegram_id）
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('phone_number, preferred_language, language_code')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      console.error('User not found:', userError);
      return createResponse({ 
        success: false, 
        error: 'User not found' 
      }, 404);
    }

    if (!user.phone_number) {
      console.log(`User ${user_id} has no phone_number, skipping notification`);
      return createResponse({ 
        success: true, 
        message: 'User has no phone_number, notification skipped' 
      });
    }

    // 【迁移修复】写入通知队列，使用 phone_number 替代 telegram_chat_id
    const now = new Date().toISOString();
    const { error: insertError } = await supabase
      .from('notification_queue')
      .insert({
        user_id: user_id,
        phone_number: user.phone_number,
        type: type,
        notification_type: type,
        payload: data || {},
        title: '',
        message: '',
        data: data || {},
        priority: priority,
        scheduled_at: now,
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        attempts: 0,
        channel: 'whatsapp',
        created_at: now,
        updated_at: now,
      });

    if (insertError) {
      console.error('Failed to insert notification:', insertError);
      return createResponse({ 
        success: false, 
        error: 'Failed to queue notification: ' + insertError.message 
      }, 500);
    }

    console.log(`Notification queued for user ${user_id}, type: ${type}`);

    return createResponse({
      success: true,
      message: 'Notification queued successfully'
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Send notification error:', error);
    return createResponse({ 
      success: false, 
      error: errMsg 
    }, 500);
  }
});
