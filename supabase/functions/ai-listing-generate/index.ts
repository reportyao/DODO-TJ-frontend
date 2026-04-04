/**
 * AI 商品上架助手 — Edge Function
 *
 * 核心后端逻辑，串联 4 个外部 API 调用，通过 SSE 流式返回进度和结果。
 *
 * 执行链路：
 *   Step A: 图片理解 (qwen-vl-max)       → 分析商品图片，提取特征
 *   Step B: 三语文案生成 (qwen-plus)      → 生成俄/中/塔吉克语电商文案
 *   Step C: 商品分割 (SegmentCommodity)   → 去除背景，输出 RGBA PNG
 *   Step D: 背景生成 (wanx-background-generation-v2) × 3 → 生成 3 种风格背景图
 *
 * 认证：x-admin-session-token → verify_admin_session RPC
 * 响应：SSE (text/event-stream)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// CORS 配置
// ============================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================
// 工具函数：重试 + SSE 发送
// ============================================================

/**
 * 带指数退避的重试包装器
 * @param fn 要执行的异步函数
 * @param maxRetries 最大重试次数（默认 3）
 * @param baseDelay 基础延迟毫秒数（默认 1000）
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, i);
      console.log(
        `[withRetry] 第 ${i + 1} 次失败，${delay}ms 后重试:`,
        error instanceof Error ? error.message : error
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}

/**
 * 解析 AI 返回的 JSON（可能被 markdown 代码块包裹）
 */
function parseAIJson(text: string): any {
  let cleaned = text.trim();
  // 移除 markdown 代码块包裹
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}

// ============================================================
// Step A: 图片理解 (qwen-vl-max)
// ============================================================

async function callQwenVL(
  apiKey: string,
  imageUrls: string[],
  category: string,
  productName: string,
  specs: string,
  notes: string
): Promise<any> {
  // 取前 3 张图片
  const images = imageUrls.slice(0, 3);

  // 构建 messages content：图片 + 文本 prompt
  const content: any[] = images.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  content.push({
    type: "text",
    text: `你是一名电商商品分析专家，服务于中亚俄语市场（塔吉克斯坦）的电商平台。
请分析以下商品图片，结合基础信息，用JSON格式输出：
{
  "product_type": "商品类型，如：男士夹克",
  "main_color": "主色调",
  "material_guess": "材质推测（如无法判断填null）",
  "key_features": ["特征1", "特征2", "特征3"],
  "use_scenes": ["使用场景1", "使用场景2"],
  "selling_points": [
    {"zh": "中文卖点1", "detail": "补充细节"},
    {"zh": "中文卖点2", "detail": "补充细节"},
    {"zh": "中文卖点3", "detail": "补充细节"}
  ],
  "target_audience": "目标人群描述"
}

商品基础信息：
- 品类：${category}
- 名称：${productName}
- 规格：${specs || "未提供"}
- 补充备注：${notes || "无"}

请只输出JSON，不要添加任何其他文字说明。`,
  });

  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-vl-max",
        messages: [{ role: "user", content }],
        temperature: 0.3,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`qwen-vl-max 调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("qwen-vl-max 返回内容为空");
  }

  return parseAIJson(rawContent);
}

// ============================================================
// Step B: 三语文案生成 (qwen-plus)
// ============================================================

async function callQwenPlus(
  apiKey: string,
  analysisJson: any,
  price: number
): Promise<any> {
  const prompt = `你是一名专业的多语言电商文案撰写师，精通俄语、中文和塔吉克语，深谙塔吉克斯坦和中亚市场的消费心理与文化偏好。

【塔吉克消费文化指南】
1. 偏好高性价比与实用性，对折扣和促销敏感。
2. 信任度驱动：强调质量认证、耐用性或"正品保证"。
3. 审美偏好：服装类偏向传统与保守（女性长裙/头巾，男性西装/长袍），但也受现代时尚影响；色彩上偏爱白色（纯洁）和绿色（幸福美好）。
4. 家庭观念重：购物往往是为了家庭，强调"适合全家"或"居家必备"会增加好感。

根据以下商品分析，生成电商上架内容。**俄语文案必须高质量且符合上述文化偏好**，中文和塔吉克语文案保证基本准确即可。

以JSON格式输出：
{
  "title_ru": "商品俄语标题（25-40字，含核心关键词，口语化、有吸引力）",
  "title_zh": "商品中文标题（15-25字）",
  "title_tg": "商品塔吉克语标题（25-40字）",
  "bullets_ru": [
    "俄语卖点1（15-25字，突出性价比或耐用性）",
    "俄语卖点2（15-25字，结合家庭或实用场景）",
    "俄语卖点3（15-25字，强调品质或外观）"
  ],
  "bullets_zh": ["中文卖点1", "中文卖点2", "中文卖点3"],
  "bullets_tg": ["塔吉克语卖点1", "塔吉克语卖点2", "塔吉克语卖点3"],
  "description_ru": "俄语商品详情描述（150-250字，自然流畅，融入塔吉克消费心理，如强调耐用、划算、适合当地生活方式）",
  "description_zh": "中文商品详情描述（80-150字）",
  "description_tg": "塔吉克语商品详情描述（100-200字）"
}

说明：
- 俄语文案要求高质量，必须贴合塔吉克当地购物习惯和文化偏好。
- 避免涉及宗教、政治等敏感话题。

请只输出JSON，不要添加任何其他文字说明。

商品分析：${JSON.stringify(analysisJson)}
售价：${price} сомони`;

  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`qwen-plus 调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("qwen-plus 返回内容为空");
  }

  return parseAIJson(rawContent);
}

