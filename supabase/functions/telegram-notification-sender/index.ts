/**
 * WhatsApp 通知发送器（阿里云 ChatApp API 方案）
 *
 * 功能说明：
 *   - 消费 notification_queue 表中 status='pending' 的通知
 *   - 仅处理以下通知类型：
 *       1. promoter_deposit  — 地推充值到账（含赠送积分）
 *       2. wallet_deposit    — 普通充值到账
 *       3. batch_arrived     — 提货码通知（商品到达自提点）
 *       4. lottery_result    — 开奖中奖通知
 *   - 其他类型的通知直接标记为 skipped，不发送
 *   - 使用阿里云 CAMS SendChatappMessage API（V3 签名 ACS3-HMAC-SHA256）
 *
 * 环境变量（需在 Supabase Dashboard → Edge Functions → Secrets 中配置）：
 *   ALIYUN_ACCESS_KEY_ID       阿里云 AccessKey ID
 *   ALIYUN_ACCESS_KEY_SECRET   阿里云 AccessKey Secret
 *   ALIYUN_CAMS_FROM           WhatsApp 发送号码（E.164 格式，如 +992XXXXXXXXX）
 *   ALIYUN_CAMS_CUST_SPACE_ID  阿里云 CAMS 实例 ID（CustSpaceId）
 *   ALIYUN_CAMS_TEMPLATE_DEPOSIT   充值到账模板 Code（在阿里云 CAMS 控制台获取）
 *   ALIYUN_CAMS_TEMPLATE_PICKUP    提货码模板 Code（在阿里云 CAMS 控制台获取）
 *   ALIYUN_CAMS_TEMPLATE_LOTTERY   开奖通知模板 Code（在阿里云 CAMS 控制台获取）
 *   ALIYUN_CAMS_REGION         API 区域，默认 ap-southeast-1
 *
 * 模板说明（需在阿里云 CAMS 控制台预先创建并审核通过）：
 *
 *   充值到账模板（ALIYUN_CAMS_TEMPLATE_DEPOSIT）：
 *     模板内容示例（三语言各一个模板）：
 *       中文: 您好，您的钱包已到账 {{1}} TJS。{{2}}
 *             {{2}} 为空时不显示；有赠送时填写"另赠 {{bonus}} 积分"
 *       俄文: Здравствуйте, на ваш кошелёк зачислено {{1}} TJS. {{2}}
 *       塔语: Ассалому алейкум, ба ҳисоби шумо {{1}} TJS ворид шуд. {{2}}
 *     变量：{{1}} = 充值金额, {{2}} = 赠送积分说明（可为空）
 *
 *   提货码模板（ALIYUN_CAMS_TEMPLATE_PICKUP）：
 *     模板内容示例：
 *       中文: 您的商品「{{1}}」已到达自提点「{{2}}」，提货码：{{3}}，有效期至 {{4}}。
 *       俄文: Ваш товар «{{1}}» прибыл в пункт выдачи «{{2}}». Код получения: {{3}}, действителен до {{4}}.
 *       塔语: Моли шумо «{{1}}» ба нуқтаи гирифтан «{{2}}» расид. Рамзи гирифтан: {{3}}, то {{4}}.
 *     变量：{{1}} = 商品名, {{2}} = 自提点名称, {{3}} = 提货码, {{4}} = 有效期
 *
 * 注意：
 *   - 阿里云 CAMS 模板消息按条计费，请在控制台确认费率
 *   - 每种语言需要单独的模板（zh/ru/tg 各一套），或使用多语言模板
 *   - 如果用户语言不在支持列表中，默认使用 tg（塔吉克语）
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// 类型定义
// ============================================================

interface NotificationRecord {
  id: string;
  user_id: string;
  phone_number: string;
  notification_type: string;
  message: string;
  data: Record<string, unknown>;
  channel: string;
  status: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
}

interface AliyunConfig {
  accessKeyId: string;
  accessKeySecret: string;
  from: string;
  custSpaceId: string;
  templateDeposit: string;
  templatePickup: string;
  templateGroupBuyWin: string;
  templateLottery: string;
  region: string;
  endpoint: string;
}

// 支持的通知类型白名单
const SUPPORTED_NOTIFICATION_TYPES = new Set([
  'promoter_deposit',  // 地推充值到账（含赠送积分）
  'wallet_deposit',    // 普通充值到账
  'batch_arrived',     // 提货码通知
  'group_buy_win',     // 包团成功通知
  'lottery_result',    // 开奖中奖通知
]);

// 语言代码映射（用户 preferred_language → WhatsApp 语言代码）
const LANGUAGE_CODE_MAP: Record<string, string> = {
  zh: 'zh_CN',
  ru: 'ru',
  tg: 'tg',  // 塔吉克语，如阿里云不支持则回退到 ru
};

// ============================================================
// 阿里云 V3 签名实现（ACS3-HMAC-SHA256）
// ============================================================

/**
 * 计算 SHA-256 哈希（返回小写十六进制字符串）
 */
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 计算 HMAC-SHA256（返回 Uint8Array）
 */
