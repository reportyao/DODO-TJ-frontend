/**
 * 创建发货批次 Edge Function
 * 
 * 功能：创建新的发货批次
 * 权限：仅管理员可调用
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

interface CreateBatchRequest {
  china_tracking_no?: string
  tajikistan_tracking_no?: string
  estimated_arrival_date?: string
  admin_note?: string
  admin_id: string
}

serve(async (req) => {
  // 处理CORS预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body: CreateBatchRequest = await req.json()
    const { china_tracking_no, tajikistan_tracking_no, estimated_arrival_date, admin_note, admin_id } = body

    if (!admin_id) {
      return new Response(
        JSON.stringify({ success: false, error: '缺少管理员ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 验证管理员权限
    const { data: adminUser, error: adminError } = await supabase
      .from('admin_users')
      .select('id, role, status')
      .eq('id', admin_id)
      .single()

    if (adminError || !adminUser) {
      console.error('Admin verification error:', adminError)
      return new Response(
        JSON.stringify({ success: false, error: '无效的管理员: ' + (adminError?.message || '未找到管理员') }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (adminUser.status !== 'active') {
      return new Response(
        JSON.stringify({ success: false, error: '管理员账户已被禁用' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 生成批次号
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
    
    // 获取今天的批次序号
    const { data: existingBatches, error: countError } = await supabase
      .from('shipment_batches')
      .select('batch_no')
      .like('batch_no', `BATCH-${dateStr}-%`)
      .order('batch_no', { ascending: false })
      .limit(1)

    let seqNum = 1
    if (existingBatches && existingBatches.length > 0) {
      const lastBatchNo = existingBatches[0].batch_no
      const match = lastBatchNo.match(/BATCH-\d{8}-(\d+)/)
      if (match) {
        seqNum = parseInt(match[1]) + 1
      }
    }

    const batchNo = `BATCH-${dateStr}-${seqNum.toString().padStart(2, '0')}`

    // 创建批次
    const { data: batch, error: createError } = await supabase
      .from('shipment_batches')
      .insert({
        batch_no: batchNo,
        china_tracking_no: china_tracking_no || null,
        tajikistan_tracking_no: tajikistan_tracking_no || null,
        status: 'IN_TRANSIT_CHINA',
        shipped_at: new Date().toISOString(),
        estimated_arrival_date: estimated_arrival_date || null,
        admin_note: admin_note || null,
        created_by: admin_id,
      })
      .select()
      .single()

    if (createError) {
      console.error('Create batch error:', createError)
      return new Response(
        JSON.stringify({ success: false, error: '创建批次失败: ' + createError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: batch,
        message: `批次 ${batchNo} 创建成功`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ success: false, error: '服务器内部错误' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
