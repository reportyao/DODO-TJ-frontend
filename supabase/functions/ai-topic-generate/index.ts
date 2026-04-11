/**
 * AI 专题生成助手 — Edge Function
 *
 * 核心后端逻辑，串联两层 AI 调用，通过 SSE 流式返回进度和结果。
 *
 * 执行链路（两层架构）：
 *   Step A: 商品理解层 (qwen3.5-plus)
 *     → 分析选中商品在塔吉克本地生活中的使用场景、目标人群、生活锚点、风险点
 *   Step B: 内容表达层 (qwen3.5-plus)
 *     → 基于理解层结果 + 运营输入，生成三语专题草稿（标题、副标题、导语、
 *       sections 段落分组、卡片文案变体）
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
// Step A: 商品理解层 (qwen3.5-plus)
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
  // 构建商品信息摘要（如果已有 ai_understanding 则附带到摘要中）
  const productSummaries = products.map((p, i) => {
    const name = p.name_i18n?.zh || p.name_i18n?.ru || p.name || "未知商品";
    const desc = p.description_i18n?.zh || p.description_i18n?.ru || "";
    const categories = (p.categories || []).map((c: any) => c.name_i18n?.zh || c.code).join("、");
    const tags = (p.tags || []).map((t: any) => t.name_i18n?.zh || t.code).join("、");
    const price = p.original_price || p.active_lottery?.ticket_price || "未知";
    let summary = `商品${i + 1}(ID: ${p.id}): ${name}\n  描述: ${desc}\n  分类: ${categories || "无"}\n  标签: ${tags || "无"}\n  价格: ${price} сомони`;
    // 如果已有 AI 理解数据，附带到摘要中供 AI 参考复用
    if (p.ai_understanding) {
      const u = p.ai_understanding;
      summary += `\n  [已有AI理解] 适合谁: ${u.target_people || "未知"} | 好在哪: ${u.selling_angle || "未知"} | 场景: ${u.best_scene || "未知"} | 本地关联: ${u.local_life_connection || "未知"} | 标签: ${u.recommended_badge || "未知"}`;
    }
    return summary;
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
重要：部分商品已标注“[已有AI理解]”，请直接复用这些已有的理解数据作为该商品的 products_analysis 输出（可根据本次专题场景微调）。没有标注的商品则需要从头分析。

请对每个商品进行深度理解分析，并输出以下 JSON 结构：
{
  "overall_theme": "这组商品整体适合什么样的生活主题（一句话）",
  "story_angle": "推荐的叙事角度（例如：冬天回家晚了，想快点吃上热饭）",
  "local_anchors_used": ["实际引用的本地生活锚点1", "锚点2", "锚点3"],
  "risk_notes": ["需要注意的风险点，如某商品不适合该场景", "可能的文化敏感点"],
  "products_analysis": [
    {
      "product_id": "商品的真实UUID",
      "product_name": "商品名称",
      "best_scene": "这个商品在本次专题场景中最自然的使用画面（具体到动作和场景）",
      "target_people": "最适合的人群描述",
      "local_life_connection": "与塔吉克本地生活的真实连接点",
      "selling_angle": "不是卖点，而是'为什么这个人在这个场景下会觉得这个东西好用'",
      "recommended_badge": "推荐的商品角标文案（如：做饭省心、待客体面、冬天必备）"
    }
  ],
  "product_groups": [
    {
      "group_theme": "分组主题（如：厨房好帮手、客厅氛围感）",
      "product_ids": ["商品UUID1", "商品UUID2"]
    }
  ],
  "cover_image_prompt": "基于专题主题和生活场景，用英文描述一张适合作为专题封面的图片场景。要求：温馨的家庭/生活场景，不包含文字，不包含具体商品，重点是氛围和情感。例如：A warm cozy Central Asian kitchen with golden afternoon light, a family gathering around a table with traditional textiles, soft bokeh background, lifestyle photography style",
  "recommended_topic_type": "story|collection|seasonal|gift_guide",
  "recommended_card_style": "story_card|image_card|minimal_card"
}

要求：
1. "best_scene" 必须是具体的生活画面，不能是抽象描述
2. "local_life_connection" 必须引用真实的塔吉克生活习惯
3. 不要使用"高品质""甄选""品质生活"等空泛营销词
4. products_analysis 必须包含上面列出的全部 ${products.length} 个商品，不可省略
5. product_id 必须使用上面商品列表中括号里的真实 ID（UUID 格式）
6. cover_image_prompt 必须用英文写，描述一个温馨的生活场景图片，不包含任何文字和具体商品，重点是氛围和情感
7. product_groups 将商品按场景分组，每组有一个主题
8. 请只输出 JSON，不要添加任何其他文字说明`;

  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3.5-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 16384,
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
// Step A-lite: 精简版专题分析（所有商品已有 ai_understanding 时使用）
// ============================================================

/**
 * 精简版专题分析：当所有商品都已有 ai_understanding 时，
 * 仅生成专题层面的整体分析（overall_theme、story_angle、product_groups、cover_image_prompt 等），
 * 不再重复分析每个商品，节省 API 调用成本和响应时间。
 */
