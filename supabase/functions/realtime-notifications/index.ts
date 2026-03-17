import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get user_id from query parameters
    const url = new URL(req.url);
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response('user_id is required', { status: 400 });
    }

    // Create SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Send initial connection message
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`));

        // Create Supabase client
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // Subscribe to notification_queue changes for this user
        const channel = supabase
          .channel(`notifications:${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notification_queue',
              filter: `user_id=eq.${userId}`,
            },
            (payload) => {
              console.log('New notification:', payload);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  type: 'notification',
                  data: payload.new,
                  timestamp: new Date().toISOString()
                })}\n\n`)
              );
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'group_buy_sessions',
              filter: `initiator_id=eq.${userId}`,
            },
            (payload) => {
              console.log('Group buy session updated:', payload);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  type: 'group_buy_update',
                  data: payload.new,
                  timestamp: new Date().toISOString()
                })}\n\n`)
              );
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'wallets',
              filter: `user_id=eq.${userId}`,
            },
            (payload) => {
              console.log('Wallet balance updated:', payload);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  type: 'balance_update',
                  data: {
                    balance: payload.new.balance,
                    frozen_balance: payload.new.frozen_balance,
                    currency: payload.new.currency,
                  },
                  timestamp: new Date().toISOString()
                })}\n\n`)
              );
            }
          )
          .subscribe();

        // Send heartbeat every 30 seconds to keep connection alive
        const heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
            console.error('Heartbeat error:', error);
            clearInterval(heartbeatInterval);
          }
        }, 30000);

        // Cleanup on connection close
        req.signal.addEventListener('abort', () => {
          console.log(`Connection closed for user ${userId}`);
          clearInterval(heartbeatInterval);
          channel.unsubscribe();
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('Realtime notifications error:', error);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
