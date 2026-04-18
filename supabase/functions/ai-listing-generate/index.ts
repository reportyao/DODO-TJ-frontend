/**
 * AI 商品上架助手 — Edge Function
 *
 * 核心后端逻辑，串联 4 个外部 API 调用，通过 SSE 流式返回进度和结果。
 *
 * 执行链路 (v2.1)：
 *   Step A: 图片理解 (VISION_MODELS 降级链: qwen3.6-plus → qwen-vl-max)
 *   Step B: 三语文案生成 (TEXT_MODELS 降级链: qwen3.6-plus → qwen3-max → qwen-max)
 *   Step C: 商品分割 (SegmentCommodity)    → 去除背景，输出 RGBA PNG
 *   Step D: 营销海报规划 (TEXT_MODELS 降级链)
 *   Step E: 写入单图任务表 ai_image_tasks  → 由 ai-listing-image-processor (cron 触发) 逐张串行生成并合成俄文海报
 *
 * 模型降级逻辑：首选 qwen3.6-plus，额度用完/模型不可用时自动降级到备用模型
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
// 模型配置：首选 → 降级链
// ============================================================

/**
 * 视觉理解模型（支持图片输入）降级链：
 *   qwen3.6-plus（最新全能旗舰）→ qwen-vl-max（Qwen2.5-VL 稳定版）
 *
 * 文本生成模型降级链：
 *   qwen3.6-plus（最新全能旗舰）→ qwen3-max（Qwen3 旗舰文本）→ qwen-max（Qwen2.5 稳定版）
 */
const VISION_MODELS = ["qwen3.6-plus", "qwen-vl-max"] as const;
const TEXT_MODELS   = ["qwen3.6-plus", "qwen3-max", "qwen-max"] as const;

/** 运行时记录每个步骤实际使用的模型，用于写入 model_used 元数据 */
const modelTrace: Record<string, string> = {};

/**
 * 判断错误是否属于"额度耗尽 / 模型不可用"，应触发降级
 * - HTTP 429: 限流或额度用完
 * - HTTP 404: 模型不存在或无权限
 * - HTTP 403: 访问被拒
 * - 包含 quota / rate_limit / insufficient 等关键词
 */
function isQuotaOrModelError(errMsg: string): boolean {
  const lower = errMsg.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("404") ||
    lower.includes("403") ||
    lower.includes("quota") ||
    lower.includes("rate_limit") ||
    lower.includes("rate limit") ||
    lower.includes("insufficient") ||
    lower.includes("does not exist") ||
    lower.includes("model_not_found") ||
    lower.includes("access denied") ||
    lower.includes("billing")
  );
}

/**
 * 带模型降级的 DashScope 文本调用
 * 按 models 列表顺序尝试，遇到额度/模型错误自动降级到下一个
 */
async function callDashScopeWithFallback(
  apiKey: string,
  models: readonly string[],
  messages: any[],
  temperature: number,
  stepName: string
): Promise<{ content: string; modelUsed: string }> {
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      console.log(`[${stepName}] 尝试模型: ${model}`);
      const response = await fetch(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, messages, temperature }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        const errMsg = `${model} 调用失败 (HTTP ${response.status}): ${errText}`;
        console.warn(`[${stepName}] ${errMsg}`);

        if (isQuotaOrModelError(errMsg)) {
          lastError = new Error(errMsg);
          console.log(`[${stepName}] 检测到额度/模型错误，降级到下一个模型...`);
          continue; // 尝试下一个模型
        }
        // 非额度错误（如 500 服务端错误），直接抛出让 withRetry 处理
        throw new Error(errMsg);
      }

      const result = await response.json();
      const rawContent = result.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error(`${model} 返回内容为空`);
      }

      console.log(`[${stepName}] 模型 ${model} 调用成功`);
      modelTrace[stepName] = model;
      return { content: rawContent, modelUsed: model };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (isQuotaOrModelError(errMsg)) {
        lastError = error instanceof Error ? error : new Error(errMsg);
        console.log(`[${stepName}] 模型 ${model} 不可用，尝试降级...`);
        continue;
      }
      throw error; // 非降级错误，直接抛出
    }
  }

  // 所有模型都失败了
  throw lastError || new Error(`[${stepName}] 所有模型均不可用: ${models.join(", ")}`);
}

/** 构建 model_used 元数据字符串，反映实际使用的模型链 */
function buildModelUsedTrace(): string {
  const steps = ["StepA", "Understanding-tg", "Understanding-ru", "Understanding-zh"];
  const parts = steps
    .filter((s) => modelTrace[s])
    .map((s) => `${modelTrace[s]}(${s})`);
  return parts.join(" -> ") || "unknown";
}

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
      if (i === maxRetries - 1) {throw error;}
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

const AI_UNDERSTANDING_FIELDS = [
  "target_people",
  "selling_angle",
  "how_to_use",
  "best_scene",
  "local_life_connection",
  "recommended_badge",
] as const;

type AIUnderstandingField = (typeof AI_UNDERSTANDING_FIELDS)[number];
type LanguageCode = "tg" | "ru" | "zh";

type SemanticFacts = {
  product_type: string;
  core_function: string;
  target_user_traits: string[];
  primary_pain_points: string[];
  usage_steps: string[];
  usage_tips: string[];
  usage_scenarios: string[];
  parameter_highlights: string[];
  local_context_signals: string[];
  trust_signals: string[];
  badge_candidates: string[];
};

