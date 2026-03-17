import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-admin-id',
}

serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ========== 管理员认证 ==========
    const adminId = req.headers.get('x-admin-id')
    const authHeader = req.headers.get('Authorization')
    
    let adminUserId: string | null = null
    
    // 方式1: 通过 x-admin-id 头部认证（管理后台使用）
    if (adminId) {
      const { data: adminUser, error: adminError } = await supabaseClient
        .from('admin_users')
        .select('id, status, role')
        .eq('id', adminId)
        .single()
      
      if (adminError || !adminUser || adminUser.status !== 'active') {
        throw new Error('管理员认证失败')
      }
      adminUserId = adminUser.id
    }
    // 方式2: 通过 Supabase Auth token 认证（兼容旧方式）
    else if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
      
      if (!userError && user) {
        adminUserId = user.id
      }
    }
    
    if (!adminUserId) {
      throw new Error('未授权: 需要管理员权限')
    }

    // ========== 解析请求参数 ==========
    const {
      display_username,    // 虚拟用户昵称 (必填)
      display_avatar_url,  // 虚拟用户头像URL (必填)
      content,             // 晒单文案 (必填)
      images,              // 图片URL数组 (必填)
      lottery_id,          // 关联商品ID (可选)
      title,               // 晒单标题 (可选，用于覆盖商品标题)
      reward_coins,        // 奖励积分 (可选)
      likes_count,         // 初始点赞数 (可选)
      created_at,          // 自定义发布时间 (可选)
    } = await req.json()

    // ========== 参数验证 ==========
    if (!display_username || display_username.trim() === '') {
      throw new Error('虚拟用户昵称不能为空')
    }

    if (!display_avatar_url || display_avatar_url.trim() === '') {
      throw new Error('虚拟用户头像不能为空')
    }

    if (!content || content.trim() === '') {
      throw new Error('晒单文案不能为空')
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('至少需要上传一张图片')
    }

    if (images.length > 9) {
      throw new Error('最多只能上传9张图片')
    }

    // ========== 验证关联商品 (如果提供) ==========
    let lotteryTitle: string | null = null
    let lotteryTitleI18n: Record<string, string> | null = null
    let finalLotteryId: string | null = null
    let finalInventoryProductId: string | null = null
    if (lottery_id) {
      // 先尝试从库存商品表查找
      const { data: product, error: productError } = await supabaseClient
        .from('inventory_products')
        .select('id, name, name_i18n')
        .eq('id', lottery_id)
        .single()

      if (!productError && product) {
        // 如果是库存商品,则不设置lottery_id(因为外键约束指向lotteries表)
        lotteryTitle = product.name
        lotteryTitleI18n = product.name_i18n || null
        finalLotteryId = null
        finalInventoryProductId = product.id // 存储库存商品ID，便于前端查询商品名称
      } else {
        // 回退到 lotteries 表查找(兼容旧数据)
        const { data: lottery, error: lotteryError } = await supabaseClient
          .from('lotteries')
          .select('id, title, title_i18n')
          .eq('id', lottery_id)
          .single()

        if (lotteryError || !lottery) {
          throw new Error('关联的商品不存在')
        }
        lotteryTitle = lottery.title
        lotteryTitleI18n = lottery.title_i18n || null
        finalLotteryId = lottery.id
      }
    }

    // ========== 生成随机数据 (如果未提供) ==========
    const finalLikesCount = likes_count !== undefined && likes_count !== null 
      ? Math.max(0, parseInt(likes_count) || 0)
      : Math.floor(Math.random() * 80) + 20  // 随机 20-100

    const finalRewardCoins = reward_coins !== undefined && reward_coins !== null
      ? Math.max(0, parseInt(reward_coins) || 0)
      : 0

    // 处理发布时间
    const finalCreatedAt = created_at 
      ? new Date(created_at).toISOString()
      : new Date().toISOString()

    // ========== 创建运营晒单记录 ==========
    const showoffData = {
      // 运营晒单标识
      source: 'ADMIN',
      user_id: null,  // 运营晒单没有真实用户

      // 虚拟用户信息
      display_username: display_username.trim(),
      display_avatar_url: display_avatar_url.trim(),

      // 晒单内容
      content: content.trim(),
      images: images,
      image_urls: images, // 同时写入两个字段以兼容不同的数据库 schema
      // 标题优先级: 管理员自定义标题 > 关联商品名称
      title: title?.trim() || lotteryTitle || null,
      // 存储多语言标题，供前端国际化显示
      title_i18n: lotteryTitleI18n || null,

      // 关联信息
      lottery_id: finalLotteryId,
      inventory_product_id: finalInventoryProductId,

      // 状态信息
      status: 'APPROVED',  // 运营晒单直接批准
      reviewed_at: new Date().toISOString(),

      // 奖励和互动数据
      reward_coins: finalRewardCoins,
      likes_count: finalLikesCount,

      // 时间戳
      created_at: finalCreatedAt,
      updated_at: new Date().toISOString(),

      // 管理员备注
      admin_note: `运营晒单 - 由管理员 ${adminUserId} 创建`,
    }

    const { data: newShowoff, error: insertError } = await supabaseClient
      .from('showoffs')
      .insert(showoffData)
      .select()
      .single()

    if (insertError) {
      console.error('创建运营晒单失败:', insertError)
      throw new Error(`创建失败: ${insertError.message}`)
    }

    // ========== 记录管理员操作日志 ==========
    await supabaseClient.from('admin_audit_logs').insert({
      admin_id: adminUserId,
      action: 'CREATE_OPERATIONAL_SHOWOFF',
      resource_type: 'showoff',
      resource_id: newShowoff.id,
      details: {
        display_username,
        lottery_id,
        lottery_title: lotteryTitle,
        images_count: images.length,
        likes_count: finalLikesCount,
        reward_coins: finalRewardCoins,
      },
    })

    // ========== 返回成功响应 ==========
    return new Response(
      JSON.stringify({
        success: true,
        message: '运营晒单创建成功',
        data: {
          id: newShowoff.id,
          display_username: newShowoff.display_username,
          lottery_id: newShowoff.lottery_id,
          likes_count: newShowoff.likes_count,
          reward_coins: newShowoff.reward_coins,
          created_at: newShowoff.created_at,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? errMsg : String(error);
    console.error('创建运营晒单错误:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: errMsg || '创建运营晒单失败',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