// ============================================================
// Step C: 商品分割 — 阿里云 VIAPI 签名算法
// ============================================================

/**
 * 阿里云 VIAPI HMAC-SHA1 签名
 * 构造签名 URL 用于调用 SegmentCommodity API
 */
async function signViapiRequest(
  accessKeyId: string,
  accessKeySecret: string,
  params: Record<string, string>
): Promise<string> {
  // 1. 添加公共参数
  const allParams: Record<string, string> = {
    ...params,
    Format: "JSON",
    Version: "2019-12-30",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
  };

  // 2. 按字母排序参数
  const sortedKeys = Object.keys(allParams).sort();
  const canonicalized = sortedKeys
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`
    )
    .join("&");

  // 3. 构造 StringToSign
  const stringToSign = `POST&${encodeURIComponent("/")}&${encodeURIComponent(
    canonicalized
  )}`;

  // 4. HMAC-SHA1 签名
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(accessKeySecret + "&"),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(stringToSign)
  );
  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );

  // 5. 构造最终请求 URL
  return `https://imageseg.cn-shanghai.aliyuncs.com/?${canonicalized}&Signature=${encodeURIComponent(
    signatureBase64
  )}`;
}

/**
 * 调用阿里云 SegmentCommodity API 进行商品分割
 * @param imageUrl 公网可访问的商品图片 URL
 * @returns RGBA 透明背景 PNG 的临时 URL
 */
async function callSegmentCommodity(
  accessKeyId: string,
  accessKeySecret: string,
  imageUrl: string
): Promise<string> {
  const url = await signViapiRequest(accessKeyId, accessKeySecret, {
    Action: "SegmentCommodity",
    ImageURL: imageUrl,
  });

  const response = await fetch(url, {
    method: "POST",
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `SegmentCommodity 调用失败 (HTTP ${response.status}): ${errText}`
    );
  }

  const result = await response.json();

  // 检查业务错误
  if (result.Code && result.Code !== "0") {
    throw new Error(
      `SegmentCommodity 业务错误: ${result.Code} - ${result.Message}`
    );
  }

  const segmentedUrl = result.Data?.ImageURL;
  if (!segmentedUrl) {
    throw new Error("SegmentCommodity 返回的 ImageURL 为空");
  }

  return segmentedUrl;
}

// ============================================================
// Step D: 背景生成 (wanx-background-generation-v2)
// ============================================================

/** 3 种背景风格的 prompt */
const BACKGROUND_PROMPTS = [
  // 纯净展示
  "Professional e-commerce product photo, clean studio lighting, soft gradient background, high quality, commercial photography, minimalist",
  // 生活场景
  "Product placed in a cozy home environment, natural sunlight from window, soft shadows, lifestyle photography, aesthetic, 4k resolution",
  // 高级质感
  "Premium product shot, placed on a marble podium, dramatic lighting, dark background with subtle spotlight, luxurious feel, 8k",
];

/**
 * 提交万相背景生成任务
 * @returns task_id
 */
async function submitWanxTask(
  apiKey: string,
  baseImageUrl: string,
  refPrompt: string
): Promise<string> {
  const response = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/background-generation/generation/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "wanx-background-generation-v2",
        input: {
          base_image_url: baseImageUrl,
          ref_prompt: refPrompt,
        },
        parameters: {
          n: 1,
          model_version: "v3",
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `万相任务提交失败 (HTTP ${response.status}): ${errText}`
    );
  }

  const result = await response.json();
  const taskId = result.output?.task_id;
  if (!taskId) {
    throw new Error(
      `万相任务提交未返回 task_id: ${JSON.stringify(result)}`
    );
  }

  return taskId;
}

/**
 * 轮询万相任务结果
 * @param taskId 任务 ID
 * @param maxPolls 最大轮询次数（默认 40，约 2 分钟）
 * @param interval 轮询间隔毫秒（默认 3000）
 * @returns 生成的图片临时 URL
 */
async function pollWanxResult(
  apiKey: string,
  taskId: string,
  maxPolls: number = 40,
  interval: number = 3000
): Promise<string> {
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    const response = await fetch(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `万相任务查询失败 (HTTP ${response.status}): ${errText}`
      );
    }

    const result = await response.json();
    const status = result.output?.task_status;

    if (status === "SUCCEEDED") {
      const imageUrl = result.output?.results?.[0]?.url;
      if (!imageUrl) {
        throw new Error("万相任务成功但未返回图片 URL");
      }
      return imageUrl;
    }

    if (status === "FAILED") {
      const errMsg =
        result.output?.message || result.output?.code || "未知错误";
      throw new Error(`万相任务失败: ${errMsg}`);
    }

    // PENDING / RUNNING → 继续轮询
  }

  throw new Error(`万相任务超时 (轮询 ${maxPolls} 次未完成)`);
}

// ============================================================
// 临时 URL 转永久 URL：下载并上传到 Supabase Storage
// ============================================================

/**
 * 下载临时 URL 的图片并上传到 Supabase Storage
 * @param tempUrl 临时图片 URL
 * @param supabase Supabase 客户端（service_role）
 * @returns 永久公开 URL
 */
async function downloadAndUploadToStorage(
  tempUrl: string,
  supabase: any
): Promise<string> {
  // 1. 下载图片
  const imgResponse = await fetch(tempUrl);
  if (!imgResponse.ok) {
    throw new Error(
      `下载临时图片失败 (HTTP ${imgResponse.status}): ${tempUrl}`
    );
  }

  const arrayBuffer = await imgResponse.arrayBuffer();
  const contentType = imgResponse.headers.get("content-type") || "image/png";

  // 2. 生成唯一文件名
  const ext = contentType.includes("jpeg") || contentType.includes("jpg")
    ? "jpg"
    : "png";
  const fileName = `ai-generated/${Date.now()}_${crypto.randomUUID()}.${ext}`;

  // 3. 上传到 product-images bucket
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(fileName, arrayBuffer, {
      cacheControl: "31536000", // 1 年缓存
      upsert: false,
      contentType,
    });

  if (uploadError) {
    throw new Error(`上传到 Storage 失败: ${uploadError.message}`);
  }

  // 4. 获取永久公开 URL
  const {
    data: { publicUrl },
  } = supabase.storage.from("product-images").getPublicUrl(fileName);

  return publicUrl;
}

// ============================================================
// 主入口
// ============================================================

serve(async (req) => {
  // 1. CORS 预检
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 只接受 POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // 2. 初始化 Supabase 客户端（service_role 权限）
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 3. 验证管理员 session（通过 verify_admin_session RPC）
    const sessionToken = req.headers.get("x-admin-session-token");
    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: "ADMIN_AUTH_FAILED" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: adminId, error: authError } = await supabase.rpc(
      "verify_admin_session",
      { p_session_token: sessionToken }
    );

    if (authError || !adminId) {
      return new Response(
        JSON.stringify({ error: "ADMIN_AUTH_FAILED" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. 解析请求体
    const {
      image_urls,
      category,
      product_name,
      specs,
      price,
      notes,
    } = await req.json();

    // 参数校验
    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      return new Response(
        JSON.stringify({ error: "至少需要提供一张商品图片 URL" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!product_name) {
      return new Response(
        JSON.stringify({ error: "商品名称不能为空" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!price || price <= 0) {
      return new Response(
        JSON.stringify({ error: "售价必须大于 0" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 5. 获取 API Keys
    const dashscopeApiKey = Deno.env.get("DASHSCOPE_API_KEY");
    if (!dashscopeApiKey) {
      return new Response(
        JSON.stringify({ error: "服务端缺少 DASHSCOPE_API_KEY 配置" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aliAccessKeyId = Deno.env.get("ALIBABA_CLOUD_ACCESS_KEY_ID");
    const aliAccessKeySecret = Deno.env.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET");

    // 6. 创建 SSE 流
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sendSSE = async (data: any) => {
      try {
        await writer.write(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      } catch {
        // 客户端可能已断开连接，忽略写入错误
      }
    };

    // 7. 异步执行 AI 链路
    (async () => {
      const startTime = Date.now();

      try {
        // ---- Step A: 图片理解 ----
        await sendSSE({
          status: "processing",
          progress: 10,
          stage: "正在分析商品图片...",
        });

        const analysis = await withRetry(() =>
          callQwenVL(
            dashscopeApiKey,
            image_urls,
            category || "",
            product_name,
            specs || "",
            notes || ""
          )
        );

        console.log("[Step A] 图片理解完成:", JSON.stringify(analysis));

        // ---- Step B: 三语文案生成 ----
        await sendSSE({
          status: "processing",
          progress: 30,
          stage: "正在生成三语文案...",
        });

        const copywriting = await withRetry(() =>
          callQwenPlus(dashscopeApiKey, analysis, price)
        );

        console.log("[Step B] 文案生成完成");

        // ---- Step C: 商品分割 ----
        let segmentedUrl: string | null = null;
        let segmentFailed = false;

        if (aliAccessKeyId && aliAccessKeySecret) {
          await sendSSE({
            status: "processing",
            progress: 45,
            stage: "正在抠除商品背景...",
          });

          try {
            segmentedUrl = await withRetry(() =>
              callSegmentCommodity(
                aliAccessKeyId,
                aliAccessKeySecret,
                image_urls[0]
              )
            );
            console.log("[Step C] 商品分割完成:", segmentedUrl);
          } catch (error) {
            // 降级处理：分割失败不终止流程
            segmentFailed = true;
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error("[Step C] 商品分割失败（降级处理）:", errMsg);
            await sendSSE({
              status: "processing",
              progress: 50,
              stage: "抠图失败，将使用原始图片继续...",
            });
          }
        } else {
          // 未配置 VIAPI 密钥，跳过分割步骤
          segmentFailed = true;
          console.log("[Step C] 未配置 VIAPI 密钥，跳过商品分割");
          await sendSSE({
            status: "processing",
            progress: 50,
            stage: "跳过抠图步骤（未配置密钥），继续生成...",
          });
        }

        // ---- Step D: 背景生成 ----
        let backgroundImages: string[] = [];

        if (segmentedUrl) {
          // 有分割结果 → 生成背景图
          await sendSSE({
            status: "processing",
            progress: 55,
            stage: "正在生成商品背景图...",
          });

          // 串行提交 3 个任务（间隔 500ms，避免触发 2QPS 限制）
          const taskIds: string[] = [];
          for (let i = 0; i < BACKGROUND_PROMPTS.length; i++) {
            try {
              const taskId = await withRetry(
                () =>
                  submitWanxTask(
                    dashscopeApiKey,
                    segmentedUrl!,
                    BACKGROUND_PROMPTS[i]
                  ),
                3,
                2000 // 万相限流场景使用更长的退避基数
              );
              taskIds.push(taskId);
              console.log(
                `[Step D] 背景任务 ${i + 1}/3 已提交: ${taskId}`
              );
            } catch (error) {
              const errMsg = error instanceof Error ? error.message : String(error);
              console.error(
                `[Step D] 背景任务 ${i + 1}/3 提交失败:`,
                errMsg
              );
            }

            // 每次提交间隔 500ms
            if (i < BACKGROUND_PROMPTS.length - 1) {
              await new Promise((r) => setTimeout(r, 500));
            }
          }

          // 并行轮询所有已提交的任务
          if (taskIds.length > 0) {
            const bgResults = await Promise.allSettled(
              taskIds.map(async (taskId, i) => {
                const tempUrl = await pollWanxResult(
                  dashscopeApiKey,
                  taskId
                );

                await sendSSE({
                  status: "processing",
                  progress: 55 + (i + 1) * 12,
                  stage: `背景图 ${i + 1}/${taskIds.length} 完成`,
                });

                // 下载临时 URL 并上传到 Storage
                const permanentUrl = await downloadAndUploadToStorage(
                  tempUrl,
                  supabase
                );
                console.log(
                  `[Step D] 背景图 ${i + 1} 已保存: ${permanentUrl}`
                );
                return permanentUrl;
              })
            );

            // 收集成功的图片
            backgroundImages = bgResults
              .filter(
                (r): r is PromiseFulfilledResult<string> =>
                  r.status === "fulfilled"
              )
              .map((r) => r.value);

            // 记录失败的任务
            bgResults.forEach((r, i) => {
              if (r.status === "rejected") {
                console.error(
                  `[Step D] 背景图 ${i + 1} 失败:`,
                  r.reason
                );
              }
            });
          }
        }

        // ---- 汇总结果 ----
        const duration = Date.now() - startTime;

        // 判断结果状态
        const hasImages = backgroundImages.length > 0;
        const hasCopywriting =
          copywriting.title_ru && copywriting.description_ru;

        if (!hasCopywriting) {
          // 文案缺失（不应该发生，因为 Step B 失败会抛异常）
          await sendSSE({
            status: "error",
            progress: 100,
            error: "文案生成结果不完整",
          });
        } else if (segmentFailed && !hasImages) {
          // 分割失败且无背景图 → partial（仅文案）
          await sendSSE({
            status: "processing",
            progress: 95,
            stage: "正在保存生成结果...",
          });

          await sendSSE({
            status: "partial",
            progress: 100,
            result: {
              ...copywriting,
              background_images: [],
              original_images: image_urls,
              material_guess: analysis.material_guess || null,
            },
            message: "抠图失败，可使用原始图片上架",
            duration_ms: duration,
          });
        } else {
          // 完全成功或部分背景图成功
          await sendSSE({
            status: "processing",
            progress: 95,
            stage: "正在保存生成结果...",
          });

          await sendSSE({
            status: "done",
            progress: 100,
            result: {
              ...copywriting,
              background_images: backgroundImages,
              original_images: image_urls,
              material_guess: analysis.material_guess || null,
            },
            duration_ms: duration,
          });
        }

        console.log(
          `[AI Listing] 完成，耗时 ${duration}ms，背景图 ${backgroundImages.length} 张`
        );
      } catch (error) {
        // 致命错误（Step A 或 Step B 失败）
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[AI Listing] 致命错误:", errMsg);
        await sendSSE({
          status: "error",
          progress: 0,
          error: errMsg,
        });
      } finally {
        try {
          await writer.close();
        } catch {
          // 忽略关闭错误
        }
      }
    })();

    // 8. 返回 SSE 响应
    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[AI Listing] 请求处理错误:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