async function runTopicLevelAnalysis(
  apiKey: string,
  existingAnalysis: any[],
  topicGoal: string,
  coreScene: string[],
  targetAudience: string[],
  localContextHints: string[],
  lexiconEntries: any[]
): Promise<any> {
  const productSummaries = existingAnalysis.map((p, i) =>
    `商品${i + 1}(ID: ${p.product_id}): ${p.product_name}\n  目标人群: ${p.target_people}\n  卖点: ${p.selling_angle}\n  场景: ${p.best_scene}\n  本地关联: ${p.local_life_connection}\n  标签: ${p.recommended_badge}`
  ).join("\n\n");

  const lexiconRef = lexiconEntries.length > 0
    ? lexiconEntries.map((e: any) => {
        const title = e.title_i18n?.zh || e.code;
        const content = e.content_i18n?.zh || "";
        return `[${e.lexicon_group}] ${title}: ${content}`;
      }).join("\n")
    : "暂无词库条目";

  const prompt = `你是一名深入了解塔吉克斯坦本地生活的专题策划师。以下商品已经有了详细的分析数据，你的任务是基于这些已有分析，为整个专题生成整体策划方案。

【专题目标】
${topicGoal}

【核心场景】
${coreScene.join("、") || "未指定"}

【目标人群】
${targetAudience.join("、") || "未指定"}

【商品已有分析】
${productSummaries}

【本地化词库参考】
${lexiconRef}

${localContextHints.length > 0 ? `【本地生活提示】\n${localContextHints.join("、")}\n` : ""}请输出以下 JSON 结构（注意：不需要输出 products_analysis，因为已有）：
{
  "overall_theme": "这组商品整体适合什么样的生活主题（一句话）",
  "story_angle": "推荐的叙事角度",
  "local_anchors_used": ["实际引用的本地生活锚点1", "锚点2"],
  "risk_notes": ["需要注意的风险点"],
  "product_groups": [
    {
      "group_theme": "分组主题",
      "product_ids": ["商品UUID1", "商品UUID2"]
    }
  ],
  "cover_image_prompt": "基于专题主题，用英文描述一张适合作为封面的温馨生活场景图片，不包含文字和具体商品",
  "recommended_topic_type": "story|collection|seasonal|gift_guide",
  "recommended_card_style": "story_card|image_card|minimal_card"
}

请只输出 JSON，不要添加任何其他文字说明。`;

  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3.5-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 8192,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`专题分析层调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error("专题分析层返回内容为空");

  return parseAIJson(rawContent);
}

// ============================================================
// Step B: 内容表达层 (qwen3.5-plus)
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

  // 构建商品ID参考表（简洁格式，节省token）
  const productIdRef = selectedProducts.map((p: any, i: number) => {
    const name = p.name_i18n?.zh || p.name_i18n?.ru || p.name || '未知商品';
    return `  ${i + 1}. "${p.id}" = ${name}`;
  }).join('\n');

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

请基于以上信息，生成完整的专题草稿。你需要把全部 ${selectedProducts.length} 个商品按场景分组到不同段落（sections）中。每个段落有自己的场景文案和关联商品。

⚠️ 重要：只需要输出 sections，不需要输出 story_blocks_i18n 和 product_notes（后端会自动从 sections 生成）。这样可以节省输出长度，确保所有商品都被覆盖。

输出以下 JSON 结构：
{
  "title_i18n": {"zh": "中文标题（15-25字，像朋友推荐，不像广告标题）", "ru": "俄语标题", "tg": "塔吉克语标题"},
  "subtitle_i18n": {"zh": "中文副标题（一句话点明场景）", "ru": "俄语副标题", "tg": "塔吉克语副标题"},
  "intro_i18n": {"zh": "中文导语（2-3句，描绘一个具体的生活画面，让人代入）", "ru": "俄语导语", "tg": "塔吉克语导语"},
  "sections": [
    {
      "story_text_i18n": {
        "zh": "中文段落文案（围绕一个生活场景展开，自然引入本段关联的商品）",
        "ru": "俄语段落文案（本地化改写，不是直译）",
        "tg": "塔吉克语段落文案"
      },
      "products": [
        {
          "product_id": "从下方商品ID列表中复制真实UUID",
          "note_i18n": {"zh": "这个商品在本段场景中的说明（1-2句）", "ru": "俄语", "tg": "塔吉克语"},
          "badge_text_i18n": {"zh": "角标文案（2-4字）", "ru": "俄语角标", "tg": "塔吉克语角标"}
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
  ]
}

【必须使用的商品ID列表】（共 ${selectedProducts.length} 个，请从这里复制真实 UUID）
${productIdRef}

要求：
1. 标题和导语必须像"熟人推荐"，不能像"品牌宣传册"
2. sections 中每个段落要有具体的生活画面，不能只是抽象描述商品功能
3. 俄语和塔吉克语必须做本地化改写，不是中文的逐句翻译
4. 卡片变体至少 2 个，从不同角度吸引点击
5. ❗❗ 全部 ${selectedProducts.length} 个商品必须出现在 sections 的 products 中，不可省略任何一个
6. ❗❗ product_id 必须使用上方商品ID列表中的真实 UUID，不要使用"商品1"等占位符
7. 可以把多个商品分到同一个段落中，建议每个段落 2-5 个商品
8. 请只输出 JSON，不要添加任何其他文字说明`;

  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3.5-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens: 16384,
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

  // 检查是否因 token 限制被截断
  const finishReason = result.choices?.[0]?.finish_reason;
  if (finishReason === "length") {
    console.warn("[ai-topic-generate] ⚠️ AI 输出因 token 限制被截断 (finish_reason=length)");
  }

  return parseAIJson(rawContent);
}

