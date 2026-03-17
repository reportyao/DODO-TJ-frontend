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

    // Get user information (telegram_id and language preference)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('telegram_id, language_code')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      console.error('User not found:', userError);
      return createResponse({ 
        success: false, 
        error: 'User not found' 
      }, 404);
    }

    if (!user.telegram_id) {
      console.log(`User ${user_id} has no telegram_id, skipping notification`);
      return createResponse({ 
        success: true, 
        message: 'User has no telegram_id, notification skipped' 
      });
    }

    // Insert notification into queue with correct table structure
    const { error: insertError } = await supabase
      .from('notification_queue')
      .insert({
        // Required fields
        user_id: user_id,
        type: type,  // Required NOT NULL field
        payload: data || {},  // Required NOT NULL field
        // Optional fields
        telegram_chat_id: parseInt(user.telegram_id),
        notification_type: type,
        title: '',
        message: '',
        data: data || {},
        priority: priority,
        scheduled_at: new Date().toISOString(),
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        attempts: 0,
        channel: 'telegram',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Send telegram notification error:', error);
    return createResponse({ 
      success: false, 
      error: errMsg 
    }, 500);
  }
});
