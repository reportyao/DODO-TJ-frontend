import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, listing_id, user_id, data } = await req.json()

    switch (action) {
      case 'create': {
        // 创建转售
        const { lottery_entry_id, selling_price } = data

        // 验证彩票归属和状态
        const { data: entry, error: entryError } = await supabaseClient
          .from('lottery_entries')
          .select('*, lottery:lotteries(*)')
          .eq('id', lottery_entry_id)
          .eq('user_id', user_id)
          .single()

        if (entryError || !entry) {
          return new Response(
            JSON.stringify({ error: 'Invalid lottery entry or not owned by user' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }

        // 检查是否已开奖
        if (entry.lottery.status === 'COMPLETED') {
          return new Response(
            JSON.stringify({ error: 'Cannot sell tickets for drawn lotteries' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }

        // 检查是否已经在转售
        const { data: existingListing } = await supabaseClient
          .from('market_listings')
          .select('id')
          .eq('ticket_id', lottery_entry_id)
          .eq('status', 'AVAILABLE')
          .single()

        if (existingListing) {
          return new Response(
            JSON.stringify({ error: 'Ticket already listed for sale' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }

        // 获取原始价格
        const originalPrice = entry.lottery.ticket_price

        // 创建转售记录
        // 注意: market_listings 表实际列名为 ticket_id (非 lottery_entry_id), price (非 selling_price)
        const { data: listing, error: listingError } = await supabaseClient
          .from('market_listings')
          .insert({
            seller_id: user_id,
            ticket_id: lottery_entry_id,
            lottery_id: entry.lottery_id,
            original_price: originalPrice,
            price: selling_price,
            status: 'AVAILABLE'
          })
          .select()
          .single()

        if (listingError) {
          throw listingError
        }

        return new Response(
          JSON.stringify({ success: true, listing }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'purchase': {
        // ========== 购买转售彩票 - 使用原子化 RPC 函数 ==========
        // 替代原来的多步非原子操作，使用数据库事务保证：
        // 资金转移 + 彩票转移 + 状态更新 全部在同一事务中完成
        console.log('[Market] Purchase request:', { listing_id, user_id });

        if (!listing_id || !user_id) {
          return new Response(
            JSON.stringify({ error: 'Missing listing_id or user_id' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }

        const { data: result, error: rpcError } = await supabaseClient
          .rpc('market_purchase_atomic', {
            p_buyer_id: user_id,
            p_listing_id: listing_id
          });

        if (rpcError) {
          console.error('[Market] RPC error:', rpcError);
          return new Response(
            JSON.stringify({ error: 'Purchase failed, please try again' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          )
        }

        if (!result.success) {
          console.error('[Market] RPC returned error:', result.error);
          // 根据错误类型返回不同的 HTTP 状态码
          const isClientError = ['Listing not found or already sold', 'Cannot purchase your own listing', 'Insufficient balance'].includes(result.error);
          return new Response(
            JSON.stringify({ error: result.error }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: isClientError ? 400 : 500 }
          )
        }

        console.log('[Market] Purchase completed via RPC:', {
          price: result.price,
          buyer_new_balance: result.buyer_new_balance
        });

        return new Response(
          JSON.stringify({ success: true, message: 'Purchase completed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'cancel': {
        // 取消转售
        const { data: listing, error: listingError } = await supabaseClient
          .from('market_listings')
          .select('*')
          .eq('id', listing_id)
          .eq('seller_id', user_id)
          .eq('status', 'AVAILABLE')
          .single()

        if (listingError || !listing) {
          return new Response(
            JSON.stringify({ error: 'Listing not found or cannot be cancelled' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }

        await supabaseClient
          .from('market_listings')
          .update({
            status: 'CANCELLED',
            updated_at: new Date().toISOString()
          })
          .eq('id', listing_id)

        return new Response(
          JSON.stringify({ success: true, message: 'Listing cancelled' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }

  } catch (error) {
    console.error('Error in market-manage function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