// ============================================================
// Step C: 封面图生成层 (wan2.6-t2i) — 异步调用模式
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
  const imgResponse = await fetch(tempUrl);
  if (!imgResponse.ok) {
    throw new Error(
      `下载临时图片失败 (HTTP ${imgResponse.status}): ${tempUrl}`
    );
  }

  const arrayBuffer = await imgResponse.arrayBuffer();
  const contentType = imgResponse.headers.get("content-type") || "image/png";

  const ext = contentType.includes("jpeg") || contentType.includes("jpg")
    ? "jpg"
    : "png";
  const fileName = `ai-topic-covers/${Date.now()}_${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(fileName, arrayBuffer, {
      cacheControl: "31536000",
      upsert: false,
      contentType,
    });

  if (uploadError) {
    throw new Error(`上传到 Storage 失败: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("product-images").getPublicUrl(fileName);

  return publicUrl;
}

/**
 * 提交万相 wan2.6-t2i 异步文生图任务
 * @param apiKey DashScope API Key
 * @param coverPrompt 封面图描述 prompt
 * @param n 生成图片数量
 * @returns 异步任务 task_id
 */
async function submitWanxT2iTask(
  apiKey: string,
  coverPrompt: string,
  n: number = 2
): Promise<string> {
  const response = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "wan2.6-t2i",
        input: {
          messages: [
            {
              role: "user",
              content: [
                {
                  text: coverPrompt,
                },
              ],
            },
          ],
        },
        parameters: {
          size: "1280*1280",
          n: n,
          prompt_extend: true,
          watermark: false,
          negative_prompt: "低分辨率，低画质，文字，水印，模糊，变形，丑陋，过度饱和",
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `万相封面图任务提交失败 (HTTP ${response.status}): ${errText}`
    );
  }

  const result = await response.json();
  const wanxTaskId = result.output?.task_id;
  if (!wanxTaskId) {
    throw new Error(
      `万相封面图任务提交未返回 task_id: ${JSON.stringify(result)}`
    );
  }

  console.log(`[ai-topic-generate] 万相封面图任务已提交，task_id: ${wanxTaskId}`);
  return wanxTaskId;
}