function cleanAIText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanAITextList(value: unknown, limit: number = 6): string[] {
  if (!Array.isArray(value)) {return [];}
  return value
    .map((item) => cleanAIText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeSemanticFacts(payload: any): SemanticFacts {
  const raw = payload?.semantic_facts && typeof payload.semantic_facts === "object"
    ? payload.semantic_facts
    : payload || {};

  return {
    product_type: cleanAIText(raw.product_type),
    core_function: cleanAIText(raw.core_function),
    target_user_traits: cleanAITextList(raw.target_user_traits),
    primary_pain_points: cleanAITextList(raw.primary_pain_points),
    usage_steps: cleanAITextList(raw.usage_steps),
    usage_tips: cleanAITextList(raw.usage_tips),
    usage_scenarios: cleanAITextList(raw.usage_scenarios),
    parameter_highlights: cleanAITextList(raw.parameter_highlights),
    local_context_signals: cleanAITextList(raw.local_context_signals),
    trust_signals: cleanAITextList(raw.trust_signals),
    badge_candidates: cleanAITextList(raw.badge_candidates, 4),
  };
}

function normalizeSingleLanguageUnderstanding(payload: any): Record<AIUnderstandingField, string> {
  const normalized = {} as Record<AIUnderstandingField, string>;

  for (const field of AI_UNDERSTANDING_FIELDS) {
    normalized[field] = cleanAIText(payload?.[field]);
  }

  return normalized;
}

function buildLocalizedAIUnderstanding(params: {
  semanticFacts: SemanticFacts;
  tg: Record<AIUnderstandingField, string>;
  ru: Record<AIUnderstandingField, string>;
  zh: Record<AIUnderstandingField, string>;
}) {
  const localized = {} as Record<string, { tg: string; ru: string; zh: string }>;

  for (const field of AI_UNDERSTANDING_FIELDS) {
    localized[field] = {
      tg: cleanAIText(params.tg[field]),
      ru: cleanAIText(params.ru[field]),
      zh: cleanAIText(params.zh[field]),
    };
  }

  return {
    ...localized,
    semantic_facts: params.semanticFacts,
    generated_at: new Date().toISOString(),
    generated_by: "ai-listing-generate",
    model_used: buildModelUsedTrace(),
    generation_mode: "semantic_facts_to_tg_ru_then_translate_zh",
    primary_market_language: "tg",
    display_priority: ["tg", "ru", "zh"] as LanguageCode[],
    source_language: "multi",
  };
}

async function callQwenJson(
  apiKey: string,
  _model: string, // 已废弃，改用 TEXT_MODELS 降级链
  prompt: string,
  temperature: number,
  stepName: string = "TextGen"
): Promise<any> {
  const { content } = await callDashScopeWithFallback(
    apiKey,
    TEXT_MODELS,
    [{ role: "user", content: prompt }],
    temperature,
    stepName
  );
  return parseAIJson(content);
}

function buildSemanticFactsPrompt(params: {
  category: string;
  productName: string;
  specs: string;
  notes: string;
}) {
  return `你是一名面向塔吉克斯坦电商业务的商品理解专家。请先抽取一份“语言无关、可复用、可审计”的结构化商品事实，为后续分别生成塔吉克语和俄语用户文案提供统一依据。

商品基础信息：
- 品类：${params.category}
- 名称：${params.productName}
- 规格：${params.specs || "未提供"}
- 补充备注：${params.notes || "无"}

请只输出以下 JSON：
{
  "semantic_facts": {
    "product_type": "一句话明确商品类型",
    "core_function": "一句话说明最核心用途",
    "target_user_traits": ["适合的人群特征1", "特征2"],
    "primary_pain_points": ["解决的问题1", "问题2"],
    "usage_steps": ["使用步骤或动作1", "步骤2"],
    "usage_tips": ["使用提醒或技巧1", "技巧2"],
    "usage_scenarios": ["典型场景1", "典型场景2"],
    "parameter_highlights": ["用户需要知道的参数亮点1", "亮点2"],
    "local_context_signals": ["与塔吉克本地生活的真实连接点1", "连接点2"],
    "trust_signals": ["提升信任感的事实1", "事实2"],
    "badge_candidates": ["候选角标1", "候选角标2", "候选角标3"]
  }
}

要求：
1. 只输出 JSON，不要附加任何说明。
2. 这是中间事实层，不要直接输出多语言营销文案。
3. usage_steps、usage_tips、parameter_highlights 必须尽量具体，帮助小白理解怎么用。
4. local_context_signals 必须贴近塔吉克真实生活，而不是空泛描述。
5. 如果信息不足，可以结合图片做谨慎推断，但不要夸张。`;
}

function buildDirectUnderstandingPrompt(params: {
  language: "tg" | "ru";
  semanticFacts: SemanticFacts;
  productName: string;
  price: number;
}) {
  const languageName = params.language === "tg" ? "塔吉克语" : "俄语";
  const languageRules = params.language === "tg"
    ? `
5. 请直接输出自然、地道、面向塔吉克普通消费者的塔吉克语，不要夹杂中文，也尽量避免俄语硬翻译腔。
6. 语言要像本地熟人推荐商品一样易懂，不要写成官方说明书。`
    : `
5. 请直接输出自然、可信、适合塔吉克斯坦电商用户阅读的俄语，不要写成官样宣传稿。
6. 语言要有人味，像懂商品的人在认真推荐。`;

  return `你是一名服务于塔吉克斯坦电商平台的本地化商品文案专家。现在请基于同一份结构化商品事实，直接生成面向普通用户的${languageName}商品理解文案。

商品名称：${params.productName}
商品价格：${params.price} сомони
结构化商品事实：${JSON.stringify(params.semanticFacts)}

请只输出以下 JSON：
{
  "target_people": "最适合的人群描述，要写出生活状态和使用动机",
  "selling_angle": "像熟人推荐一样解释为什么这个东西对他好用",
  "how_to_use": "给小白看的使用理解，可自然带出参数、场景或使用方法",
  "best_scene": "一个最具体、最自然的使用画面",
  "local_life_connection": "与塔吉克本地生活的真实连接点",
  "recommended_badge": "2-4个词的短角标"
}

要求：
1. target_people、selling_angle、how_to_use 都必须直接面向普通用户，不要写分析术语。
2. how_to_use 不能空泛，至少自然包含一种使用步骤、参数亮点或场景细节，重点帮助第一次接触这类商品的人快速理解怎么用。
3. best_scene 必须是具体画面，不要抽象概括。
4. recommended_badge 要短、顺口、适合做商品角标。${languageRules}
7. 只输出 JSON，不要附加任何说明。`;
}

async function generateDirectUnderstandingByLanguage(params: {
  apiKey: string;
  language: "tg" | "ru";
  semanticFacts: SemanticFacts;
  productName: string;
  price: number;
}) {
  return normalizeSingleLanguageUnderstanding(
    await callQwenJson(
      params.apiKey,
      "_",
      buildDirectUnderstandingPrompt(params),
      0.45,
      `Understanding-${params.language}`
    )
  );
}

async function generateChineseBackofficeUnderstanding(params: {
  apiKey: string;
  semanticFacts: SemanticFacts;
  tgUnderstanding: Record<AIUnderstandingField, string>;
  ruUnderstanding: Record<AIUnderstandingField, string>;
}) {
  const prompt = `你是一名电商后台运营辅助翻译编辑。下面给你一份结构化商品事实，以及已经定稿的塔吉克语和俄语用户文案。请你输出一份中文版本，目标是帮助后台运营快速理解商品，不追求最强营销感，但必须忠实、清晰、可审核。

【结构化商品事实】
${JSON.stringify(params.semanticFacts, null, 2)}

【塔吉克语用户文案】
${JSON.stringify(params.tgUnderstanding, null, 2)}

【俄语用户文案】
${JSON.stringify(params.ruUnderstanding, null, 2)}

请只输出以下 JSON：
{
  "target_people": "",
  "selling_angle": "",
  "how_to_use": "",
  "best_scene": "",
  "local_life_connection": "",
  "recommended_badge": ""
}

要求：
1. 中文用于后台辅助理解，重在准确、通顺、易审核。
2. how_to_use 需要保留“给小白看的使用理解”这个定位，可包含参数、场景和简单使用方法。
3. recommended_badge 保持短小精炼。
4. 只输出 JSON，不要附加说明。`;

  return normalizeSingleLanguageUnderstanding(
    await callQwenJson(params.apiKey, "_", prompt, 0.2, "Understanding-zh")
  );
}

async function enrichAnalysisWithLocalizedUnderstanding(params: {
  apiKey: string;
  analysis: any;
  productName: string;
  price: number;
}) {
  const semanticFacts = normalizeSemanticFacts(params.analysis?.semantic_facts);
  const tgUnderstanding = await generateDirectUnderstandingByLanguage({
    apiKey: params.apiKey,
    language: "tg",
    semanticFacts,
    productName: params.productName,
    price: params.price,
  });
  const ruUnderstanding = await generateDirectUnderstandingByLanguage({
    apiKey: params.apiKey,
    language: "ru",
    semanticFacts,
    productName: params.productName,
    price: params.price,
  });
  const zhUnderstanding = await generateChineseBackofficeUnderstanding({
    apiKey: params.apiKey,
    semanticFacts,
    tgUnderstanding,
    ruUnderstanding,
  });

  return {
    ...params.analysis,
    semantic_facts: semanticFacts,
    ai_understanding: buildLocalizedAIUnderstanding({
      semanticFacts,
      tg: tgUnderstanding,
      ru: ruUnderstanding,
      zh: zhUnderstanding,
    }),
  };
}

function normalizeLegacyAIUnderstanding(payload: any) {
  const semanticFacts = normalizeSemanticFacts(payload?.semantic_facts || {});
  const localized = {} as Record<string, { tg: string; ru: string; zh: string }>;

  for (const field of AI_UNDERSTANDING_FIELDS) {
    const raw = payload?.[field];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      localized[field] = {
        tg: cleanAIText(raw.tg),
        ru: cleanAIText(raw.ru),
        zh: cleanAIText(raw.zh),
      };
    } else {
      const fallback = cleanAIText(raw);
      localized[field] = { tg: fallback, ru: fallback, zh: fallback };
    }
  }

  return {
    ...localized,
    semantic_facts: semanticFacts,
    generated_at: payload?.generated_at || new Date().toISOString(),
    generated_by: payload?.generated_by || "ai-listing-generate",
    model_used: payload?.model_used || "legacy-normalized",
    generation_mode: payload?.generation_mode || "legacy_normalized",
    primary_market_language: payload?.primary_market_language || "tg",
    display_priority: Array.isArray(payload?.display_priority) ? payload.display_priority : ["tg", "ru", "zh"],
    source_language: payload?.source_language || "multi",
  };
}

async function ensureLocalizedAIUnderstanding(params: {
  apiKey: string;
  analysis: any;
  productName: string;
  price: number;
}) {
  if (params.analysis?.semantic_facts) {
    return await enrichAnalysisWithLocalizedUnderstanding(params);
  }

  if (params.analysis?.ai_understanding) {
    return {
      ...params.analysis,
      ai_understanding: normalizeLegacyAIUnderstanding(params.analysis.ai_understanding),
    };
  }

  return params.analysis;
}

// ============================================================
// Step A: 图片理解 (使用 VISION_MODELS 降级链)
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
    text: `你是一名电商商品分析专家，服务于塔吉克斯坦电商平台。请分析以下商品图片，结合基础信息，输出“可复用的商品分析结果 + 语言无关的语义事实层”，供后续分别生成塔吉克语与俄语用户文案。

请用 JSON 输出：
{
  "product_type": "商品类型，如：男士夹克",
  "main_color": "主色调",
  "material_guess": "材质推测（如无法判断填null）",
  "key_features": ["特征1", "特征2", "特征3"],
  "use_scenes": ["使用场暯1", "使用场暯2"],
  "selling_points": [
    {"zh": "中文卖点1", "detail": "补充细节"},
    {"zh": "中文卖点2", "detail": "补充细节"},
    {"zh": "中文卖点3", "detail": "补充细节"}
  ],
  "target_audience": "目标人群描述",
  "semantic_facts": {
    "product_type": "一句话明确商品类型",
    "core_function": "一句话说明最核心用途",
    "target_user_traits": ["适合的人群特征1", "特征2"],
    "primary_pain_points": ["解决的问题1", "问题2"],
    "usage_steps": ["使用步骤或动作1", "步骤2"],
    "usage_tips": ["使用提醒或技巧1", "技巧2"],
    "usage_scenarios": ["典型场暯1", "典型场暯2"],
    "parameter_highlights": ["用户需要知道的参数亮点1", "亮点2"],
    "local_context_signals": ["与塔吉克本地生活的真实连接点1", "连接点2"],
    "trust_signals": ["提升信任感的事实1", "事实2"],
    "badge_candidates": ["候选角标1", "候选角标2", "候选角标3"]
  }
}

商品基础信息：
- 品类：${category}
- 名称：${productName}
- 规格：${specs || "未提供"}
- 补充备注：${notes || "无"}

要求：
1. 这是中间事实层，不要在此阶段输出塔语、俄语或中文的最终用户文案。
2. semantic_facts 中的 usage_steps、usage_tips、parameter_highlights 必须尽量具体，帮助小白理解怎么用。
3. local_context_signals 必须贴近塔吉克真实生活，不要空泛。
4. 请只输出 JSON，不要添加任何其他文字说明。`,
  });

  // 使用 VISION_MODELS 降级链调用
  const { content: rawContent } = await callDashScopeWithFallback(
    apiKey,
    VISION_MODELS,
    [{ role: "user", content }],
    0.3,
    "StepA"
  );

  return parseAIJson(rawContent);
}

