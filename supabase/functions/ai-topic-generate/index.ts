/**
 * AI 专题生成助手 — Edge Function (v2)
 *
 * 核心后端逻辑，串联三层 AI 调用，通过 SSE 流式返回进度和结果。
 *
 * 执行链路（三层架构）：
 *   Step A: 商品理解层 (qwen-plus)
 *     → 分析选中商品在塔吉克本地生活中的使用场景、目标人群、生活锚点、风险点
 *   Step B: 内容表达层 (qwen-plus) — v2 升级为 section 模式
 *     → 基于理解层结果 + 运营输入，生成三语专题草稿
 *     → 输出 sections 数组：每个 section = 场景文案 + 关联商品列表
 *   Step C: 封面图生成 (可选，DashScope wanx-background-generation-v2)
 *     → 基于商品图片 + AI 生成的专题主题，生成封面图
 *
 * 认证：x-admin-session-token → verify_admin_session RPC
 * 响应：SSE (text/event-stream)
 *
 * SSE 事件格式（与 ai-listing-generate 保持一致）：
 *   data: {"status":"processing","progress":N,"stage":"..."}
 *   data: {"status":"done","progress":100,"result":{...}}
 *   data: {"status":"error","error":"..."}
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
// 工具函数
// ============================================================

/** 带指数退避的重试包装器 */
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

/** 解析 AI 返回的 JSON（可能被 markdown 代码块包裹） */
function parseAIJson(text: string): any {
  let cleaned = text.trim();
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

/** 空话黑名单检测 */
const BANNED_PHRASES = [
  "高品质", "甄选", "满足多元需求", "品质生活", "尊享体验",
  "提升幸福感", "优选好物", "匠心之选", "品质之选", "臻选",
  "轻奢", "赋能", "高端大气", "引领潮流", "满足多样需求",
  "为品质生活提供更多可能", "开启美好生活",
];

function detectBannedPhrases(text: string): string[] {
  const found: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (text.includes(phrase)) {
      found.push(phrase);
    }
  }
  return found;
}

/** 检查三语文本完整性 */
function checkI18nCompleteness(
  obj: Record<string, string> | null | undefined,
  languages: string[]
): string[] {
  const missing: string[] = [];
  if (!obj) return languages;
  for (const lang of languages) {
    if (!obj[lang] || obj[lang].trim().length === 0) {
      missing.push(lang);
    }
  }
  return missing;
}

// ============================================================
// Step A: 商品理解层 (qwen-plus)
// ============================================================

