import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

interface ReferralNode {
  id: string
  telegram_username: string
  first_name: string
  last_name: string
  telegram_id: string
  referral_code: string  // 统一使用 referral_code
  referred_by_id: string | null  // 统一使用 referred_by_id
  created_at: string
  children: ReferralNode[]
  stats: {
    level1_count: number
    level2_count: number
    level3_count: number
    total_commission: number
  }
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

    const { user_id } = await req.json()

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 获取用户信息
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single()

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 递归获取邀请树（最多3层）
    const buildReferralTree = async (userId: string, currentLevel: number = 0): Promise<ReferralNode> => {
      const { data: currentUser } = await supabaseClient
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()

      if (!currentUser) {
        throw new Error('User not found')
      }

      // 获取直接邀请的用户（兼容 referred_by_id 和 referrer_id 两个字段）
      const { data: children } = await supabaseClient
        .from('users')
        .select('*')
        .or(`referred_by_id.eq.${userId},referrer_id.eq.${userId}`)

      // 如果还没到3层，继续递归
      const childNodes: ReferralNode[] = []
      if (currentLevel < 2 && children && children.length > 0) {
        for (const child of children) {
          const childNode = await buildReferralTree(child.id, currentLevel + 1)
          childNodes.push(childNode)
        }
      }

      // 修复: 正确统计三级人脉
      // Level 1: 直接子节点数量
      const level1Count = childNodes.length
      
      // Level 2: 所有子节点的子节点数量总和
      let level2Count = 0
      childNodes.forEach(child => {
        level2Count += child.children.length
      })
      
      // Level 3: 所有孙节点的子节点数量总和
      let level3Count = 0
      childNodes.forEach(child => {
        child.children.forEach(grandchild => {
          level3Count += grandchild.children.length
        })
      })

      const stats = {
        level1_count: level1Count,
        level2_count: level2Count,
        level3_count: level3Count,
        total_commission: 0
      }

      // 获取返利统计（佣金总额）
      const { data: commissions } = await supabaseClient
        .from('commissions')
        .select('amount')
        .eq('user_id', userId)  // 修复: 使用 user_id 而不是 referred_by_id
        .eq('status', 'settled')  // 只统计已结算的佣金

      if (commissions) {
        stats.total_commission = commissions.reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0)
      }

      return {
        id: currentUser.id,
        telegram_username: currentUser.telegram_username,
        first_name: currentUser.first_name,
        last_name: currentUser.last_name,
        telegram_id: currentUser.telegram_id,
        referral_code: currentUser.referral_code || currentUser.invite_code || '',  // 统一使用 referral_code，兼容 invite_code
        referred_by_id: currentUser.referred_by_id || currentUser.referrer_id,  // 统一使用 referred_by_id，兼容 referrer_id
        created_at: currentUser.created_at,
        children: childNodes,
        stats
      }
    }

    const tree = await buildReferralTree(user_id)

    return new Response(
      JSON.stringify(tree),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('[GetReferralTree] Error:', error)
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