// ============================================================
// Step B: 三语文案生成 (使用 TEXT_MODELS 降级链)
// ============================================================

async function callQwenPlus(
  apiKey: string,
  analysisJson: any,
  price: number
): Promise<any> {
  const prompt = `你是一名面向塔吉克斯坦市场的资深电商文案策划师，精通塔吉克语、俄语和中文，熟悉本地消费者的生活场景、价格敏感度、家庭导向和信任决策逻辑。

【语言优先级】
1. 塔吉克语是主要用户语言，必须写得自然、顺口、像本地人在认真推荐商品，不能有生硬翻译腔。
2. 俄语是并行核心语言，质量也必须高，适合塔吉克斯坦用户阅读，但不要比塔吉克语更“主导”。
3. 中文只用于后台运营辅助理解，准确清楚即可，不追求营销感。

【塔吉克消费文化指南】
1. 普遍重视实用性、耐用性和价格是否值。
2. 用户对“怎么买来就能用、适合谁、在什么场景最方便”非常敏感。
3. 家庭导向明显，很多购买决策会考虑家人共同使用、送礼、居家便利或日常出行。
4. 用户更信任具体而真实的表达，例如尺寸、续航、材质、穿着/使用感受、适用天气或使用场景，而不是空泛夸张的宣传语。
5. 避免宗教、政治、夸大疗效、绝对化承诺等敏感或高风险表达。

请根据商品分析生成上架文案。三种语言都要基于同一商品事实，但必须分别写出符合该语言用户阅读习惯的自然表达，不能互相直译。

以JSON格式输出：
{
  "title_ru": "商品俄语标题（25-40字，清晰、可信、带核心关键词）",
  "title_zh": "商品中文标题（15-25字，后台辅助理解即可）",
  "title_tg": "商品塔吉克语标题（25-40字，自然、接地气、便于普通用户快速看懂）",
  "bullets_ru": [
    "俄语卖点1（15-28字，突出真实好处或实用价值）",
    "俄语卖点2（15-28字，结合场景、耐用性或家庭使用）",
    "俄语卖点3（15-28字，强调体验、品质或便利性）"
  ],
  "bullets_zh": ["中文卖点1", "中文卖点2", "中文卖点3"],
  "bullets_tg": [
    "塔吉克语卖点1（15-28字，强调为什么对普通人好用）",
    "塔吉克语卖点2（15-28字，带生活场景或使用便利）",
    "塔吉克语卖点3（15-28字，带参数亮点、舒适感或信任点）"
  ],
  "description_ru": "俄语商品详情描述（150-250字，真实、具体、适合塔吉克斯坦用户阅读）",
  "description_zh": "中文商品详情描述（80-150字，后台理解用，忠实准确）",
  "description_tg": "塔吉克语商品详情描述（120-220字，重点讲清楚适合谁、为什么好用、怎么用或在哪些场景更方便）"
}

说明：
- 塔吉克语文案质量必须最高，优先保证其自然度、理解门槛低和贴近本地生活。
- 俄语文案同样要高质量，但语气应服务于本地电商用户，而不是俄区大站模板腔。
- 中文仅作为后台辅助，不要为了中文牺牲塔吉克语表达质量。
- 标题不要堆砌关键词；卖点要讲人话；描述要帮助用户快速完成“这是不是适合我”的判断。
- 如果商品是新手也能买的类型，请主动降低理解门槛，让文案更容易懂。

请只输出JSON，不要添加任何其他文字说明。

商品分析：${JSON.stringify(analysisJson)}
售价：${price} сомони`;

  // 使用 TEXT_MODELS 降级链调用
  const { content: rawContent } = await callDashScopeWithFallback(
    apiKey,
    TEXT_MODELS,
    [{ role: "user", content: prompt }],
    0.5,
    "StepB"
  );

  return parseAIJson(rawContent);
}