/**
 * 轮询万相 wan2.6-t2i 异步任务结果
 * @param apiKey DashScope API Key
 * @param wanxTaskId 万相任务 ID
 * @param maxPolls 最大轮询次数（默认 60，约 5 分钟）
 * @param interval 轮询间隔毫秒（默认 5000）
 * @returns 生成的图片临时 URL 数组
 */
async function pollWanxT2iResult(
  apiKey: string,
  wanxTaskId: string,
  maxPolls: number = 60,
  interval: number = 5000,
  onProgress?: (pollCount: number, maxPolls: number) => Promise<void>
): Promise<string[]> {
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    try {
      const response = await fetch(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${wanxTaskId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        consecutiveErrors++;
        console.warn(
          `[轮询] 封面图任务 ${wanxTaskId} 查询失败 (${consecutiveErrors}/${maxConsecutiveErrors}): HTTP ${response.status}`
        );
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `万相封面图任务查询连续失败 ${maxConsecutiveErrors} 次 (HTTP ${response.status}): ${errText}`
          );
        }
        continue;
      }

      // 查询成功，重置连续错误计数
      consecutiveErrors = 0;

      const result = await response.json();
      const status = result.output?.task_status;

      if (status === "SUCCEEDED") {
        // wan2.6-t2i 异步成功后，图片在 choices[].message.content[].image 中
        const choices = result.output?.choices || [];
        const imageUrls: string[] = [];
        for (const choice of choices) {
          const imageUrl = choice.message?.content?.[0]?.image;
          if (imageUrl) {
            imageUrls.push(imageUrl);
          }
        }
        if (imageUrls.length === 0) {
          throw new Error("万相封面图任务成功但未返回图片 URL");
        }
        console.log(`[ai-topic-generate] 万相封面图任务完成，获得 ${imageUrls.length} 张图片`);
        return imageUrls;
      }

      if (status === "FAILED") {
        const errMsg =
          result.output?.message || result.output?.code || "未知错误";
        throw new Error(`万相封面图任务失败: ${errMsg}`);
      }

      // PENDING / RUNNING → 继续轮询
      if (i % 6 === 0) {
        console.log(
          `[ai-topic-generate] 封面图任务 ${wanxTaskId} 状态: ${status}，已轮询 ${i + 1} 次`
        );
      }
      // [修复] 每次轮询后回调进度，让调用方可以发送 SSE 进度更新
      if (onProgress) {
        try { await onProgress(i + 1, maxPolls); } catch {}
      }
    } catch (error) {
      // 区分业务错误（应立即抛出）和网络错误（可容忍）
      if (
        error instanceof Error &&
        (error.message.includes("万相封面图任务失败") ||
         error.message.includes("未返回图片 URL") ||
         error.message.includes("连续失败"))
      ) {
        throw error;
      }
      // 网络层错误（fetch 异常），计入连续错误
      consecutiveErrors++;
      console.warn(
        `[轮询] 封面图任务 ${wanxTaskId} 网络错误 (${consecutiveErrors}/${maxConsecutiveErrors}):`,
        error instanceof Error ? error.message : error
      );
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(
          `万相封面图任务轮询网络连续失败 ${maxConsecutiveErrors} 次: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  throw new Error(`万相封面图任务超时 (轮询 ${maxPolls} 次未完成)`);
}

/**
 * 使用万相 wan2.6-t2i 异步API生成封面图（提交任务 + 轮询结果）
 * @param apiKey DashScope API Key
 * @param coverPrompt 封面图描述 prompt
 * @param supabase Supabase 客户端
 * @param n 生成图片数量
 * @param onProgress [修复] 轮询进度回调，用于 SSE 进度更新
 * @returns 永久图片 URL 数组
 */
async function generateCoverImages(
  apiKey: string,
  coverPrompt: string,
  supabase: any,
  n: number = 2,
  onProgress?: (pollCount: number, maxPolls: number) => Promise<void>
): Promise<string[]> {
  console.log(`[ai-topic-generate] 开始生成封面图（异步模式），prompt: ${coverPrompt.substring(0, 100)}...`);

  // 步骤1：提交异步任务，获取 task_id
  const wanxTaskId = await submitWanxT2iTask(apiKey, coverPrompt, n);

  // 步骤2：轮询任务结果，获取临时图片 URL（传递进度回调）
  const tempUrls = await pollWanxT2iResult(apiKey, wanxTaskId, 60, 5000, onProgress);

  // 步骤3：下载临时 URL 并上传到 Supabase Storage 永久化
  const permanentUrls: string[] = [];
  for (const tempUrl of tempUrls) {
    try {
      const permanentUrl = await downloadAndUploadToStorage(tempUrl, supabase);
      permanentUrls.push(permanentUrl);
      console.log(`[ai-topic-generate] 封面图已上传: ${permanentUrl}`);
    } catch (e) {
      console.error(`[ai-topic-generate] 封面图上传失败:`, e);
    }
  }

  return permanentUrls;
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

      // [v5 修复] verify_admin_session RPC 返回值可能是：
      //   - UUID 字符串 (直接返回 admin_id)
      //   - JSON 字符串 (需要 parse 后取 admin_id)
      //   - 对象 (直接取 admin_id)
      let adminId: string | undefined;
      if (typeof sessionData === "string") {
        // 尝试 JSON.parse，如果失败则直接当作 admin_id (UUID)
        try {
          const parsed = JSON.parse(sessionData);
          adminId = parsed?.admin_id || sessionData;
        } catch {
          // sessionData 本身就是 admin_id (UUID 字符串)
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
        generate_cover = true,
        cover_mode = "ai_generate",
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
        // 不阻断，继续生成
      }

      // ─── 4. 加载词库数据 ──────────────────────────────────
      // [v4 修复] 创建任务记录后，所有 processing 事件都携带 task_id
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
        // 不阻断，词库为空也可以继续
      }

         // ─── 5. Step A: 商品理解层（优化：复用已有数据）────────────────

      // 检查哪些商品已有 ai_understanding
      const productsWithUnderstanding = selected_products.filter(
        (p: any) => p.ai_understanding && p.ai_understanding.target_people
      );
      const productsWithoutUnderstanding = selected_products.filter(
        (p: any) => !p.ai_understanding || !p.ai_understanding.target_people
      );

      let understanding: any;

      if (productsWithoutUnderstanding.length === 0) {
        // 所有商品都有 AI 理解数据 → 跳过逐商品理解，仅生成专题层面的整体分析
        await sendSSE({
          status: "processing",
          progress: 25,
          stage: `所有 ${selected_products.length} 个商品已有 AI 理解数据，正在生成专题整体分析...`,
          task_id: taskId,
        });

        // 从已有数据组装 products_analysis
        const existingAnalysis = selected_products.map((p: any) => ({
          product_id: p.id,
          product_name: p.name_i18n?.zh || p.name || "未知商品",
          best_scene: p.ai_understanding.best_scene || "",
          target_people: p.ai_understanding.target_people || "",
          local_life_connection: p.ai_understanding.local_life_connection || "",
          selling_angle: p.ai_understanding.selling_angle || "",
          recommended_badge: p.ai_understanding.recommended_badge || "",
        }));

        try {
          understanding = await withRetry(
            () => runTopicLevelAnalysis(
              dashscopeApiKey,
              existingAnalysis,
              topic_goal,
              core_scene,
              target_audience,
              local_context_hints,
              lexiconEntries
            ),
            2,
            2000
          );
          // 将已有的 products_analysis 合并到结果中
          understanding.products_analysis = existingAnalysis;
        } catch (error) {
          // 如果精简分析也失败，回退到完整分析
          console.warn("[ai-topic-generate] 精简分析失败，回退到完整分析:", error instanceof Error ? error.message : String(error));
          try {
            understanding = await withRetry(
              () => runProductUnderstanding(
                dashscopeApiKey, selected_products, topic_goal,
                core_scene, target_audience, local_context_hints, lexiconEntries
              ),
              2, 2000
            );
          } catch (fallbackError) {
            const errMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
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
        }
      } else {
        // 部分或全部商品没有 AI 理解数据 → 走原有的完整分析流程
        await sendSSE({
          status: "processing",
          progress: 25,
          stage: `AI 正在分析 ${selected_products.length} 个商品与本地生活场景的关系...`,
          task_id: taskId,
        });

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
      }

      await sendSSE({
        status: "processing",
        progress: 50,
        stage: `商品理解完成：${understanding.story_angle || "已分析"} — 正在生成三语专题草稿...`,
        task_id: taskId,
      });

      // ─── 6. Step B: 内容表达层 ────────────────────────────
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

        // 如果内容层失败但理解层成功，返回 partial 结果
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
          // [修复] 补充封面图字段，确保与 AITopicDraftResult 类型定义一致
          cover_image_url: null,
          cover_image_urls: [],
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

       // ─── 6.5 Step C: 封面图生成（异步模式） ────────────────
      let coverImageUrls: string[] = [];
      let coverImageUrl: string | null = null;
      let coverGenerationError: string | null = null;  // [修复] 记录封面图生成错误信息

      if (generate_cover && cover_mode === "ai_generate") {
        await sendSSE({ status: "processing", progress: 75, stage: "正在提交AI封面图生成任务...", task_id: taskId });

        try {
          // 使用理解层生成的 cover_image_prompt，如果没有则基于主题自动构建
          let coverPrompt = understanding.cover_image_prompt;
          if (!coverPrompt || coverPrompt.trim().length === 0) {
            // 基于理解层的主题和叙事角度自动构建封面图 prompt
            const theme = understanding.overall_theme || topic_goal;
            const angle = understanding.story_angle || '';
            coverPrompt = `A warm and inviting lifestyle photography scene related to: ${theme}. ${angle ? `The mood is: ${angle}.` : ''} Central Asian home setting, soft natural lighting, cozy atmosphere, no text, no logos, no specific products visible, focus on warmth and daily life ambiance, professional photography, shallow depth of field, warm color palette.`;
          }

          // [修复] 传入 onProgress 回调，在轮询期间定期发送 SSE 进度更新，避免用户以为卡住
          const coverOnProgress = async (pollCount: number, maxPolls: number) => {
            // 进度从 75 到 82 之间线性插值
            const p = Math.min(75 + Math.round((pollCount / maxPolls) * 7), 82);
            await sendSSE({
              status: "processing",
              progress: p,
              stage: `封面图生成中，请稍候... (轮询 ${pollCount}/${maxPolls})`,
              task_id: taskId,
            });
          };
          coverImageUrls = await withRetry(
            () => generateCoverImages(dashscopeApiKey, coverPrompt, supabase, 2, coverOnProgress),
            2,
            5000  // 异步任务使用更长的退避基数
          );

          if (coverImageUrls.length > 0) {
            coverImageUrl = coverImageUrls[0]; // 默认选择第一张
            console.log(`[ai-topic-generate] 封面图生成成功: ${coverImageUrls.length} 张`);
          }

          await sendSSE({ status: "processing", progress: 82, stage: "封面图生成完成", task_id: taskId });
        } catch (coverError) {
          const coverErrMsg = coverError instanceof Error ? coverError.message : String(coverError);
          console.error("[ai-topic-generate] 封面图生成失败 (不阻断主流程):", coverErrMsg);
          // [修复] 封面图生成失败不阻断整个流程，但记录到 quality_warnings 中供用户知晓
          coverGenerationError = coverErrMsg;
        }
      } else {
        console.log(`[ai-topic-generate] 跳过封面图生成 (generate_cover=${generate_cover}, cover_mode=${cover_mode})`);
      }

      // ─── 7. 质量校验 ─────────────────────────────────
      await sendSSE({ status: "processing", progress: 85, stage: "正在进行质量校验...", task_id: taskId });

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

      // 检查空话黑名单
      const allText = [
        contentResult.title_i18n?.zh || "",
        contentResult.subtitle_i18n?.zh || "",
        contentResult.intro_i18n?.zh || "",
        ...(contentResult.sections || []).map((s: any) => s.story_text_i18n?.zh || ""),
      ].join(" ");

      const bannedFound = detectBannedPhrases(allText);
      if (bannedFound.length > 0) {
        qualityWarnings.push(`检测到空泛营销套话: ${bannedFound.join("、")}`);
      }

      // 检查本地锚点
      if (!understanding.local_anchors_used || understanding.local_anchors_used.length === 0) {
        qualityWarnings.push("未输出本地生活锚点，内容可能缺乏本地化深度");
      }

      // ─── 8. 修复 product_id 占位符 + 构建兼容字段 ─────────
      await sendSSE({ status: "processing", progress: 90, stage: "正在组装最终结果...", task_id: taskId });

      // 构建 "商品N" → 真实 ID 的映射表
      const productIdMap: Record<string, string> = {};
      selected_products.forEach((p: any, i: number) => {
        productIdMap[`商品${i + 1}`] = p.id;
        productIdMap[`product_${i + 1}`] = p.id;
        productIdMap[`Product ${i + 1}`] = p.id;
      });

      // 处理 sections：修复其中的 product_id 占位符
      let finalSections = contentResult.sections || [];
      if (finalSections.length > 0) {
        finalSections = finalSections.map((section: any) => ({
          ...section,
          products: (section.products || []).map((sp: any) => ({
            ...sp,
            product_id: productIdMap[sp.product_id] || sp.product_id,
          })),
        }));
      }

      // 检查 sections 中的商品覆盖率
      const sectionProductIds = new Set<string>();
      for (const sec of finalSections) {
        for (const sp of (sec.products || [])) {
          sectionProductIds.add(sp.product_id);
        }
      }
      const missingProducts = selected_products.filter((p: any) => !sectionProductIds.has(p.id));

      if (missingProducts.length > 0) {
        qualityWarnings.push(
          `sections 中缺少 ${missingProducts.length}/${selected_products.length} 个商品: ${missingProducts.map((p: any) => p.name_i18n?.zh || p.name || p.id).join('、')}`
        );

        // 将缺失的商品添加到一个新的"其他推荐"段落
        const missingProductEntries = missingProducts.map((mp: any) => {
          const name = mp.name_i18n?.zh || mp.name || '未知商品';
          // 尝试从理解层获取该商品的分析
          const analysis = (understanding.products_analysis || []).find(
            (pa: any) => pa.product_id === mp.id || pa.product_name === (mp.name_i18n?.zh || mp.name)
          );
          return {
            product_id: mp.id,
            note_i18n: {
              zh: analysis?.best_scene || `${name}（AI 未生成说明，请手动编辑）`,
              ru: `${mp.name_i18n?.ru || name}`,
              tg: `${mp.name_i18n?.tg || name}`,
            },
            badge_text_i18n: {
              zh: analysis?.recommended_badge || '待编辑',
              ru: 'Ред.',
              tg: 'Таҳрир',
            },
          };
        });

        finalSections.push({
          story_text_i18n: {
            zh: '其他推荐商品',
            ru: 'Другие рекомендуемые товары',
            tg: 'Дигар молҳои тавсияшаванда',
          },
          products: missingProductEntries,
        });
      }

      // [v10] 从 sections 自动构建 story_blocks_i18n（向后兼容）
      const storyBlocksI18n = finalSections.map((sec: any, idx: number) => ({
        block_key: `block_${idx + 1}`,
        block_type: "paragraph",
        zh: sec.story_text_i18n?.zh || '',
        ru: sec.story_text_i18n?.ru || '',
        tg: sec.story_text_i18n?.tg || '',
      }));

      // [v10] 从 sections 自动构建 product_notes（向后兼容）
      const productNotes: any[] = [];
      for (const sec of finalSections) {
        for (const sp of (sec.products || [])) {
          productNotes.push({
            product_id: sp.product_id,
            note_i18n: sp.note_i18n || {},
            badge_text_i18n: sp.badge_text_i18n || {},
          });
        }
      }

      // 组装最终结果
      const finalResult = {
        // 理解层结果
        understanding: {
          overall_theme: understanding.overall_theme,
          story_angle: understanding.story_angle,
          local_anchors_used: understanding.local_anchors_used || [],
          risk_notes: understanding.risk_notes || [],
          product_groups: understanding.product_groups || [],
          products_analysis: understanding.products_analysis || [],
          recommended_topic_type: understanding.recommended_topic_type || "story",
          recommended_card_style: understanding.recommended_card_style || "story_card",
          cover_image_prompt: understanding.cover_image_prompt || "",
        },
        // 内容表达层结果
        title_i18n: contentResult.title_i18n || {},
        subtitle_i18n: contentResult.subtitle_i18n || {},
        intro_i18n: contentResult.intro_i18n || {},
        // v2: sections 模式（主要数据源）
        sections: finalSections,
        // 向后兼容字段（从 sections 自动生成）
        story_blocks_i18n: storyBlocksI18n,
        placement_variants: contentResult.placement_variants || [],
        product_notes: productNotes,
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
        // [修复] 使用 coverGenerationError 提供更精确的封面图警告信息
        quality_warnings: (() => {
          const warnings = [...qualityWarnings];
          if (generate_cover && cover_mode === "ai_generate") {
            if (coverImageUrls.length === 0 && coverGenerationError) {
              warnings.push(`封面图生成失败 (${coverGenerationError})，请在专题管理页手动上传封面图`);
            } else if (coverImageUrls.length === 0) {
              warnings.push("封面图生成失败，请在专题管理页手动上传封面图");
            }
          } else if (!generate_cover) {
            warnings.push("未启用AI封面图生成，请在专题管理页手动上传封面图");
          }
          return warnings;
        })(),
      };

      // ─── 9. 更新任务记录 ──────────────────────────────────
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

      // ─── 10. 返回最终结果 ─────────────────────────────────
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
