import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-admin-id',
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

    const { action, showoff_id, user_id, data } = await req.json()

    // 管理员操作（approve/reject）需要 admin 认证
    const adminOnlyActions = ['approve', 'reject']
    if (adminOnlyActions.includes(action)) {
      const adminId = req.headers.get('x-admin-id')
      if (!adminId) {
        return new Response(
          JSON.stringify({ error: '未授权：需要管理员权限' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        )
      }
      const { data: adminUser, error: adminError } = await supabaseClient
        .from('admin_users')
        .select('id, status')
        .eq('id', adminId)
        .single()
      if (adminError || !adminUser || adminUser.status !== 'active') {
        return new Response(
          JSON.stringify({ error: '管理员认证失败' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        )
      }
    }

    // 用户操作（create/like/comment）需要 session_token 验证
    const userOnlyActions = ['create', 'like', 'comment']
    if (userOnlyActions.includes(action) && user_id) {
      const sessionToken = req.headers.get('x-session-token')
      if (sessionToken) {
        const { data: session, error: sessionError } = await supabaseClient
          .from('user_sessions')
          .select('user_id')
          .eq('session_token', sessionToken)
          .eq('user_id', user_id)
          .gt('expires_at', new Date().toISOString())
          .single()
        if (sessionError || !session) {
          return new Response(
            JSON.stringify({ error: '用户认证失败' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
          )
        }
      }
    }

    switch (action) {
      case 'create': {
        // 创建晒单
        const { lottery_entry_id, content, images } = data

        // 验证用户是否真的中奖
        const { data: entry, error: entryError } = await supabaseClient
          .from('lottery_entries')
          .select('*, lottery:lotteries(*)')
          .eq('id', lottery_entry_id)
          .eq('user_id', user_id)
          .eq('is_winning', true)
          .single()

        if (entryError || !entry) {
          return new Response(
            JSON.stringify({ error: 'Invalid lottery entry or not a winner' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }

        // 检查是否已经晒过单
        const { data: existing } = await supabaseClient
          .from('showoffs')
          .select('id')
          .eq('lottery_entry_id', lottery_entry_id)
          .single()

        if (existing) {
          return new Response(
            JSON.stringify({ error: 'Already created showoff for this entry' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }

        // 创建晒单记录
        const { data: showoff, error: showoffError } = await supabaseClient
          .from('showoffs')
          .insert({
            user_id,
            lottery_entry_id,
            lottery_id: entry.lottery_id,
            content,
            images,
            image_urls: images, // 同时写入两个字段以兼容不同的数据库 schema
            status: 'PENDING', // 待审核
            likes_count: 0,
            comments_count: 0
          })
          .select()
          .single()

        if (showoffError) {
          throw showoffError
        }

        return new Response(
          JSON.stringify({ success: true, showoff }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'like': {
        // 点赞/取消点赞
        const { data: existingLike } = await supabaseClient
          .from('showoff_likes')
          .select('id')
          .eq('showoff_id', showoff_id)
          .eq('user_id', user_id)
          .single()

        if (existingLike) {
          // 取消点赞
          await supabaseClient
            .from('showoff_likes')
            .delete()
            .eq('id', existingLike.id)

          await supabaseClient.rpc('decrement_showoff_likes', {
            showoff_id_param: showoff_id
          })

          return new Response(
            JSON.stringify({ success: true, action: 'unliked' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        } else {
          // 点赞
          await supabaseClient
            .from('showoff_likes')
            .insert({
              showoff_id,
              user_id
            })

          await supabaseClient.rpc('increment_showoff_likes', {
            showoff_id_param: showoff_id
          })

          // 发送通知给晒单作者
          const { data: showoff } = await supabaseClient
            .from('showoffs')
            .select('user_id')
            .eq('id', showoff_id)
            .single()

          if (showoff && showoff.user_id !== user_id) {
            await supabaseClient
              .from('notifications')
              .insert({
                user_id: showoff.user_id,
                type: 'SHOWOFF_LIKE',
                title: '收到点赞',
                content: '有人赞了你的晒单',
                related_id: showoff_id,
                related_type: 'showoff',
                is_read: false
              })
          }

          return new Response(
            JSON.stringify({ success: true, action: 'liked' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      case 'comment': {
        // 评论
        const { content } = data

        const { data: comment, error: commentError } = await supabaseClient
          .from('showoff_comments')
          .insert({
            showoff_id,
            user_id,
            content
          })
          .select()
          .single()

        if (commentError) {
          throw commentError
        }

        await supabaseClient.rpc('increment_showoff_comments', {
          showoff_id_param: showoff_id
        })

        // 发送通知给晒单作者
        const { data: showoff } = await supabaseClient
          .from('showoffs')
          .select('user_id')
          .eq('id', showoff_id)
          .single()

        if (showoff && showoff.user_id !== user_id) {
          await supabaseClient
            .from('notifications')
            .insert({
              user_id: showoff.user_id,
              type: 'SHOWOFF_COMMENT',
              title: '收到评论',
              content: content.substring(0, 50),
              related_id: showoff_id,
              related_type: 'showoff',
              is_read: false
            })
        }

        return new Response(
          JSON.stringify({ success: true, comment }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'approve': {
        // 审核通过(管理员操作)
        const { error: updateError } = await supabaseClient
          .from('showoffs')
          .update({
            status: 'APPROVED',
            approved_at: new Date().toISOString()
          })
          .eq('id', showoff_id)

        if (updateError) {
          throw updateError
        }

        // 发送通知给用户
        const { data: showoff } = await supabaseClient
          .from('showoffs')
          .select('user_id')
          .eq('id', showoff_id)
          .single()

        if (showoff) {
          await supabaseClient
            .from('notifications')
            .insert({
              user_id: showoff.user_id,
              type: 'SHOWOFF_APPROVED',
              title: '晒单审核通过',
              content: '您的晒单已通过审核,现在可以被其他用户看到了',
              related_id: showoff_id,
              related_type: 'showoff',
              is_read: false
            })
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Showoff approved' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'reject': {
        // 审核拒绝(管理员操作)
        const { reason } = data

        const { error: updateError } = await supabaseClient
          .from('showoffs')
          .update({
            status: 'REJECTED',
            rejected_reason: reason
          })
          .eq('id', showoff_id)

        if (updateError) {
          throw updateError
        }

        // 发送通知给用户
        const { data: showoff } = await supabaseClient
          .from('showoffs')
          .select('user_id')
          .eq('id', showoff_id)
          .single()

        if (showoff) {
          await supabaseClient
            .from('notifications')
            .insert({
              user_id: showoff.user_id,
              type: 'SHOWOFF_REJECTED',
              title: '晒单审核未通过',
              content: reason || '您的晒单未通过审核',
              related_id: showoff_id,
              related_type: 'showoff',
              is_read: false
            })
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Showoff rejected' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error in showoff-manage function:', error)
    return new Response(
      JSON.stringify({ error: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