// ============================================================
// Step C: 商品分割 — 阿里云 VIAPI 签名算法
// ============================================================

/**
 * 阿里云 VIAPI HMAC-SHA1 签名
 * 构造签名 URL 用于调用视觉智能平台 API
 * @param endpoint API 域名，默认 imageseg.cn-shanghai.aliyuncs.com
 * @param version API 版本，默认 2019-12-30
 */
async function signViapiRequest(
  accessKeyId: string,
  accessKeySecret: string,
  params: Record<string, string>,
  endpoint: string = "imageseg.cn-shanghai.aliyuncs.com",
  version: string = "2019-12-30"
): Promise<string> {
  // 1. 添加公共参数
  const allParams: Record<string, string> = {
    ...params,
    Format: "JSON",
    Version: version,
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
  return `https://${endpoint}/?${canonicalized}&Signature=${encodeURIComponent(
    signatureBase64
  )}`;
}

/**
 * 调用 GetOssStsToken 获取阿里云视觉智能平台临时 OSS 凭证
 * 注意：GetOssStsToken 在 viapiutils 域名下，Version 为 2020-04-01
 */
async function getViapiOssStsToken(
  accessKeyId: string,
  accessKeySecret: string
): Promise<{ ak: string; sk: string; token: string }> {
  const url = await signViapiRequest(
    accessKeyId,
    accessKeySecret,
    { Action: "GetOssStsToken" },
    "viapiutils.cn-shanghai.aliyuncs.com",
    "2020-04-01"
  );

  const controller1 = new AbortController();
  const timeout1 = setTimeout(() => controller1.abort(), 30000);
  try {
    const response = await fetch(url, { method: "POST", signal: controller1.signal });
    clearTimeout(timeout1);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GetOssStsToken 失败 (HTTP ${response.status}): ${errText}`);
    }

  const result = await response.json();
  if (result.Code && result.Code !== "0") {
    throw new Error(`GetOssStsToken 业务错误: ${result.Code} - ${result.Message}`);
  }

  const data = result.Data;
  if (!data) {
    throw new Error("GetOssStsToken 返回数据为空");
  }

  console.log("[GetOssStsToken] 响应 Data:", JSON.stringify(data));

  return {
    ak: data.AccessKeyId,
    sk: data.AccessKeySecret,
    token: data.SecurityToken,
  };
  } catch (e) {
    clearTimeout(timeout1);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('GetOssStsToken 请求超时 (30s)');
    }
    throw e;
  }
}

/**
 * 使用 OSS STS 凭证通过 HTTP PUT 上传文件到阿里云临时 OSS (viapi-customer-temp)
 * 参考 @alicloud/viapi-utils 官方实现
 * @returns 上传后的 OSS URL
 */
async function uploadToViapiOss(
  imageBuffer: ArrayBuffer,
  contentType: string,
  stsInfo: { ak: string; sk: string; token: string },
  accessKeyId: string
): Promise<string> {
  // 固定使用 viapi-customer-temp bucket（与官方 SDK 一致）
  const bucketName = "viapi-customer-temp";
  const ossEndpoint = "oss-cn-shanghai.aliyuncs.com";

  // 生成唯一的文件路径，格式: accessKeyId/nonce+filename
  const ext = contentType.includes("png") ? "png" : "jpg";
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const objectKey = `${accessKeyId}/${nonce}segment_input.${ext}`;

  // 构造 OSS PUT 请求的签名
  const date = new Date().toUTCString();
  const canonicalResource = `/${bucketName}/${objectKey}`;
  const stringToSign = `PUT\n\n${contentType}\n${date}\nx-oss-security-token:${stsInfo.token}\n${canonicalResource}`;

  // HMAC-SHA1 签名
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stsInfo.sk),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(stringToSign)
  );
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  // 标准 OSS URL 格式
  const uploadUrl = `https://${bucketName}.${ossEndpoint}/${objectKey}`;
  console.log(`[uploadToViapiOss] 上传到: ${uploadUrl}`);

  const putController = new AbortController();
  const putTimeout = setTimeout(() => putController.abort(), 60000);
  try {
    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Date": date,
        "Authorization": `OSS ${stsInfo.ak}:${signatureBase64}`,
        "x-oss-security-token": stsInfo.token,
      },
      body: imageBuffer,
      signal: putController.signal,
    });
    clearTimeout(putTimeout);

    if (!putResponse.ok) {
      const errText = await putResponse.text();
      throw new Error(`OSS 上传失败 (HTTP ${putResponse.status}): ${errText}`);
    }
  } catch (e) {
    clearTimeout(putTimeout);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('OSS 上传超时 (60s)');
    }
    throw e;
  }

  // 返回 HTTP URL（与官方 SDK 一致，使用 http 而非 https）
  return `http://${bucketName}.${ossEndpoint}/${objectKey}`;
}

