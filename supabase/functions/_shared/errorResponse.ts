/**
 * ============================================================
 * 统一错误响应模块（所有 Edge Function 共享）
 * ============================================================
 * 
 * 提供标准化的错误响应格式，确保所有面向用户的 Edge Function
 * 返回一致的 JSON 结构，支持前端国际化翻译。
 * 
 * 标准错误响应格式：
 * {
 *   success: false,
 *   error: "中文回退消息",
 *   error_code: "ERR_XXX"
 * }
 * 
 * 前端 edgeFunctionHelper.ts 会优先提取 error_code 字段，
 * 通过 i18n 翻译为当前语言的错误提示。
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
}

/**
 * 创建标准化错误响应
 * @param errorCode - 标准化错误码，如 "ERR_INSUFFICIENT_BALANCE"
 * @param fallbackMessage - 中文回退消息（当前端翻译缺失时使用）
 * @param status - HTTP 状态码，默认 400
 * @param extraHeaders - 额外的响应头（可选）
 */
export function errorResponse(
  errorCode: string,
  fallbackMessage: string,
  status = 400,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: fallbackMessage,
      error_code: errorCode,
    }),
    {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        ...(extraHeaders || {}),
      },
      status,
    }
  )
}

/**
 * 将中文错误消息映射为标准化错误码
 * 
 * 用于兼容旧代码中 throw new Error('中文消息') 的模式，
 * 在 catch 块中将中文消息转换为错误码。
 * 
 * @param msg - 原始错误消息
 * @returns 标准化错误码
 */