async function runProductUnderstanding(
  apiKey: string,
  products: any[],
  topicGoal: string,
  coreScene: string[],
  targetAudience: string[],
  localContextHints: string[],
  lexiconEntries: any[]
): Promise<any> {
  // 构建商品信息摘要
  const productSummaries = products.map((p, i) => {
    const name = p.name_i18n?.zh || p.name_i18n?.ru || p.name || "未知商品";
    const desc = p.description_i18n?.zh || p.description_i18n?.ru || "";
    const categories = (p.categories || []).map((c: any) => c.name_i18n?.zh || c.code).join("、");
    const tags = (p.tags || []).map((t: any) => t.name_i18n?.zh || t.code).join("、");
    const price = p.original_price || p.active_lottery?.ticket_price || "未知";
    return `商品${i + 1}: ${name} (ID: ${p.id})\n  描述: ${desc}\n  分类: ${categories || "无"}\n  标签: ${tags || "无"}\n  价格: ${price} сомони`;
  }).join("\n\n");

  // 构建词库参考
  const lexiconRef = lexiconEntries.length > 0
    ? lexiconEntries.map((e: any) => {
        const title = e.title_i18n?.zh || e.code;
        const content = e.content_i18n?.zh || "";
        const good = e.example_good || "";
        const bad = e.example_bad || "";
        const anchors = (e.local_anchors || []).join("、");
        return `[${e.lexicon_group}] ${title}: ${content}${good ? `\n  好例子: ${good}` : ""}${bad ? `\n  坏例子: ${bad}` : ""}${anchors ? `\n  本地锚点: ${anchors}` : ""}`;
      }).join("\n")
    : "暂无词库条目";

  const prompt = `你是一名深入了解塔吉克斯坦本地生活的商品分析师。你的任务不是写广告文案，而是分析以下商品在塔吉克本地日常生活中最真实、最自然的使用情境。

【专题目标】
${topicGoal}

【核心场景】
${coreScene.join("、") || "未指定"}

【目标人群】
${targetAudience.join("、") || "未指定"}

【选中商品】
${productSummaries}

【本地化词库参考】
${lexiconRef}

${localContextHints.length > 0 ? `【本地生活提示】\n运营提供的本地化关键词：${localContextHints.join("、")}\n请在分析中优先考虑这些本地生活场景和习惯。\n` : ""}

请对每个商品进行深度理解分析，并将商品按使用场景自然分组。输出以下 JSON 结构：
{
  "overall_theme": "这组商品整体适合什么样的生活主题（一句话）",
  "story_angle": "推荐的叙事角度（例如：冬天回家晚了，想快点吃上热饭）",
  "local_anchors_used": ["实际引用的本地生活锚点1", "锚点2", "锚点3"],
  "risk_notes": ["需要注意的风险点，如某商品不适合该场景", "可能的文化敏感点"],
  "product_groups": [
    {
      "group_theme": "这组商品的场景主题（如：厨房里的好帮手）",
      "product_ids": ["商品ID1", "商品ID2"]
    }
  ],
  "products_analysis": [
    {
      "product_id": "商品ID",
      "product_name": "商品名称",
      "best_scene": "这个商品在本次专题场景中最自然的使用画面（具体到动作和场景）",
      "target_people": "最适合的人群描述",
      "local_life_connection": "与塔吉克本地生活的真实连接点",
      "selling_angle": "不是卖点，而是'为什么这个人在这个场景下会觉得这个东西好用'",
      "recommended_badge": "推荐的商品角标文案（如：做饭省心、待客体面、冬天必备）"
    }
  ],
  "recommended_topic_type": "story|collection|seasonal|gift_guide",
  "recommended_card_style": "story_card|image_card|minimal_card",
  "cover_image_prompt": "用英文描述一张适合这个专题的封面图场景（如：A cozy kitchen scene with warm lighting...），用于 AI 图像生成"
}

要求：
1. "best_scene" 必须是具体的生活画面，不能是抽象描述
2. "local_life_connection" 必须引用真实的塔吉克生活习惯
3. 不要使用"高品质""甄选""品质生活"等空泛营销词
4. "product_groups" 按场景自然分组，每组2-4个商品，如果商品少于4个可以只分1组
5. "cover_image_prompt" 必须是英文，描述一个温馨、有生活感的场景画面
6. 请只输出 JSON，不要添加任何其他文字说明`;

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
        temperature: 0.4,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`商品理解层调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("商品理解层返回内容为空");
  }

  return parseAIJson(rawContent);
}

// ============================================================
// Step B: 内容表达层 (qwen-plus) — v2 Section 模式
// ============================================================

async function runContentGeneration(
  apiKey: string,
  understanding: any,
  topicGoal: string,
  manualNotes: string,
  toneConstraints: string[],
  outputLanguages: string[],
  localContextHints: string[],
  lexiconEntries: any[],
  selectedProducts: any[] = []
): Promise<any> {
  // 构建语气约束
  const toneRef = toneConstraints.length > 0
    ? `【语气约束】\n不要出现以下风格：${toneConstraints.join("、")}`
    : "";

  // 构建好例子/坏例子参考
  const styleExamples = lexiconEntries
    .filter((e: any) => e.example_good || e.example_bad)
    .map((e: any) => {
      let ref = `[${e.lexicon_group}]`;
      if (e.example_good) ref += `\n  好例子: ${e.example_good}`;
      if (e.example_bad) ref += `\n  坏例子: ${e.example_bad}`;
      if (e.tone_notes) ref += `\n  口吻要求: ${e.tone_notes}`;
      return ref;
    }).join("\n");

  const langInstruction = outputLanguages.includes("tg")
    ? "必须同时输出中文(zh)、俄语(ru)和塔吉克语(tg)三个语种。俄语和塔吉克语不是中文的逐句直译，而是基于同一个生活场景做本地化改写，让当地人读起来自然、亲切。"
    : "必须同时输出中文(zh)和俄语(ru)两个语种。俄语不是中文的逐句直译，而是基于同一个生活场景做本地化改写。";

  // 构建商品分组信息
  const productGroups = understanding.product_groups || [];
  const groupInfo = productGroups.length > 0
    ? `\n【商品分组建议（来自理解层）】\n${productGroups.map((g: any, i: number) => `第${i + 1}组 "${g.group_theme}": ${g.product_ids.join(', ')}`).join('\n')}\n请按照此分组生成 sections，每个 section 对应一组商品。`
    : "";

  const prompt = `你不是广告文案生成器，而是本地生活内容编辑。你的任务是先理解商品在塔吉克本地生活中最真实、最自然的使用情境，再用家常、人话、能让人代入的方式写出专题草稿。你不能堆砌"高品质、优选、满足多样需求、尊享、甄选"等空泛营销套话。你必须优先使用真实的家庭、待客、做饭、送礼、节庆、邻里往来等生活画面来解释商品价值。

【专题目标】
${topicGoal}

【商品理解层分析结果】
${JSON.stringify(understanding, null, 2)}

${manualNotes ? `【运营补充说明】\n${manualNotes}` : ""}

${localContextHints.length > 0 ? `【本地生活提示】\n运营提供的本地化关键词：${localContextHints.join("、")}\n请在内容中自然融入这些本地生活元素。` : ""}

${toneRef}

${styleExamples ? `【文案风格参考】\n${styleExamples}` : ""}

【语言要求】
${langInstruction}
${groupInfo}

请基于以上信息，生成完整的专题草稿。注意：这次使用 **sections 模式**，每个 section 是一段场景化文案 + 关联的商品列表。

输出以下 JSON 结构：
{
  "title_i18n": {"zh": "中文标题（15-25字，像朋友推荐，不像广告标题）", "ru": "俄语标题", "tg": "塔吉克语标题"},
  "subtitle_i18n": {"zh": "中文副标题（一句话点明场景）", "ru": "俄语副标题", "tg": "塔吉克语副标题"},
  "intro_i18n": {"zh": "中文引导正文（2-3句，描绘一个具体的生活画面，让人代入，引出下面的内容）", "ru": "俄语引导正文", "tg": "塔吉克语引导正文"},
  "sections": [
    {
      "story_text_i18n": {
        "zh": "第一段场景化文案（围绕一个具体生活场景展开，自然引出下面的商品。3-5句话，有画面感，有温度）",
        "ru": "俄语场景文案（本地化改写，不是直译）",
        "tg": "塔吉克语场景文案"
      },
      "products": [
        {
          "product_id": "商品ID",
          "note_i18n": {"zh": "这个商品在这个场景下为什么好用（1-2句）", "ru": "俄语", "tg": "塔吉克语"},
          "badge_text_i18n": {"zh": "角标文案（2-4字）", "ru": "俄语角标", "tg": "塔吉克语角标"}
        }
      ]
    },
    {
      "story_text_i18n": {
        "zh": "第二段场景化文案（换一个场景或角度）",
        "ru": "俄语",
        "tg": "塔吉克语"
      },
      "products": [
        {
          "product_id": "商品ID",
          "note_i18n": {"zh": "场景说明", "ru": "俄语", "tg": "塔吉克语"},
          "badge_text_i18n": {"zh": "角标", "ru": "俄语", "tg": "塔吉克语"}
        }
      ]
    }
  ],
  "placement_variants": [
    {
      "variant_name": "首页主推位",
      "title_i18n": {"zh": "卡片标题（8-15字，吸引点击）", "ru": "俄语卡片标题", "tg": "塔吉克语卡片标题"},
      "subtitle_i18n": {"zh": "卡片副标题", "ru": "俄语卡片副标题", "tg": "塔吉克语卡片副标题"},
      "angle": "这个卡片变体的切入角度"
    },
    {
      "variant_name": "分类页推荐位",
      "title_i18n": {"zh": "另一个角度的卡片标题", "ru": "俄语", "tg": "塔吉克语"},
      "subtitle_i18n": {"zh": "副标题", "ru": "俄语", "tg": "塔吉克语"},
      "angle": "切入角度"
    }
  ],
  "recommended_category_ids": [],
  "recommended_tag_ids": []
}

要求：
1. 标题和导语必须像"熟人推荐"，不能像"品牌宣传册"
2. 每个 section 的 story_text_i18n 要有具体的生活画面，不能只是抽象描述商品功能
3. 俄语和塔吉克语必须做本地化改写，不是中文的逐句翻译
4. 卡片变体至少 2 个，从不同角度吸引点击
5. ❗❗ 每个 section 的 products 数组中的 product_id 必须是真实的商品 ID
6. ❗❗ 所有选中商品必须出现在某个 section 的 products 中，不可遗漏
7. 请只输出 JSON，不要添加任何其他文字说明

【必须分配到 sections 中的商品列表】
${selectedProducts.map((p: any, i: number) => {
  const name = p.name_i18n?.zh || p.name_i18n?.ru || p.name || '未知商品';
  return `商品${i + 1}: ID=${p.id}, 名称=${name}`;
}).join('\n')}
❗❗ 以上 ${selectedProducts.length} 个商品必须全部出现在 sections 的 products 数组中，不可省略。`;

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
        temperature: 0.6,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`内容表达层调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("内容表达层返回内容为空");
  }

  return parseAIJson(rawContent);
}