/**
 * 调用阿里云 SegmentCommodity API 进行商品分割
 * 对于非上海 OSS 的图片，先下载并上传到阿里云临时 OSS，再调用 API
 * @param imageUrl 商品图片 URL
 * @returns RGBA 透明背景 PNG 的临时 URL
 */
async function callSegmentCommodity(
  accessKeyId: string,
  accessKeySecret: string,
  imageUrl: string
): Promise<string> {
  // 判断图片是否已在上海 OSS
  const isOssShanghai = imageUrl.includes(".oss-cn-shanghai.aliyuncs.com");
  let finalImageUrl = imageUrl;

  if (!isOssShanghai) {
    // 非上海 OSS 图片，需要中转上传
    console.log("[Step C] 图片非上海 OSS，启用中转上传...");

    // 1. 下载图片到内存
    console.log("[Step C] 下载图片到内存...");
    const dlController = new AbortController();
    const dlTimeout = setTimeout(() => dlController.abort(), 30000);
    const imgResponse = await fetch(imageUrl, { signal: dlController.signal });
    clearTimeout(dlTimeout);
    if (!imgResponse.ok) {
      throw new Error(`下载图片失败 (HTTP ${imgResponse.status}): ${imageUrl}`);
    }
    const imageBuffer = await imgResponse.arrayBuffer();
    const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
    console.log(`[Step C] 图片下载完成: ${imageBuffer.byteLength} bytes, type: ${contentType}`);

    // 2. 获取临时 OSS STS Token
    console.log("[Step C] 获取 VIAPI 临时 OSS 凭证...");
    const stsInfo = await getViapiOssStsToken(accessKeyId, accessKeySecret);
    console.log("[Step C] STS Token 获取成功");

    // 3. 上传到临时 OSS
    console.log("[Step C] 上传图片到临时 OSS...");
    finalImageUrl = await uploadToViapiOss(imageBuffer, contentType, stsInfo, accessKeyId);
    console.log(`[Step C] 临时 OSS URL: ${finalImageUrl}`);
  }

  // 调用 SegmentCommodity
  console.log(`[Step C] 调用 SegmentCommodity, URL: ${finalImageUrl.slice(0, 80)}...`);
  const url = await signViapiRequest(accessKeyId, accessKeySecret, {
    Action: "SegmentCommodity",
    ImageURL: finalImageUrl,
  });

  const segController = new AbortController();
  const segTimeout = setTimeout(() => segController.abort(), 60000);
  let result;
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: segController.signal,
    });
    clearTimeout(segTimeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `SegmentCommodity 调用失败 (HTTP ${response.status}): ${errText}`
      );
    }

    result = await response.json();
    console.log("[Step C] SegmentCommodity 响应:", JSON.stringify(result).slice(0, 300));
  } catch (e) {
    clearTimeout(segTimeout);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('SegmentCommodity 调用超时 (60s)');
    }
    throw e;
  }

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
// Step D: 营销海报规划 (使用 TEXT_MODELS 降级链)
//   - 为每个商品生成 5-8 组 { 场景 prompt(英文), 俄文营销文案, 主题(浅/深字), 排版(top/center/bottom) }
//   - 英文 prompt 用于万相背景生成；俄文文案由 processor 通过 Satori 精准合成到图片上
// ============================================================