export function mapErrorCode(msg: string): string {
  // 认证相关
  if (msg.includes('服务器配置错误')) {return 'ERR_SERVER_CONFIG';}
  if (msg.includes('缺少必要参数')) {return 'ERR_PARAMS_MISSING';}
  if (msg.includes('数量无效')) {return 'ERR_QUANTITY_INVALID';}
  if (msg.includes('未授权：缺少会话令牌')) {return 'ERR_MISSING_TOKEN';}
  if (msg.includes('未授权：缺少 session_token')) {return 'ERR_MISSING_SESSION';}
  if (msg.includes('未授权：缺少认证令牌')) {return 'ERR_MISSING_TOKEN';}
  if (msg.includes('未授权：无效的会话令牌')) {return 'ERR_INVALID_TOKEN';}
  if (msg.includes('未授权：无效的认证令牌')) {return 'ERR_INVALID_TOKEN';}
  if (msg.includes('未授权：会话不存在或已过期')) {return 'ERR_INVALID_SESSION';}
  if (msg.includes('未授权：会话不存在或已失效')) {return 'ERR_INVALID_SESSION';}
  if (msg.includes('未授权：会话已过期')) {return 'ERR_SESSION_EXPIRED';}
  if (msg.includes('未授权：用户不存在')) {return 'ERR_USER_NOT_FOUND';}
  if (msg.includes('验证会话失败')) {return 'ERR_SESSION_VALIDATE_FAILED';}
  if (msg.includes('缺少会话令牌')) {return 'ERR_MISSING_TOKEN';}

  // 用户相关
  if (msg.includes('用户不存在')) {return 'ERR_USER_NOT_FOUND';}
  if (msg.includes('获取用户信息失败')) {return 'ERR_USER_NOT_FOUND';}
  if (msg.includes('手机号和密码是必填项')) {return 'ERR_PHONE_PASSWORD_REQUIRED';}
  if (msg.includes('密码长度至少6位')) {return 'ERR_PASSWORD_TOO_SHORT';}
  if (msg.includes('手机号格式不正确')) {return 'ERR_PHONE_FORMAT_INVALID';}
  if (msg.includes('该手机号已被注册')) {return 'ERR_PHONE_ALREADY_USED';}
  if (msg.includes('该手机号已被其他账户使用')) {return 'ERR_PHONE_ALREADY_USED';}
  if (msg.includes('创建用户失败')) {return 'ERR_SERVER_ERROR';}
  if (msg.includes('创建钱包失败')) {return 'ERR_SERVER_ERROR';}
  if (msg.includes('注册成功但会话创建失败')) {return 'ERR_SESSION_CREATE_FAILED';}
  if (msg.includes('手机号不能为空')) {return 'ERR_PHONE_PASSWORD_REQUIRED';}
  if (msg.includes('新密码不能为空')) {return 'ERR_PHONE_PASSWORD_REQUIRED';}
  if (msg.includes('新密码长度至少6位')) {return 'ERR_PASSWORD_TOO_SHORT';}
  if (msg.includes('用户不存在或手机号未注册')) {return 'ERR_USER_NOT_FOUND';}
  if (msg.includes('密码重置失败')) {return 'ERR_SERVER_ERROR';}

  // 商品/抽奖相关
  if (msg.includes('商品不存在')) {return 'ERR_PRODUCT_NOT_FOUND';}
  if (msg.includes('库存不足')) {return 'ERR_OUT_OF_STOCK';}
  if (msg.includes('价格配置无效')) {return 'ERR_PRICE_CONFIG_INVALID';}
  if (msg.includes('抽奖活动不存在')) {return 'ERR_PRODUCT_NOT_FOUND';}
  if (msg.includes('抽奖活动已结束')) {return 'ERR_PRODUCT_NOT_FOUND';}
  if (msg.includes('该活动已结束')) {return 'ERR_LOTTERY_ENDED';}
  if (msg.includes('商品未在售中')) {return 'ERR_LOTTERY_ENDED';}
  if (msg.includes('超出最大购买限制')) {return 'ERR_MAX_PURCHASE_REACHED';}
  if (msg.includes('超出每人最大购买限制')) {return 'ERR_MAX_PURCHASE_REACHED';}

  // 钱包/余额相关
  if (msg.includes('余额不足')) {return 'ERR_INSUFFICIENT_BALANCE';}
  if (msg.includes('积分余额不足')) {return 'ERR_INSUFFICIENT_POINTS';}
  if (msg.includes('未找到用户钱包')) {return 'ERR_WALLET_NOT_FOUND';}
  if (msg.includes('获取钱包信息失败')) {return 'ERR_WALLET_INFO_FAILED';}
  if (msg.includes('冻结余额失败')) {return 'ERR_FREEZE_BALANCE_FAILED';}
  if (msg.includes('扣除余额失败')) {return 'ERR_FREEZE_BALANCE_FAILED';}
  if (msg.includes('钱包版本冲突')) {return 'ERR_CONCURRENT_OPERATION';}
  if (msg.includes('卖家钱包不存在')) {return 'ERR_WALLET_NOT_FOUND';}
  if (msg.includes('买家钱包不存在')) {return 'ERR_WALLET_NOT_FOUND';}
  if (msg.includes('增加卖家余额失败')) {return 'ERR_SERVER_ERROR';}

  // 充提现相关
  if (msg.includes('创建提现请求失败')) {return 'ERR_WITHDRAW_CREATE_FAILED';}
  if (msg.includes('充值金额必须大于0')) {return 'ERR_DEPOSIT_AMOUNT_INVALID';}
  if (msg.includes('提现金额必须大于0')) {return 'ERR_WITHDRAW_AMOUNT_INVALID';}
  if (msg.includes('金额必须大于0')) {return 'ERR_AMOUNT_INVALID';}

  // 兑换相关
  if (msg.includes('兑换金额必须大于0')) {return 'ERR_EXCHANGE_AMOUNT_INVALID';}
  if (msg.includes('无效的兑换类型')) {return 'ERR_EXCHANGE_TYPE_INVALID';}
  if (msg.includes('未找到源钱包')) {return 'ERR_SOURCE_WALLET_NOT_FOUND';}
  if (msg.includes('未找到目标钱包')) {return 'ERR_TARGET_WALLET_NOT_FOUND';}
  if (msg.includes('源钱包不存在')) {return 'ERR_SOURCE_WALLET_NOT_FOUND';}
  if (msg.includes('目标钱包不存在')) {return 'ERR_TARGET_WALLET_NOT_FOUND';}
  if (msg.includes('源钱包和目标钱包类型必须不同')) {return 'ERR_SAME_WALLET_TYPE';}
  if (msg.includes('兑换操作失败')) {return 'ERR_EXCHANGE_FAILED';}
  if (msg.includes('兑换操作缺少目标钱包类型')) {return 'ERR_EXCHANGE_WALLET_MISSING';}
  if (msg.includes('无效的目标钱包类型')) {return 'ERR_EXCHANGE_WALLET_MISSING';}

  // 转售相关
  if (msg.includes('票据不存在或不属于您')) {return 'ERR_TICKET_NOT_FOUND';}
  if (msg.includes('该票据已在转售中')) {return 'ERR_TICKET_ALREADY_RESALE';}
  if (msg.includes('转售商品不存在')) {return 'ERR_RESALE_ITEM_NOT_FOUND';}
  if (msg.includes('该商品已下架或已售出')) {return 'ERR_RESALE_ITEM_UNAVAILABLE';}
  if (msg.includes('不能购买自己的商品')) {return 'ERR_CANNOT_BUY_OWN';}
  if (msg.includes('缺少转售商品ID')) {return 'ERR_RESALE_ID_MISSING';}
  if (msg.includes('记录不存在或不属于您')) {return 'ERR_RECORD_NOT_FOUND';}

  // 奖品/提货相关
  if (msg.includes('未找到奖品记录')) {return 'ERR_PRIZE_NOT_FOUND';}
  if (msg.includes('您不是该抽奖的中奖者')) {return 'ERR_NOT_WINNER';}
  if (msg.includes('创建奖品记录失败')) {return 'ERR_PRIZE_CREATE_FAILED';}
  if (msg.includes('生成提货码失败')) {return 'ERR_PICKUP_CODE_FAILED';}
  if (msg.includes('自提点不存在或不可用')) {return 'ERR_PICKUP_POINT_NOT_FOUND';}

  // 地推相关
  if (msg.includes('您不是地推人员')) {return 'ERR_NOT_PROMOTER';}
  if (msg.includes('您的地推人员账号未激活')) {return 'ERR_PROMOTER_INACTIVE';}

  // 通用
  if (msg.includes('搜索关键词不能为空')) {return 'ERR_SEARCH_KEYWORD_EMPTY';}
  if (msg.includes('目标用户ID不能为空')) {return 'ERR_PARAMS_MISSING';}
  if (msg.includes('无效的操作')) {return 'ERR_INVALID_ACTION';}
  if (msg.includes('创建订单失败')) {return 'ERR_ORDER_CREATE_FAILED';}
  if (msg.includes('分配票失败')) {return 'ERR_TICKET_ALLOCATE_FAILED';}
  if (msg.includes('支付失败')) {return 'ERR_PAYMENT_FAILED';}
  if (msg.includes('创建重置Token失败')) {return 'ERR_SERVER_ERROR';}
  if (msg.includes('密码更新失败')) {return 'ERR_SERVER_ERROR';}
  if (msg.includes('手机号更新失败')) {return 'ERR_SERVER_ERROR';}
  if (msg.includes('更新失败')) {return 'ERR_SERVER_ERROR';}
  if (msg.includes('操作失败')) {return 'ERR_CONCURRENT_OPERATION';}

  // 个人资料相关
  if (msg.includes('昵称不能为空')) {return 'ERR_NICKNAME_EMPTY';}
  if (msg.includes('昵称长度不能超过')) {return 'ERR_NICKNAME_TOO_LONG';}
  if (msg.includes('头像URL格式不正确')) {return 'ERR_AVATAR_URL_INVALID';}
  if (msg.includes('更新个人资料失败')) {return 'ERR_PROFILE_UPDATE_FAILED';}

  return 'ERR_SERVER_ERROR';
}