async function hmacSha256(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const dataBytes = new TextEncoder().encode(data);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
  return new Uint8Array(signature);
}

/**
 * 将 Uint8Array 转为小写十六进制字符串
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 生成随机 nonce（32位十六进制）
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * 构造阿里云 V3 签名请求头
 *
 * 参考文档：https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
 *
 * 签名流程：
 *   1. 构造规范化请求（CanonicalRequest）
 *   2. 构造待签字符串（StringToSign）
 *   3. 计算签名（HMAC-SHA256）
 *   4. 构造 Authorization 头
 */
async function buildAliyunV3Headers(
  config: AliyunConfig,
  action: string,
  apiVersion: string,
  requestBody: string
): Promise<Record<string, string>> {
  const now = new Date();
  // ISO 8601 UTC 格式：yyyy-MM-ddTHH:mm:ssZ
  const xAcsDate = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = generateNonce();

  // Step 1: 计算 RequestBody 的 SHA-256 哈希
  const hashedPayload = await sha256Hex(requestBody);

  // Step 2: 构造规范化请求头（按字母升序排列，全小写）
  // 需要参与签名的头：content-type, host, x-acs-action, x-acs-content-sha256, x-acs-date, x-acs-signature-nonce, x-acs-version
  const host = config.endpoint;
  const headersToSign: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'host': host,
    'x-acs-action': action,
    'x-acs-content-sha256': hashedPayload,
    'x-acs-date': xAcsDate,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': apiVersion,
  };

  // 按 key 字母升序排列
  const sortedHeaderKeys = Object.keys(headersToSign).sort();

  // 构造 CanonicalHeaders（每行 key:value\n）
  const canonicalHeaders = sortedHeaderKeys
    .map(k => `${k}:${headersToSign[k].trim()}\n`)
    .join('');

  // 构造 SignedHeaders（分号分隔）
  const signedHeaders = sortedHeaderKeys.join(';');

  // Step 3: 构造 CanonicalRequest
  // RPC 风格 API 的 CanonicalURI 固定为 /
  const canonicalRequest = [
    'POST',           // HTTPRequestMethod
    '/',              // CanonicalURI（RPC 风格固定为 /）
    '',               // CanonicalQueryString（无查询参数）
    canonicalHeaders, // CanonicalHeaders（末尾已有 \n）
    signedHeaders,    // SignedHeaders
    hashedPayload,    // HashedRequestPayload
  ].join('\n');

  // Step 4: 计算 CanonicalRequest 的 SHA-256 哈希
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);

  // Step 5: 构造待签字符串（StringToSign）
  const stringToSign = `ACS3-HMAC-SHA256\n${hashedCanonicalRequest}`;

  // Step 6: 计算签名
  const signatureBytes = await hmacSha256(config.accessKeySecret, stringToSign);
  const signature = toHex(signatureBytes);

  // Step 7: 构造 Authorization 头
  const authorization = `ACS3-HMAC-SHA256 Credential=${config.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

  // 返回完整请求头
  return {
    'Authorization': authorization,
    'Content-Type': 'application/json; charset=utf-8',
    'Host': host,
    'x-acs-action': action,
    'x-acs-content-sha256': hashedPayload,
    'x-acs-date': xAcsDate,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': apiVersion,
  };
}

// ============================================================
// 阿里云 CAMS API 调用
// ============================================================

interface CamsTemplateParam {
  [key: string]: string;
}

interface SendChatappMessageRequest {
  ChannelType: 'whatsapp';
  Type: 'template';
  From: string;
  To: string;
  CustSpaceId: string;
  TemplateCode: string;
  Language: string;
  TemplateParams?: CamsTemplateParam;
}

interface SendChatappMessageResponse {
  RequestId: string;
  Code: string;
  Message: string;
  MessageId?: string;
}

/**
 * 调用阿里云 CAMS SendChatappMessage API 发送 WhatsApp 模板消息
 *
 * @returns { success: boolean, messageId?: string, error?: string }
 */
async function sendCamsMessage(
  config: AliyunConfig,
  to: string,
  templateCode: string,
  language: string,
  templateParams: CamsTemplateParam
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const action = 'SendChatappMessage';
  const apiVersion = '2020-06-06';

  // 规范化手机号：确保以 + 开头（E.164 格式）
  const normalizedTo = to.startsWith('+') ? to : `+${to}`;
  const normalizedFrom = config.from.startsWith('+') ? config.from : `+${config.from}`;

  // 构造请求体
  const requestPayload: SendChatappMessageRequest = {
    ChannelType: 'whatsapp',
    Type: 'template',
    From: normalizedFrom,
    To: normalizedTo,
    CustSpaceId: config.custSpaceId,
    TemplateCode: templateCode,
    Language: language,
    TemplateParams: templateParams,
  };

  const requestBody = JSON.stringify(requestPayload);

  // 构造签名请求头
  const headers = await buildAliyunV3Headers(config, action, apiVersion, requestBody);

  const url = `https://${config.endpoint}/`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody,
    });

    const responseText = await response.text();
    let responseJson: SendChatappMessageResponse;

    try {
      responseJson = JSON.parse(responseText);
    } catch {
      return {
        success: false,
        error: `Invalid JSON response: ${responseText.substring(0, 200)}`,
      };
    }

    if (!response.ok || responseJson.Code !== 'OK') {
      return {
        success: false,
        error: `CAMS API error: Code=${responseJson.Code}, Message=${responseJson.Message}, RequestId=${responseJson.RequestId}`,
      };
    }

    return {
      success: true,
      messageId: responseJson.MessageId,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Network error: ${errMsg}`,
    };
  }
}

// ============================================================
// 通知类型处理器
// ============================================================

/**
 * 处理充值到账通知（promoter_deposit / wallet_deposit）
 *
 * 模板变量：
 *   {{1}} = 充值金额（TJS）
 *   {{2}} = 赠送积分说明（有赠送时填写，无赠送时填写空字符串或省略）
 *
 * 注意：阿里云模板变量不能为空字符串，如果 {{2}} 无内容，
 *       建议模板设计为：{{1}} TJS 已到账{{2}}
 *       其中 {{2}} 在有赠送时为"，另赠 X 积分"，无赠送时为""
 *       但阿里云不允许空变量，所以需要在模板中将 {{2}} 设为可选文本
 *       实际处理：无赠送时传入空格 " " 作为占位符
 */
function buildDepositTemplateParams(
  data: Record<string, unknown>,
  lang: string
): CamsTemplateParam {
  const amount = data.transaction_amount ?? data.deposit_amount ?? 0;
  const bonusAmount = data.bonus_amount as number | undefined;

  let bonusText = ' '; // 默认空格占位（阿里云不允许空字符串变量）

  if (bonusAmount && bonusAmount > 0) {
    switch (lang) {
      case 'zh':
        bonusText = `，另赠 ${bonusAmount} 积分`;
        break;
      case 'ru':
        bonusText = `，бонус ${bonusAmount} баллов`;
        break;
      case 'tg':
      default:
        bonusText = `，бонус ${bonusAmount} хол`;
        break;
    }
  }

  return {
    'amount': String(amount),
    'bonus': bonusText,
  };
}

/**
 * 处理提货码通知（batch_arrived）
 *
 * 模板变量：
 *   {{1}} = 商品名称
 *   {{2}} = 自提点名称
 *   {{3}} = 提货码
 *   {{4}} = 有效期
 */
function buildPickupTemplateParams(
  data: Record<string, unknown>
): CamsTemplateParam {
  return {
    'product': String(data.product_name ?? ''),
    'location': String(data.pickup_point_name ?? ''),
    'code': String(data.pickup_code ?? ''),
  };
}

/**
 * 根据通知类型和语言，确定模板 Code 和构造模板参数
 *
 * 注意：阿里云 CAMS 每种语言需要单独的模板，
 *       模板 Code 格式建议为：{BASE_CODE}_{LANG}
 *       例如：deposit_zh, deposit_ru, deposit_tg
 *       如果只有一套多语言模板，则直接使用 BASE_CODE
 */
function resolveTemplate(
  config: AliyunConfig,
  notificationType: string,
  data: Record<string, unknown>,
  lang: string
): { templateCode: string; templateParams: CamsTemplateParam; waLanguage: string } | null {
  const waLanguage = LANGUAGE_CODE_MAP[lang] ?? LANGUAGE_CODE_MAP['tg'];

  switch (notificationType) {
    case 'promoter_deposit':
    case 'wallet_deposit': {
      const params = buildDepositTemplateParams(data, lang);
      // 模板 Code 支持按语言区分：如 DEPOSIT_ZH、DEPOSIT_RU、DEPOSIT_TG
      // 如果只有一个模板 Code，则直接使用 config.templateDeposit
      const templateCode = config.templateDeposit;
      return { templateCode, templateParams: params, waLanguage };
    }

     case 'batch_arrived': {
      const params = buildPickupTemplateParams(data);
      const templateCode = config.templatePickup;
      return { templateCode, templateParams: params, waLanguage };
    }
    case 'group_buy_win': {
      // 包团成功通知模板变量
      const params: CamsTemplateParam = {
        'product': String(data.product_name ?? ''),
        'session_code': String(data.session_code ?? ''),
      };
      const templateCode = config.templateGroupBuyWin;
      if (!templateCode) return null;
      return { templateCode, templateParams: params, waLanguage };
    }
    case 'lottery_result': {
      // 开奖中奖通知模板变量：$(product) = 商品名, $(draw_number) = 期号
      const params: CamsTemplateParam = {
        'product': String(data.product_name ?? ''),
        'draw_number': String(data.lottery_code ?? data.draw_number ?? ''),
      };
      const templateCode = config.templateLottery;
      if (!templateCode) return null;
      return { templateCode, templateParams: params, waLanguage };
    }
    default:
      return null;
  }
}

// ============================================================
// 用户语言获取
// ============================================================

/**
 * 从 notification_queue 的 data 字段或 users 表获取用户首选语言
 * 默认返回 'tg'（塔吉克语）
 */
async function getUserLanguage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  notificationData: Record<string, unknown>
): Promise<string> {
  // 优先从通知数据中获取语言
  if (notificationData.preferred_language && typeof notificationData.preferred_language === 'string') {
    return notificationData.preferred_language;
  }

  // 从用户表获取
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('preferred_language')
      .eq('id', userId)
      .single();

    if (!error && user?.preferred_language) {
      return user.preferred_language;
    }
  } catch (err) {
    console.warn(`Failed to get user language for ${userId}:`, err);
  }

  return 'tg'; // 默认塔吉克语
}

// ============================================================
// 主处理逻辑
// ============================================================

/**
 * 处理单条通知记录
 */
async function processNotification(
  supabase: ReturnType<typeof createClient>,
  notification: NotificationRecord,
  config: AliyunConfig
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const { id, user_id, phone_number, notification_type, data } = notification;

  // 1. 检查是否为支持的通知类型
  if (!SUPPORTED_NOTIFICATION_TYPES.has(notification_type)) {
    console.log(`[SKIP] Notification ${id}: type '${notification_type}' not in whitelist`);
    // 标记为 skipped，不计入失败
    await supabase
      .from('notification_queue')
      .update({
        status: 'skipped',
        updated_at: new Date().toISOString(),
        error_message: `Notification type '${notification_type}' is not enabled`,
      })
      .eq('id', id);
    return { success: true, skipped: true };
  }

  // 2. 验证手机号
  if (!phone_number) {
    const errMsg = `No phone_number for user ${user_id}`;
    console.error(`[ERROR] Notification ${id}: ${errMsg}`);
    await markFailed(supabase, notification, errMsg);
    return { success: false, error: errMsg };
  }

  // 3. 获取用户语言
  const lang = await getUserLanguage(supabase, user_id, data);

  // 4. 解析模板
  const templateInfo = resolveTemplate(config, notification_type, data, lang);
  if (!templateInfo) {
    const errMsg = `Cannot resolve template for type '${notification_type}'`;
    console.error(`[ERROR] Notification ${id}: ${errMsg}`);
    await markFailed(supabase, notification, errMsg);
    return { success: false, error: errMsg };
  }

  const { templateCode, templateParams, waLanguage } = templateInfo;

  // 5. 检查模板 Code 是否已配置
  if (!templateCode) {
    const errMsg = `Template code not configured for type '${notification_type}'`;
    console.error(`[ERROR] Notification ${id}: ${errMsg}`);
    await markFailed(supabase, notification, errMsg);
    return { success: false, error: errMsg };
  }

  // 6. 发送 WhatsApp 消息
  console.log(`[SEND] Notification ${id}: type=${notification_type}, to=${phone_number}, template=${templateCode}, lang=${waLanguage}`);

  const result = await sendCamsMessage(
    config,
    phone_number,
    templateCode,
    waLanguage,
    templateParams
  );

  // 7. 更新通知状态
  if (result.success) {
    await supabase
      .from('notification_queue')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        external_message_id: result.messageId ?? null,
        error_message: null,
      })
      .eq('id', id);

    console.log(`[SUCCESS] Notification ${id}: messageId=${result.messageId}`);
    return { success: true };
  } else {
    await markFailed(supabase, notification, result.error ?? 'Unknown error');
    return { success: false, error: result.error };
  }
}

/**
 * 将通知标记为失败（支持重试）
 */
async function markFailed(
  supabase: ReturnType<typeof createClient>,
  notification: NotificationRecord,
  errorMessage: string
): Promise<void> {
  const newRetryCount = (notification.retry_count ?? 0) + 1;
  const maxRetries = notification.max_retries ?? 3;
  const isFinalFailure = newRetryCount >= maxRetries;

  const nextScheduledAt = isFinalFailure
    ? null
    : new Date(Date.now() + newRetryCount * 5 * 60 * 1000).toISOString(); // 指数退避：5分钟 * 重试次数

  await supabase
    .from('notification_queue')
    .update({
      status: isFinalFailure ? 'failed' : 'pending',
      retry_count: newRetryCount,
      error_message: errorMessage.substring(0, 500), // 限制错误消息长度
      scheduled_at: nextScheduledAt ?? notification.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', notification.id);

  console.error(`[FAILED] Notification ${notification.id}: retry=${newRetryCount}/${maxRetries}, error=${errorMessage}`);
}

// ============================================================
// Edge Function 入口
// ============================================================

serve(async (req: Request) => {
  // 仅允许 POST 请求（由 telegram-bot-cron 或手动触发）
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 读取环境变量
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const aliyunAccessKeyId = Deno.env.get('ALIYUN_ACCESS_KEY_ID') ?? '';
  const aliyunAccessKeySecret = Deno.env.get('ALIYUN_ACCESS_KEY_SECRET') ?? '';
  const aliyunFrom = Deno.env.get('ALIYUN_CAMS_FROM') ?? '';
  const aliyunCustSpaceId = Deno.env.get('ALIYUN_CAMS_CUST_SPACE_ID') ?? '';
  const aliyunTemplateDeposit = Deno.env.get('ALIYUN_CAMS_TEMPLATE_DEPOSIT') ?? '';
  const aliyunTemplatePickup = Deno.env.get('ALIYUN_CAMS_TEMPLATE_PICKUP') ?? '';
  const aliyunTemplateGroupBuyWin = Deno.env.get('ALIYUN_CAMS_TEMPLATE_GROUP_BUY_WIN') ?? '';
  const aliyunTemplateLottery = Deno.env.get('ALIYUN_CAMS_TEMPLATE_LOTTERY') ?? '';
  const aliyunRegion = Deno.env.get('ALIYUN_CAMS_REGION') ?? 'ap-southeast-1';

  // 验证必要的环境变量
  const missingVars: string[] = [];
  if (!aliyunAccessKeyId) missingVars.push('ALIYUN_ACCESS_KEY_ID');
  if (!aliyunAccessKeySecret) missingVars.push('ALIYUN_ACCESS_KEY_SECRET');
  if (!aliyunFrom) missingVars.push('ALIYUN_CAMS_FROM');
  if (!aliyunCustSpaceId) missingVars.push('ALIYUN_CAMS_CUST_SPACE_ID');

  if (missingVars.length > 0) {
    const errMsg = `Missing required environment variables: ${missingVars.join(', ')}`;
    console.error(`[CONFIG ERROR] ${errMsg}`);
    return new Response(JSON.stringify({
      success: false,
      error: errMsg,
      hint: 'Configure these variables in Supabase Dashboard → Edge Functions → Secrets',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 构造阿里云配置
  const aliyunConfig: AliyunConfig = {
    accessKeyId: aliyunAccessKeyId,
    accessKeySecret: aliyunAccessKeySecret,
    from: aliyunFrom,
    custSpaceId: aliyunCustSpaceId,
    templateDeposit: aliyunTemplateDeposit,
    templatePickup: aliyunTemplatePickup,
    templateGroupBuyWin: aliyunTemplateGroupBuyWin,
    templateLottery: aliyunTemplateLottery,
    region: aliyunRegion,
    // CAMS API endpoint：cams.{region}.aliyuncs.com
    // 注意：部分区域使用统一 endpoint cams.aliyuncs.com
    endpoint: `cams.ap-southeast-1.aliyuncs.com`,
  };

  // 初始化 Supabase 客户端
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 解析请求体（可选：支持指定批次大小）
  let batchSize = 20; // 默认每次处理 20 条
  try {
    const body = await req.json();
    if (body.batch_size && typeof body.batch_size === 'number') {
      batchSize = Math.min(Math.max(1, body.batch_size), 100); // 限制在 1-100 之间
    }
  } catch {
    // 请求体为空或非 JSON，使用默认值
  }

  // 查询待处理的通知（查询所有 pending 状态，以便将非白名单类型标记为 skipped）
  const { data: notifications, error: queryError } = await supabase
    .from('notification_queue')
    .select('*')
    .eq('channel', 'whatsapp')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('priority', { ascending: false }) // 高优先级先处理
    .order('created_at', { ascending: true }) // 同优先级按创建时间
    .limit(batchSize);

  if (queryError) {
    console.error('[DB ERROR] Failed to query notification_queue:', queryError);
    return new Response(JSON.stringify({
      success: false,
      error: `Database query failed: ${queryError.message}`,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!notifications || notifications.length === 0) {
    console.log('[INFO] No pending notifications to process');
    return new Response(JSON.stringify({
      success: true,
      processed: 0,
      message: 'No pending notifications',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[INFO] Processing ${notifications.length} notifications`);

  // 逐条处理通知（串行处理，避免 API 限流）
  const results = {
    total: notifications.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const notification of notifications as NotificationRecord[]) {
    try {
      // 先将状态标记为 processing，防止并发重复处理
      const { error: lockError } = await supabase
        .from('notification_queue')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', notification.id)
        .eq('status', 'pending'); // 乐观锁：只有 pending 状态才能被锁定

      if (lockError) {
        console.warn(`[SKIP] Notification ${notification.id}: failed to lock (may be processing by another instance)`);
        results.skipped++;
        continue;
      }

      const result = await processNotification(supabase, notification, aliyunConfig);

      if (result.skipped) {
        results.skipped++;
      } else if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        if (result.error) {
          results.errors.push(`${notification.id}: ${result.error}`);
        }
      }

      // 避免 API 限流：每条消息之间等待 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[FATAL] Notification ${notification.id}: unexpected error: ${errMsg}`);
      results.failed++;
      results.errors.push(`${notification.id}: ${errMsg}`);

      // 将意外错误的通知回滚到 pending 状态
      await supabase
        .from('notification_queue')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', notification.id)
        .eq('status', 'processing');
    }
  }

  console.log(`[DONE] Results: sent=${results.sent}, skipped=${results.skipped}, failed=${results.failed}`);

  return new Response(JSON.stringify({
    success: true,
    ...results,
    errors: results.errors.length > 0 ? results.errors : undefined,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