export type MarketingPosterPlan = {
  ref_prompt: string;       // 英文场景 prompt
  ru_caption: string;       // 俄文营销文案 (一句话, 2-7 词, 最多 ~40 字符, 无乱码)
  text_theme: "light" | "dark";  // light=白字配深色遮罩; dark=黑字配浅色遮罩
  caption_position: "top" | "center" | "bottom"; // 文案在画面中的位置
};

/**
 * 过滤、规范化并强校验营销海报计划。
 * - 丢弃空文案/超长文案
 * - 只保留允许的枚举值
 * - 限制输出数量 5-8 条
 * - 过滤掉包含西里尔外可疑字符的 caption (防乱码)
 */
function sanitizeMarketingPlans(arr: any): MarketingPosterPlan[] {
  if (!Array.isArray(arr)) {return [];}
  const THEMES = new Set(["light", "dark"]);
  const POSITIONS = new Set(["top", "center", "bottom"]);
  const out: MarketingPosterPlan[] = [];
  const seen = new Set<string>();

  // 合法 Cyrillic + 常见标点 + 空格 + 可选少量拉丁/数字 (例如: 5 кг, iPhone)
  // 禁止 CJK / emoji / 其他脚本以避免乱码
  const SAFE_RE = /^[A-Za-zА-Яа-яЁё0-9\s\-!?.,:;«»"'()%№+×\u2010-\u2027\u20A0-\u20CF]+$/u;

  for (const raw of arr) {
    if (!raw || typeof raw !== "object") {continue;}
    const ref_prompt = cleanAIText(raw.ref_prompt);
    const ru_caption = cleanAIText(raw.ru_caption);
    const text_theme = cleanAIText(raw.text_theme).toLowerCase();
    const caption_position = cleanAIText(raw.caption_position).toLowerCase();

    if (!ref_prompt || !ru_caption) {continue;}
    if (ru_caption.length > 80) {continue;}
    if (!SAFE_RE.test(ru_caption)) {continue;}
    if (!THEMES.has(text_theme)) {continue;}
    if (!POSITIONS.has(caption_position)) {continue;}

    const key = ru_caption.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {continue;}
    seen.add(key);

    out.push({
      ref_prompt,
      ru_caption,
      text_theme: text_theme as "light" | "dark",
      caption_position: caption_position as "top" | "center" | "bottom",
    });
    if (out.length >= 8) {break;}
  }
  return out;
}

async function callQwenMarketingPlanner(
  apiKey: string,
  analysisJson: any,
  copywriting: any,
  productName: string,
  price: number
): Promise<MarketingPosterPlan[]> {
  const prompt = `You are a senior e-commerce creative director for Tajikistan cross-border shop. For ONE product, plan exactly 6 high-quality marketing posters (product photos with overlay copy in Russian).

Your plan must be returned as strict JSON, each item containing:
  - "ref_prompt": an English scene prompt (max 40 words) that will be sent to a background-generation model to create a BEAUTIFUL photorealistic lifestyle/studio scene for this product. Focus on camera, lighting, surface, color palette, mood, resolution. NEVER mention any text, letters, logo, watermark, labels, captions, words, or typography — the image must be completely text-free. Backgrounds must be beautiful, premium, varied (studio hero shot, cozy home lifestyle, natural outdoor, luxurious marble, seasonal festive, minimalist pastel, etc.) and NOT ugly/generic.
  - "ru_caption": ONE short Russian marketing headline (2 to 7 words, <= 40 characters). It must be perfectly spelled Russian (Cyrillic only, NO Chinese/English/emoji, NO transliteration), grammatically correct, natural for Tajik/Russian-speaking shoppers, and describe a single selling point, feature, or product story (e.g. \"Тёплая куртка на зиму\", \"Мягкая и лёгкая ткань\", \"Подарок для всей семьи\", \"Цена всего 199 сомони\"). Do NOT use brand names you are not sure about. Do NOT promise medical effects. Prefer concrete benefits.
  - "text_theme": "light" if the caption should be WHITE text on a dark gradient overlay (use when the planned background is light/bright/pastel so white text needs a dark scrim), or "dark" if the caption should be BLACK text on a light gradient overlay (use when background is dark/moody). Choose consistently with your ref_prompt background.
  - "caption_position": "top" | "center" | "bottom" — where the caption is placed so it does NOT cover the product itself.

Rules:
1. Return exactly 6 items, each covering a DIFFERENT selling angle (function, target audience, scenario, material/quality, price/value, emotional/gift).
2. All 6 ref_prompts must clearly describe DIFFERENT beautiful scenes; never repeat the same background.
3. ru_caption must be 100% Cyrillic Russian, with correct spelling. If you are not sure of a spelling, choose a simpler word.
4. Output ONLY valid JSON, no prose, no markdown, no trailing comma.

Product analysis: ${JSON.stringify(analysisJson).slice(0, 4000)}
Russian title (for reference, do not copy verbatim): ${copywriting?.title_ru || ""}
Russian selling bullets (for reference): ${JSON.stringify(copywriting?.bullets_ru || [])}
Product name: ${productName}
Price: ${price} сомони

JSON schema to output:
{
  "posters": [
    { "ref_prompt": "...", "ru_caption": "...", "text_theme": "light|dark", "caption_position": "top|center|bottom" }
  ]
}`;

  // 使用 TEXT_MODELS 降级链调用
  const { content: rawContent } = await callDashScopeWithFallback(
    apiKey,
    TEXT_MODELS,
    [{ role: "user", content: prompt }],
    0.6,
    "StepD"
  );

  const parsed = parseAIJson(rawContent);
  const plans = sanitizeMarketingPlans(parsed?.posters || parsed);
  if (plans.length < 5) {
    throw new Error(
      `营销海报规划产出不足 5 条 (实际: ${plans.length})，请求会被重试`
    );
  }
  return plans;
}

// ============================================================
// Step E (legacy submit/poll 保留给其他调用者或回滚；新链路改由 ai-listing-image-processor 处理)
// ============================================================

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
        const errText = await response.text();
        consecutiveErrors++;
        console.warn(
          `[轮询] 任务 ${taskId} 查询失败 (${consecutiveErrors}/${maxConsecutiveErrors}): HTTP ${response.status}`
        );
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `万相任务查询连续失败 ${maxConsecutiveErrors} 次 (HTTP ${response.status}): ${errText}`
          );
        }
        continue;
      }

      // 查询成功，重置连续错误计数
      consecutiveErrors = 0;

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
    } catch (error) {
      // 区分业务错误（应立即抛出）和网络错误（可容忍）
      if (
        error instanceof Error &&
        (error.message.includes("万相任务失败") ||
         error.message.includes("未返回图片 URL") ||
         error.message.includes("连续失败"))
      ) {
        throw error;
      }
      // 网络层错误（fetch 异常），计入连续错误
      consecutiveErrors++;
      console.warn(
        `[轮询] 任务 ${taskId} 网络错误 (${consecutiveErrors}/${maxConsecutiveErrors}):`,
        error instanceof Error ? error.message : error
      );
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(
          `万相任务轮询网络连续失败 ${maxConsecutiveErrors} 次: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
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
    let reqBody: any;
    try {
      reqBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "请求体必须为有效的 JSON 格式" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const {
      image_urls,
      category,
      product_name,
      specs,
      price,
      notes,
    } = reqBody;

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

    // 校验每个元素是否为有效的 URL 字符串
    const invalidUrls = image_urls.filter(
      (u: any) => typeof u !== 'string' || !u.startsWith('http')
    );
    if (invalidUrls.length > 0) {
      return new Response(
        JSON.stringify({ error: `图片 URL 格式无效，必须为 http/https 开头的字符串` }),
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

    if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
      return new Response(
        JSON.stringify({ error: "售价必须为大于 0 的数字" }),
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

    // 兼容两种环境变量命名：优先 ALIBABA_CLOUD_*，回退 ALIYUN_*
    const aliAccessKeyId = Deno.env.get("ALIBABA_CLOUD_ACCESS_KEY_ID") || Deno.env.get("ALIYUN_ACCESS_KEY_ID");
    const aliAccessKeySecret = Deno.env.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET") || Deno.env.get("ALIYUN_ACCESS_KEY_SECRET");

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

        const normalizedAnalysis = await withRetry(() =>
          ensureLocalizedAIUnderstanding({
            apiKey: dashscopeApiKey,
            analysis,
            productName: product_name,
            price,
          })
        );

        const analysisPreview = JSON.stringify(normalizedAnalysis);

        console.log(
          "[Step A] 图片理解完成:",
          analysisPreview.length > 500
            ? analysisPreview.slice(0, 500) + "...(truncated)"
            : analysisPreview
        );

        const analysisResult = normalizedAnalysis;

        // ---- Step B: 三语文案生成 ----
        await sendSSE({
          status: "processing",
          progress: 30,
          stage: "正在生成三语文案...",
        });

        const copywriting = await withRetry(() =>
          callQwenPlus(dashscopeApiKey, analysisResult, price)
        );

        console.log("[Step B] 文案生成完成");

        // ---- Step C: 商品分割（通过抠图代理服务） ----
        let segmentedUrl: string | null = null;
        let segmentFailed = false;

        const segmentProxyUrl = Deno.env.get("SEGMENT_PROXY_URL") || "https://tezbarakat.com/api/segment";
        const segmentProxyKey = Deno.env.get("SEGMENT_PROXY_KEY") || "dodo-segment-2024";

        {
          await sendSSE({
            status: "processing",
            progress: 45,
            stage: "正在抠除商品背景...",
          });

          try {
            // 调用生产服务器上的抠图代理服务（内置图片压缩 + OSS 中转 + SegmentCommodity）
            const segController = new AbortController();
            const segTimeout = setTimeout(() => segController.abort(), 90000); // 90秒超时

            const segResp = await fetch(segmentProxyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                image_url: image_urls[0],
                api_key: segmentProxyKey,
              }),
              signal: segController.signal,
            });
            clearTimeout(segTimeout);

            const segResult = await segResp.json();

            if (!segResp.ok || segResult.error) {
              throw new Error(segResult.error || `抠图代理返回错误 (HTTP ${segResp.status})`);
            }

            segmentedUrl = segResult.segmented_url;
            console.log(`[Step C] 商品分割完成 (耗时 ${segResult.duration_ms}ms):`, segmentedUrl);
          } catch (error) {
            // 降级处理：分割失败不终止流程
            segmentFailed = true;
            const errMsg = error instanceof Error
              ? (error.name === 'AbortError' ? '抠图超时 (90s)' : error.message)
              : String(error);
            console.error("[Step C] 商品分割失败（降级处理）:", errMsg);
            await sendSSE({
              status: "processing",
              progress: 50,
              stage: "抠图失败，将使用原始图片继续...",
              error: errMsg,
            });
          }
        }

        // ---- Step D: 营销海报规划 (不直接生图, 只出经过校验的 plans) ----
        let plans: MarketingPosterPlan[] = [];
        let planFailed = false;
        if (segmentedUrl) {
          await sendSSE({
            status: "processing",
            progress: 55,
            stage: "正在规划俄文营销海报方案...",
          });
          try {
            plans = await withRetry(
              () => callQwenMarketingPlanner(
                dashscopeApiKey,
                analysisResult,
                copywriting,
                product_name,
                price
              ),
              3,
              1200
            );
            console.log(`[Step D] 海报规划完成: ${plans.length} 条`);
          } catch (error) {
            planFailed = true;
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error("[Step D] 海报规划失败（降级）:", errMsg);
            await sendSSE({
              status: "processing",
              progress: 60,
              stage: "海报规划失败，将仅返回文案结果...",
              error: errMsg,
            });
          }
        }

        // ---- Step E: 写入单图任务表 ai_image_tasks (由 ai-listing-image-processor 后台处理) ----
        let parentTaskId: string | null = null;
        let enqueuedCount = 0;
        if (segmentedUrl && plans.length > 0 && !planFailed) {
          await sendSSE({
            status: "processing",
            progress: 70,
            stage: `正在将 ${plans.length} 张营销海报加入后台队列...`,
          });
          parentTaskId = crypto.randomUUID();
          const rows = plans.map((p, idx) => ({
            parent_task_id: parentTaskId!,
            admin_user_id: String(adminId),
            base_image_url: segmentedUrl!,
            ref_prompt: p.ref_prompt,
            ru_caption: p.ru_caption,
            text_theme: p.text_theme,
            caption_position: p.caption_position,
            display_order: idx,
            status: "pending",
          }));
          const { error: insErr } = await supabase
            .from("ai_image_tasks")
            .insert(rows);
          if (insErr) {
            console.error("[Step E] 任务入队失败:", insErr.message);
            // 入队失败也降级：返回文案 + 抠图，不阻断用户
            planFailed = true;
          } else {
            enqueuedCount = rows.length;
            console.log(
              `[Step E] 已写入 ${enqueuedCount} 条单图任务，parent_task_id=${parentTaskId}`
            );
          }
        }

        // ---- 汇总结果 ----
        const duration = Date.now() - startTime;
        const hasCopywriting =
          copywriting.title_ru && copywriting.description_ru;

        if (!hasCopywriting) {
          // 文案缺失（不应该发生，因为 Step B 失败会抛异常）
          await sendSSE({
            status: "error",
            progress: 100,
            error: "文案生成结果不完整",
          });
        } else if (segmentFailed) {
          // 分割失败 → 仅文案
          await sendSSE({
            status: "partial",
            progress: 100,
            result: {
              ...copywriting,
              background_images: [],
              marketing_images: [],
              parent_task_id: null,
              enqueued_images: 0,
              original_images: image_urls,
              material_guess: analysisResult.material_guess || null,
              analysis: analysisResult,
            },
            message: "抠图失败，可使用原始图片上架",
            duration_ms: duration,
          });
        } else if (planFailed || !parentTaskId) {
          // 规划/入队失败 → 返回文案 + 抠图原图
          await sendSSE({
            status: "partial",
            progress: 100,
            result: {
              ...copywriting,
              background_images: segmentedUrl ? [segmentedUrl] : [],
              marketing_images: [],
              parent_task_id: null,
              enqueued_images: 0,
              segmented_image: segmentedUrl,
              original_images: image_urls,
              material_guess: analysisResult.material_guess || null,
              analysis: analysisResult,
            },
            message: "海报规划或入队失败，仅返回文案和抠图原图",
            duration_ms: duration,
          });
        } else {
          // 正常分叉：SSE 立即返回，后台任务由 pg_cron/processor 逐张完成
          await sendSSE({
            status: "processing_images",
            progress: 100,
            stage: `文案已完成，${enqueuedCount} 张营销海报已加入后台队列，请等待实时推送…`,
            result: {
              ...copywriting,
              // 兼容字段：先给出抠图原图，然后 Realtime 会将生成完成的海报陆续推入
              background_images: [],
              marketing_images: [],
              parent_task_id: parentTaskId,
              enqueued_images: enqueuedCount,
              segmented_image: segmentedUrl,
              original_images: image_urls,
              material_guess: analysisResult.material_guess || null,
              analysis: analysisResult,
            },
            duration_ms: duration,
          });
        }

        console.log(
          `[AI Listing] 主函数完成，耗时 ${duration}ms，规划海报 ${plans.length} 条，入队 ${enqueuedCount} 条`
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