/**
 * 根据错误码返回合适的 HTTP 状态码
 * 
 * 业务错误（参数错误、余额不足、权限不足等）返回 4xx，
 * 仅真正的服务器内部错误返回 500。
 * 避免前端错误监控将业务错误误报为「服务器内部错误」。
 * 
 * @param errorCode - 标准化错误码
 * @returns HTTP 状态码
 */
export function getHttpStatusForErrorCode(errorCode: string): number {
  // 认证/授权类 → 401
  if (['ERR_MISSING_TOKEN', 'ERR_MISSING_SESSION', 'ERR_INVALID_TOKEN',
       'ERR_INVALID_SESSION', 'ERR_SESSION_EXPIRED', 'ERR_SESSION_VALIDATE_FAILED',
       'ERR_SESSION_CREATE_FAILED', 'ERR_WRONG_CREDENTIALS'].includes(errorCode)) {
    return 401;
  }
  // 资源不存在 → 404
  if (['ERR_PRODUCT_NOT_FOUND', 'ERR_USER_NOT_FOUND', 'ERR_WALLET_NOT_FOUND',
       'ERR_TICKET_NOT_FOUND', 'ERR_RESALE_ITEM_NOT_FOUND', 'ERR_PRIZE_NOT_FOUND',
       'ERR_RECORD_NOT_FOUND', 'ERR_SOURCE_WALLET_NOT_FOUND', 'ERR_TARGET_WALLET_NOT_FOUND',
       'ERR_PICKUP_POINT_NOT_FOUND'].includes(errorCode)) {
    return 404;
  }
  // 并发冲突 → 409
  if (['ERR_CONCURRENT_OPERATION', 'ERR_TICKET_ALREADY_RESALE',
       'ERR_PHONE_ALREADY_USED'].includes(errorCode)) {
    return 409;
  }
  // 余额不足/业务限制 → 422
  if (['ERR_INSUFFICIENT_BALANCE', 'ERR_INSUFFICIENT_POINTS',
       'ERR_OUT_OF_STOCK', 'ERR_FREEZE_BALANCE_FAILED',
       'ERR_NOT_WINNER', 'ERR_CANNOT_BUY_OWN', 'ERR_NOT_PROMOTER',
       'ERR_PROMOTER_INACTIVE', 'ERR_RESALE_ITEM_UNAVAILABLE',
       'ERR_LOTTERY_ENDED', 'ERR_MAX_PURCHASE_REACHED'].includes(errorCode)) {
    return 422;
  }
  // 参数错误 → 400
  if (['ERR_PARAMS_MISSING', 'ERR_QUANTITY_INVALID', 'ERR_PRICE_CONFIG_INVALID',
       'ERR_DEPOSIT_AMOUNT_INVALID', 'ERR_WITHDRAW_AMOUNT_INVALID', 'ERR_AMOUNT_INVALID',
       'ERR_EXCHANGE_AMOUNT_INVALID', 'ERR_EXCHANGE_TYPE_INVALID', 'ERR_SAME_WALLET_TYPE',
       'ERR_EXCHANGE_WALLET_MISSING', 'ERR_RESALE_ID_MISSING', 'ERR_SEARCH_KEYWORD_EMPTY',
       'ERR_PHONE_PASSWORD_REQUIRED', 'ERR_PASSWORD_TOO_SHORT', 'ERR_PHONE_FORMAT_INVALID',
       'ERR_NICKNAME_EMPTY', 'ERR_NICKNAME_TOO_LONG', 'ERR_AVATAR_URL_INVALID',
       'ERR_INVALID_ACTION'].includes(errorCode)) {
    return 400;
  }
  // 服务器内部操作失败（非用户可控）→ 500
  if (['ERR_SERVER_ERROR', 'ERR_SERVER_CONFIG', 'ERR_ORDER_CREATE_FAILED',
       'ERR_TICKET_ALLOCATE_FAILED', 'ERR_PAYMENT_FAILED', 'ERR_EXCHANGE_FAILED',
       'ERR_PICKUP_CODE_FAILED', 'ERR_PRIZE_CREATE_FAILED',
       'ERR_PROFILE_UPDATE_FAILED', 'ERR_WALLET_INFO_FAILED',
       'ERR_WITHDRAW_CREATE_FAILED'].includes(errorCode)) {
    return 500;
  }
  // 兜底：未知错误码也返回 500
  return 500;
}