// ============================================================
// Step C: 封面图生成 (DashScope wanx-background-generation-v2)
// ============================================================

/** 提交万相背景生成任务 */
async function submitWanxCoverTask(
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
    throw new Error(`封面图任务提交失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const taskId = result.output?.task_id;
  if (!taskId) {
    throw new Error(`封面图任务提交未返回 task_id: ${JSON.stringify(result)}`);
  }

  return taskId;
}

/** 轮询万相任务结果 */
async function pollWanxResult(
  apiKey: string,
  taskId: string,
  maxPolls: number = 40,
  interval: number = 3000
): Promise<string> {
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    try {
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
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`封面图任务查询连续失败 ${maxConsecutiveErrors} 次`);
        }
        continue;
      }

      consecutiveErrors = 0;
      const result = await response.json();
      const status = result.output?.task_status;

      if (status === "SUCCEEDED") {
        const imageUrl = result.output?.results?.[0]?.url;
        if (!imageUrl) throw new Error("封面图任务成功但未返回图片 URL");
        return imageUrl;
      }

      if (status === "FAILED") {
        const errMsg = result.output?.message || result.output?.code || "未知错误";
        throw new Error(`封面图任务失败: ${errMsg}`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("封面图任务失败") ||
         error.message.includes("未返回图片 URL") ||
         error.message.includes("连续失败"))
      ) {
        throw error;
      }
      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw error;
      }
    }
  }

  throw new Error(`封面图任务超时 (轮询 ${maxPolls} 次未完成)`);
}

/** 下载临时 URL 的图片并上传到 Supabase Storage */
async function downloadAndUploadToStorage(
  tempUrl: string,
  supabase: any,
  folder: string = "topic-covers"
): Promise<string> {
  const imgResponse = await fetch(tempUrl);
  if (!imgResponse.ok) {
    throw new Error(`下载临时图片失败 (HTTP ${imgResponse.status}): ${tempUrl}`);
  }

  const arrayBuffer = await imgResponse.arrayBuffer();
  const contentType = imgResponse.headers.get("content-type") || "image/png";
  const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
  const fileName = `${folder}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(fileName, arrayBuffer, {
      cacheControl: "31536000",
      upsert: false,
      contentType,
    });

  if (uploadError) {
    throw new Error(`上传封面图到 Storage 失败: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage
    .from("product-images")
    .getPublicUrl(fileName);

  return publicUrl;
}

// ============================================================
// 主处理函数
// ============================================================

serve(async (req: Request) => {
  // CORS 预检
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 只接受 POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── 创建 SSE 流 ─────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendSSE = async (data: any) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // 客户端已断开
    }
  };

  // 异步执行主逻辑
  (async () => {
    try {
      // ─── 1. 认证 ──────────────────────────────────────────
      await sendSSE({ status: "processing", progress: 5, stage: "正在验证管理员身份..." });

      const sessionToken = req.headers.get("x-admin-session-token");
      if (!sessionToken) {
        await sendSSE({ status: "error", error: "ADMIN_AUTH_REQUIRED: 缺少管理员认证" });
        await writer.close();
        return;
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const dashscopeApiKey = Deno.env.get("DASHSCOPE_API_KEY") || "";

      if (!dashscopeApiKey) {
        await sendSSE({ status: "error", error: "服务端未配置 AI API Key" });
        await writer.close();
        return;
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // 验证管理员 session
      const { data: sessionData, error: sessionError } = await supabase.rpc(
        "verify_admin_session",
        { p_session_token: sessionToken }
      );

      if (sessionError || !sessionData) {
        await sendSSE({ status: "error", error: "ADMIN_AUTH_FAILED: 管理员认证失败" });
        await writer.close();
        return;
      }

      let adminId: string | undefined;
      if (typeof sessionData === "string") {
        try {
          const parsed = JSON.parse(sessionData);
          adminId = parsed?.admin_id || sessionData;
        } catch {
          adminId = sessionData;
        }
      } else if (sessionData && typeof sessionData === "object") {
        adminId = sessionData.admin_id;
      } else {
        adminId = String(sessionData);
      }

      // ─── 2. 解析请求 ─────────────────────────────────────
      await sendSSE({ status: "processing", progress: 10, stage: "正在解析请求参数..." });

      const body = await req.json();
      const {
        topic_goal,
        target_audience = [],
        core_scene = [],
        local_context_hints = [],
        selected_products = [],
        manual_notes = "",
        tone_constraints = [],
        output_languages = ["zh", "ru", "tg"],
        generate_cover = true,           // v2 新增：是否生成封面图
        cover_mode = "ai_generate",      // v2 新增：封面模式 ai_generate | product_collage
      } = body;

      if (!topic_goal || topic_goal.trim().length === 0) {
        await sendSSE({ status: "error", error: "请输入专题目标" });
        await writer.close();
        return;
      }

      if (selected_products.length === 0) {
        await sendSSE({ status: "error", error: "请至少选择一个商品" });
        await writer.close();
        return;
      }

      // ─── 3. 创建任务记录 ──────────────────────────────────
      await sendSSE({ status: "processing", progress: 15, stage: "正在创建生成任务..." });

      const { data: taskData, error: taskError } = await supabase
        .from("ai_topic_generation_tasks")
        .insert({
          status: "processing",
          request_payload: body,
          created_by: adminId,
        })
        .select("id")
        .single();

      const taskId = taskData?.id;
      if (taskError) {
        console.error("[ai-topic-generate] 创建任务记录失败:", taskError);
      }

      // ─── 4. 加载词库数据 ──────────────────────────────────
      await sendSSE({ status: "processing", progress: 20, stage: "正在加载本地化词库...", task_id: taskId });

      let lexiconEntries: any[] = [];
      try {
        const { data: lexData } = await supabase
          .from("localization_lexicon")
          .select("*")
          .eq("is_active", true)
          .order("lexicon_group")
          .order("sort_order");
        lexiconEntries = lexData || [];
      } catch (e) {
        console.error("[ai-topic-generate] 加载词库失败:", e);
      }

      // ─── 5. Step A: 商品理解层 ────────────────────────────
      await sendSSE({ status: "processing", progress: 25, stage: "AI 正在分析商品与本地生活场景的关系...", task_id: taskId });

      let understanding: any;
      try {
        understanding = await withRetry(
          () => runProductUnderstanding(
            dashscopeApiKey,
            selected_products,
            topic_goal,
            core_scene,
            target_audience,
            local_context_hints,
            lexiconEntries
          ),
          2,
          2000
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[ai-topic-generate] 商品理解层失败:", errMsg);
        await sendSSE({ status: "error", progress: 0, error: `商品理解层失败: ${errMsg}` });

        if (taskId) {
          await supabase
            .from("ai_topic_generation_tasks")
            .update({ status: "error", error_message: errMsg, completed_at: new Date().toISOString() })
            .eq("id", taskId);
        }

        await writer.close();
        return;
      }

      await sendSSE({
        status: "processing",
        progress: 45,
        stage: `商品理解完成：${understanding.story_angle || "已分析"} — 正在生成三语专题草稿...`,
        task_id: taskId,
      });

      // ─── 6. Step B: 内容表达层（Section 模式）────────────
      let contentResult: any;
      try {
        contentResult = await withRetry(
          () => runContentGeneration(
            dashscopeApiKey,
            understanding,
            topic_goal,
            manual_notes,
            tone_constraints,
            output_languages,
            local_context_hints,
            lexiconEntries,
            selected_products
          ),
          2,
          2000
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[ai-topic-generate] 内容表达层失败:", errMsg);

        const partialResult = {
          understanding,
          title_i18n: null,
          subtitle_i18n: null,
          intro_i18n: null,
          sections: [],
          story_blocks_i18n: [],
          placement_variants: [],
          product_notes: [],
          recommended_category_ids: [],
          recommended_tag_ids: [],
          explanation: {
            local_anchors: understanding.local_anchors_used || [],
            selected_story_angle: understanding.story_angle || "",
            risk_notes: understanding.risk_notes || [],
          },
          quality_warnings: [`内容表达层生成失败: ${errMsg}`],
        };

        if (taskId) {
          await supabase
            .from("ai_topic_generation_tasks")
            .update({
              status: "partial",
              result_payload: partialResult,
              error_message: errMsg,
              completed_at: new Date().toISOString(),
            })
            .eq("id", taskId);
        }

        await sendSSE({
          status: "partial",
          progress: 100,
          stage: "部分完成（仅商品理解，文案生成失败）",
          result: partialResult,
        });
        await writer.close();
        return;
      }

      // ─── 7. 质量校验 ─────────────────────────────────────
      await sendSSE({ status: "processing", progress: 65, stage: "正在进行质量校验...", task_id: taskId });

      const qualityWarnings: string[] = [];
      let finalStatus: "done" | "partial" = "done";

      // 检查标题完整性
      const titleMissing = checkI18nCompleteness(contentResult.title_i18n, output_languages);
      if (titleMissing.length > 0) {
        qualityWarnings.push(`标题缺少以下语种: ${titleMissing.join(", ")}`);
        finalStatus = "partial";
      }

      // 检查副标题完整性
      const subtitleMissing = checkI18nCompleteness(contentResult.subtitle_i18n, output_languages);
      if (subtitleMissing.length > 0) {
        qualityWarnings.push(`副标题缺少以下语种: ${subtitleMissing.join(", ")}`);
      }

      // 检查导语完整性
      const introMissing = checkI18nCompleteness(contentResult.intro_i18n, output_languages);
      if (introMissing.length > 0) {
        qualityWarnings.push(`导语缺少以下语种: ${introMissing.join(", ")}`);
      }

      // 检查 sections
      const sections = contentResult.sections || [];
      if (sections.length === 0) {
        qualityWarnings.push("sections 为空，没有生成任何段落+商品分组");
        finalStatus = "partial";
      }

      // 检查所有商品是否都被分配到了 sections
      const allSectionProductIds = new Set<string>();
      for (const section of sections) {
        for (const p of (section.products || [])) {
          allSectionProductIds.add(p.product_id);
        }
      }
      const missingProducts = selected_products.filter((p: any) => !allSectionProductIds.has(p.id));
      if (missingProducts.length > 0) {
        qualityWarnings.push(
          `有 ${missingProducts.length} 个商品未被分配到任何 section: ${missingProducts.map((p: any) => p.name_i18n?.zh || p.name || p.id).join('、')}`
        );
        // 将遗漏商品追加到最后一个 section（或创建新 section）
        if (sections.length > 0) {
          const lastSection = sections[sections.length - 1];
          for (const mp of missingProducts) {
            const name = mp.name_i18n?.zh || mp.name || '未知商品';
            lastSection.products.push({
              product_id: mp.id,
              note_i18n: {
                zh: `${name}（AI 未生成说明，请手动编辑）`,
                ru: `${mp.name_i18n?.ru || name}（описание не сгенерировано）`,
                tg: `${mp.name_i18n?.tg || name}（тавсиф тавлид нашудааст）`,
              },
              badge_text_i18n: { zh: '待编辑', ru: 'Ред.', tg: 'Таҳрир' },
            });
          }
        } else {
          // 创建一个兜底 section
          sections.push({
            story_text_i18n: {
              zh: "更多好物推荐",
              ru: "Больше хороших товаров",
              tg: "Молҳои бештар",
            },
            products: missingProducts.map((mp: any) => ({
              product_id: mp.id,
              note_i18n: {
                zh: `${mp.name_i18n?.zh || mp.name || '未知商品'}`,
                ru: `${mp.name_i18n?.ru || ''}`,
                tg: `${mp.name_i18n?.tg || ''}`,
              },
              badge_text_i18n: { zh: '推荐', ru: 'Рек.', tg: 'Тавсия' },
            })),
          });
        }
        contentResult.sections = sections;
      }

      // 检查空话黑名单
      const allText = [
        contentResult.title_i18n?.zh || "",
        contentResult.subtitle_i18n?.zh || "",
        contentResult.intro_i18n?.zh || "",
        ...sections.map((s: any) => s.story_text_i18n?.zh || ""),
      ].join(" ");

      const bannedFound = detectBannedPhrases(allText);
      if (bannedFound.length > 0) {
        qualityWarnings.push(`检测到空泛营销套话: ${bannedFound.join("、")}`);
      }

      // 检查本地锚点
      if (!understanding.local_anchors_used || understanding.local_anchors_used.length === 0) {
        qualityWarnings.push("未输出本地生活锚点，内容可能缺乏本地化深度");
      }

      // 向后兼容：从 sections 生成 product_notes 和 story_blocks_i18n
      const productNotes: any[] = [];
      const storyBlocksI18n: any[] = [];
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        storyBlocksI18n.push({
          block_key: `section_${i}`,
          block_type: "paragraph",
          zh: section.story_text_i18n?.zh || "",
          ru: section.story_text_i18n?.ru || "",
          tg: section.story_text_i18n?.tg || "",
        });
        for (const p of (section.products || [])) {
          productNotes.push({
            product_id: p.product_id,
            note_i18n: p.note_i18n || {},
            badge_text_i18n: p.badge_text_i18n || {},
          });
        }
      }

      // ─── 8. Step C: 封面图生成（可选）────────────────────
      let coverImageUrl: string | null = null;
      let coverImageUrls: string[] = [];

      if (generate_cover && dashscopeApiKey) {
        await sendSSE({ status: "processing", progress: 70, stage: "正在生成专题封面图...", task_id: taskId });

        try {
          // 收集有图片的商品
          const productsWithImages = selected_products.filter((p: any) => p.image_url);

          if (productsWithImages.length === 0) {
            qualityWarnings.push("没有可用的商品图片，跳过封面图生成");
          } else if (cover_mode === "product_collage") {
            // ─── product_collage 模式：从商品图片中拼接封面 ───
            // 选取前3张商品图片，分别用不同背景风格生成
            const collageProducts = productsWithImages.slice(0, 3);
            const collagePrompts = [
              "Clean modern product showcase on white marble surface, soft natural lighting, minimalist composition, professional e-commerce banner, 4k",
              "Warm cozy lifestyle flat lay arrangement, wooden table background, soft warm lighting, magazine style product photography, high quality",
            ];

            const coverTasks: string[] = [];
            for (let ci = 0; ci < collageProducts.length && ci < 2; ci++) {
              try {
                const tid = await submitWanxCoverTask(
                  dashscopeApiKey,
                  collageProducts[ci].image_url,
                  collagePrompts[ci % collagePrompts.length]
                );
                coverTasks.push(tid);
                console.log(`[Step C collage] 封面图任务已提交: ${tid}`);
              } catch (e) {
                console.error("[Step C collage] 封面图任务提交失败:", e);
              }
            }

            for (let i = 0; i < coverTasks.length; i++) {
              try {
                await sendSSE({
                  status: "processing",
                  progress: 75 + i * 5,
                  stage: `正在等待商品封面图 ${i + 1}/${coverTasks.length} 生成完成...`,
                  task_id: taskId,
                });
                const tempUrl = await pollWanxResult(dashscopeApiKey, coverTasks[i], 30, 3000);
                const permanentUrl = await downloadAndUploadToStorage(tempUrl, supabase, "topic-covers");
                coverImageUrls.push(permanentUrl);
                console.log(`[Step C collage] 封面图 ${i + 1} 已保存: ${permanentUrl}`);
              } catch (e) {
                console.error(`[Step C collage] 封面图 ${i + 1} 失败:`, e);
                qualityWarnings.push(`商品封面图 ${i + 1} 生成失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            }

            if (coverImageUrls.length > 0) {
              coverImageUrl = coverImageUrls[0];
            }
          } else {
            // ─── ai_generate 模式（默认）：AI 场景图 ───
            const baseProduct = productsWithImages[0];
            const baseImageUrl = baseProduct.image_url;

            const coverPrompt = understanding.cover_image_prompt ||
              "Professional lifestyle product showcase, warm cozy home environment, soft natural lighting, modern minimalist style, high quality commercial photography";

            // 生成两种风格的封面
            const coverPrompts = [
              coverPrompt,
              "Clean modern product display, soft gradient background, warm tones, professional e-commerce banner style, high quality, 4k resolution",
            ];

            const coverTasks: string[] = [];
            for (const prompt of coverPrompts) {
              try {
                const tid = await submitWanxCoverTask(dashscopeApiKey, baseImageUrl, prompt);
                coverTasks.push(tid);
                console.log(`[Step C ai] 封面图任务已提交: ${tid}`);
              } catch (e) {
                console.error("[Step C ai] 封面图任务提交失败:", e);
              }
            }

            for (let i = 0; i < coverTasks.length; i++) {
              try {
                await sendSSE({
                  status: "processing",
                  progress: 75 + i * 5,
                  stage: `正在等待封面图 ${i + 1}/${coverTasks.length} 生成完成...`,
                  task_id: taskId,
                });
                const tempUrl = await pollWanxResult(dashscopeApiKey, coverTasks[i], 30, 3000);
                const permanentUrl = await downloadAndUploadToStorage(tempUrl, supabase, "topic-covers");
                coverImageUrls.push(permanentUrl);
                console.log(`[Step C ai] 封面图 ${i + 1} 已保存: ${permanentUrl}`);
              } catch (e) {
                console.error(`[Step C ai] 封面图 ${i + 1} 失败:`, e);
                qualityWarnings.push(`封面图 ${i + 1} 生成失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            }

            if (coverImageUrls.length > 0) {
              coverImageUrl = coverImageUrls[0];
            }
          }
        } catch (e) {
          console.error("[Step C] 封面图生成整体失败:", e);
          qualityWarnings.push(`封面图生成失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // ─── 9. 组装最终结果 ──────────────────────────────────
      await sendSSE({ status: "processing", progress: 90, stage: "正在组装最终结果...", task_id: taskId });

      const finalResult = {
        // 理解层结果
        understanding: {
          overall_theme: understanding.overall_theme,
          story_angle: understanding.story_angle,
          local_anchors_used: understanding.local_anchors_used || [],
          risk_notes: understanding.risk_notes || [],
          products_analysis: understanding.products_analysis || [],
          product_groups: understanding.product_groups || [],
          recommended_topic_type: understanding.recommended_topic_type || "story",
          recommended_card_style: understanding.recommended_card_style || "story_card",
          cover_image_prompt: understanding.cover_image_prompt || "",
        },
        // v2 内容表达层结果 — sections 模式
        title_i18n: contentResult.title_i18n || {},
        subtitle_i18n: contentResult.subtitle_i18n || {},
        intro_i18n: contentResult.intro_i18n || {},
        sections: contentResult.sections || [],
        // 向后兼容
        story_blocks_i18n: storyBlocksI18n,
        product_notes: productNotes,
        placement_variants: contentResult.placement_variants || [],
        recommended_category_ids: contentResult.recommended_category_ids || [],
        recommended_tag_ids: contentResult.recommended_tag_ids || [],
        // v2 封面图
        cover_image_url: coverImageUrl,
        cover_image_urls: coverImageUrls,
        // 质量元数据
        explanation: {
          local_anchors: understanding.local_anchors_used || [],
          selected_story_angle: understanding.story_angle || "",
          risk_notes: understanding.risk_notes || [],
        },
        quality_warnings: qualityWarnings,
      };

      // ─── 10. 更新任务记录 ─────────────────────────────────
      if (taskId) {
        try {
          await supabase
            .from("ai_topic_generation_tasks")
            .update({
              status: finalStatus,
              result_payload: finalResult,
              completed_at: new Date().toISOString(),
            })
            .eq("id", taskId);
        } catch (e) {
          console.error("[ai-topic-generate] 更新任务记录失败:", e);
        }
      }

      // ─── 11. 返回最终结果 ─────────────────────────────────
      await sendSSE({
        status: finalStatus,
        progress: 100,
        stage: finalStatus === "done" ? "全部完成" : "部分完成（请检查质量警告）",
        result: finalResult,
        task_id: taskId,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[ai-topic-generate] 未预期错误:", errMsg);
      await sendSSE({ status: "error", progress: 0, error: errMsg });
    } finally {
      try {
        await writer.close();
      } catch {
        // 已关闭
      }
    }
  })();

  // 立即返回 SSE 流
  return new Response(stream.readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
