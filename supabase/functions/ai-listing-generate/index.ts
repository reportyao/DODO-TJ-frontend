/**
 * AI 商品上架助手 — Edge Function
 *
 * 核心后端逻辑，串联 4 个外部 API 调用，通过 SSE 流式返回进度和结果。
 *
 * 执行链路 (v3.1 — 性能极致优化版)：
 *   Step A: 图片理解 (首图, VISION_MODELS 降级链, enable_thinking=false)
 *   Step A2: 三语本地化理解 (合并为一次 API 调用, TEXT_MODELS 降级链)
 *   Step B+C+D 并行：
 *     B: 三语文案生成 (TEXT_MODELS 降级链, enable_thinking=false)
 *     C: 商品分割 (SegmentCommodity) → 去除背景，输出 RGBA PNG
 *     D: 营销海报规划 (TEXT_MODELS 降级链, enable_thinking=false)
 *   Step E: 写入单图任务表 ai_image_tasks → 由 ai-listing-image-processor (cron) 后台生成
 *
 * v3.1 优化 (基于 ai-understanding-generate 已验证方案)：
 *   - 所有 DashScope 调用添加 enable_thinking: false（提速 50%+）
 *   - 只用首图（多图收益边际递减，但耗时线性增长）
 *   - 三语理解合并为一次 API 调用（从 3 次降为 1 次）
 *   - parseAIJson 增加 <think> 标签防御和 JSON 提取容错
 *   - 所有步骤添加 max_tokens 限制
 *   - 确保在 Supabase 150s 硬性限制内完成
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
  stepName: string,
  options?: { enableThinking?: boolean; maxTokens?: number }
): Promise<{ content: string; modelUsed: string }> {
  let lastError: Error | null = null;
  const requestTimeoutMs = 50000; // 50s per model attempt
  const enableThinking = options?.enableThinking ?? false; // v3.1: 默认关闭 thinking，提速 50%+
  const maxTokens = options?.maxTokens;

  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

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
          body: JSON.stringify({
            model,
            messages,
            temperature,
            enable_thinking: enableThinking, // v3.1: 关闭推理过程，大幅缩短响应时间
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

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
      clearTimeout(timeoutId);
      const errMsg = error instanceof Error
        ? (error.name === "AbortError"
            ? `${stepName} 调用超时 (${requestTimeoutMs / 1000}s)`
            : error.message)
        : String(error);

      if (isQuotaOrModelError(errMsg)) {
        lastError = error instanceof Error ? error : new Error(errMsg);
        console.log(`[${stepName}] 模型 ${model} 不可用，尝试降级...`);
        continue;
      }
      throw new Error(errMsg); // 非降级错误，直接抛出
    }
  }

  // 所有模型都失败了
  throw lastError || new Error(`[${stepName}] 所有模型均不可用: ${models.join(", ")}`);
}

/** 构建 model_used 元数据字符串，反映实际使用的模型链 */
function buildModelUsedTrace(): string {
  // v3.1: 更新步骤名称反映三语合并调用
  const steps = ["StepA", "Understanding-3lang", "StepB", "StepD"];
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
 * @param maxRetries 最大重试次数（默认 2，v3.0 从 3 降为 2）
 * @param baseDelay 基础延迟毫秒数（默认 800，v3.0 从 1000 降为 800）
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  baseDelay: number = 800
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
  // v3.1: 防御性处理 thinking 模式可能残留的 <think>...</think>
  const thinkEnd = cleaned.indexOf("</think>");
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }
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
  // v3.1: 兼容模型偶尔在 JSON 之前/之后追加散文
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
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
4. recommended_badge 必须是2-4个词的短角标，只描述商品功能/特性/人群，绝对禁止出现任何数字、价格、货币单位（сомони、TJS等）。正确示例："Барои кӯдакон"、"Тӯҳфаи беҳтарин"。错误示例（绝对不要）："Хит за 5 сомони"、"5 сомони специально"。${languageRules}
7. 只输出 JSON，不要附加任何说明。
8. 【严格禁止】所有字段的文案内容中，绝对不得出现具体价格数字（如"199 сомони"、"TJS 50"、"5 сомони"等），也不得出现任何货币单位（сомони、TJS、元、$等），也不得出现"за X сомони"、"всего X"等价格表达句式。允许使用"价格实惠"、"性价比高"等模糊价值表述，但禁止任何具体金额数字。`;
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

  // v3.1: 三语合并为一次 API 调用，节省 ~30-60s
  const mergedPrompt = `你是一名服务于塔吉克斯坦电商平台的本地化商品文案专家。现在请基于结构化商品事实，同时生成塔吉克语、俄语和中文三种语言的商品理解文案。

商品名称：${params.productName}
结构化商品事实：${JSON.stringify(semanticFacts)}

请只输出以下 JSON：
{
  "tg": {
    "target_people": "塔吉克语 - 最适合的人群描述，要写出生活状态和使用动机",
    "selling_angle": "塔吉克语 - 像熟人推荐一样解释为什么这个东西对他好用",
    "how_to_use": "塔吉克语 - 给小白看的使用理解",
    "best_scene": "塔吉克语 - 一个最具体、最自然的使用画面",
    "local_life_connection": "塔吉克语 - 与塔吉克本地生活的真实连接点",
    "recommended_badge": "塔吉克语 - 2-4个词的短角标"
  },
  "ru": {
    "target_people": "俄语 - 同上",
    "selling_angle": "俄语 - 同上",
    "how_to_use": "俄语 - 同上",
    "best_scene": "俄语 - 同上",
    "local_life_connection": "俄语 - 同上",
    "recommended_badge": "俄语 - 同上"
  },
  "zh": {
    "target_people": "中文 - 同上（后台辅助理解）",
    "selling_angle": "中文 - 同上",
    "how_to_use": "中文 - 同上",
    "best_scene": "中文 - 同上",
    "local_life_connection": "中文 - 同上",
    "recommended_badge": "中文 - 同上"
  }
}

要求：
1. 塔吉克语必须自然、地道，像本地熟人推荐商品。
2. 俄语必须可信、适合塔吉克斯坦用户阅读。
3. 中文用于后台辅助理解，准确清楚即可。
4. 三种语言基于同一事实，但必须分别写出符合该语言用户阅读习惯的自然表达，不能互相直译。
5. how_to_use 不能空泛，至少包含一种使用步骤、参数亮点或场景细节。
6. best_scene 必须是具体画面，不要抽象概括。
7. 只输出 JSON，不要附加任何说明。
8. 【严格禁止】所有字段的文案内容中，绝对不得出现具体价格数字（如"199 сомони"、"TJS 50"、"5 сомони"等），也不得出现任何货币单位（сомони、TJS、元、$等），也不得出现"за X сомони"、"всего X"等价格表达句式。allowed_badge必须只描述功能/特性/人群，绝对禁止出现数字或货币。允许使用"价格实惠"、"性价比高"等模糊价值表述，但禁止任何具体金额数字。`;

  const { content: rawContent } = await callDashScopeWithFallback(
    params.apiKey,
    TEXT_MODELS,
    [{ role: "user", content: mergedPrompt }],
    0.4,
    "Understanding-3lang",
    { enableThinking: false, maxTokens: 3000 }
  );

  const parsed = parseAIJson(rawContent);

  // 从合并结果中提取三种语言
  const tgUnderstanding = normalizeSingleLanguageUnderstanding(parsed?.tg || {});
  const ruUnderstanding = normalizeSingleLanguageUnderstanding(parsed?.ru || {});
  const zhUnderstanding = normalizeSingleLanguageUnderstanding(parsed?.zh || {});

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
  // v3.1: 只用首图（多图收益边际递减，但耗时与 token 几乎线性增长，容易超时）
  const images = imageUrls.slice(0, 1);

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

  // 使用 VISION_MODELS 降级链调用，v3.1: 关闭 thinking + 限制 max_tokens
  const { content: rawContent } = await callDashScopeWithFallback(
    apiKey,
    VISION_MODELS,
    [{ role: "user", content }],
    0.3,
    "StepA",
    { enableThinking: false, maxTokens: 2000 }
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
  "title_ru": "商品俄语标题（15-25字，简洁精炼，保留核心卖点和商品类型，不堆砌信息）",
  "title_zh": "商品中文标题（10-20字，后台辅助理解即可）",
  "title_tg": "商品塔吉克语标题（15-25字，简洁自然，保留核心内容，便于普通用户快速看懂）",
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
- 标题必须简短精炼，俄语和塔吉克语标题控制在15-25字以内，只保留核心商品类型+最大卖点，不要堆砌多个关键词或参数。
- 卖点要讲人话；描述要帮助用户快速完成“这是不是适合我”的判断。
- 如果商品是新手也能买的类型，请主动降低理解门槛，让文案更容易懂。

请只输出JSON，不要添加任何其他文字说明。

【严格禁止】所有文案字段中，绝对不得出现具体价格数字（如"199 сомони"、"TJS 50"等），也不得出现任何货币单位（сомони、TJS、元、$等）。允许使用"价格实惠"、"性价比高"等模糊价值表述，但禁止任何具体金额数字。
商品分析：${JSON.stringify(analysisJson)}`;

  // 使用 TEXT_MODELS 降级链调用，v3.1: 关闭 thinking + 限制 max_tokens
  const { content: rawContent } = await callDashScopeWithFallback(
    apiKey,
    TEXT_MODELS,
    [{ role: "user", content: prompt }],
    0.5,
    "StepB",
    { enableThinking: false, maxTokens: 4000 }
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
    if (out.length >= 3) {break;}
  }
  return out;
}

async function callQwenMarketingPlanner(
  apiKey: string,
  analysisJson: any,
  copywriting: any | null, // v3.0: copywriting is optional since we run in parallel
  productName: string,
  price: number
): Promise<MarketingPosterPlan[]> {
  // v5.0: 海报数量统一固定为 3 张（按运营要求, 2026-04-24）
  const posterCount = 3;
  console.log(`[Step D] 规划海报数量=${posterCount}（固定）`);
  const prompt = `You are a senior e-commerce creative director for Tajikistan cross-border shop. For ONE product, plan exactly ${posterCount} high-quality marketing posters (product photos with overlay copy in Russian).

Your plan must be returned as strict JSON, each item containing:
  - "ref_prompt": an English scene prompt (max 40 words) that will be sent to a background-generation model to create a BEAUTIFUL photorealistic lifestyle/studio scene for this product. Focus on camera, lighting, surface, color palette, mood, resolution. NEVER mention any text, letters, logo, watermark, labels, captions, words, or typography — the image must be completely text-free. Backgrounds must be beautiful, premium, varied (studio hero shot, cozy home lifestyle, natural outdoor, luxurious marble, seasonal festive, minimalist pastel, etc.) and NOT ugly/generic.
  - "ru_caption": ONE short Russian marketing headline (2 to 7 words, <= 40 characters). It must be perfectly spelled Russian (Cyrillic only, NO Chinese/English/emoji, NO transliteration), grammatically correct, natural for Tajik/Russian-speaking shoppers, and describe a single selling point, feature, or product story (e.g. "Тёплая куртка на зиму", "Мягкая и лёгкая ткань", "Подарок для всей семьи", "Удобно для всей семьи"). Do NOT use brand names you are not sure about. Do NOT promise medical effects. Do NOT include any specific price numbers or currency units (сомони, TJS, etc.). Prefer concrete benefits.
  - "text_theme": "light" if the caption should be WHITE text on a dark gradient overlay (use when the planned background is light/bright/pastel so white text needs a dark scrim), or "dark" if the caption should be BLACK text on a light gradient overlay (use when background is dark/moody). Choose consistently with your ref_prompt background.
  - "caption_position": "top" | "center" | "bottom" — where the caption is placed so it does NOT cover the product itself.

Rules:
1. Return exactly ${posterCount} items, each covering a DIFFERENT selling angle. Pick the ${posterCount} most impactful angles from: function, target audience, scenario, material/quality, price/value, emotional/gift.
2. All ${posterCount} ref_prompts must clearly describe DIFFERENT beautiful scenes; never repeat the same background.
3. ru_caption must be 100% Cyrillic Russian, with correct spelling. If you are not sure of a spelling, choose a simpler word.
4. Output ONLY valid JSON, no prose, no markdown, no trailing comma.

Product analysis: ${JSON.stringify(analysisJson).slice(0, 4000)}${copywriting ? `
Russian title (for reference, do not copy verbatim): ${copywriting?.title_ru || ""}
Russian selling bullets (for reference): ${JSON.stringify(copywriting?.bullets_ru || [])}` : ""}
Product name: ${productName}

JSON schema to output:
{
  "posters": [
    { "ref_prompt": "...", "ru_caption": "...", "text_theme": "light|dark", "caption_position": "top|center|bottom" }
  ]
}`;

  // 使用 TEXT_MODELS 降级链调用，v3.1: 关闭 thinking + 限制 max_tokens
  const { content: rawContent } = await callDashScopeWithFallback(
    apiKey,
    TEXT_MODELS,
    [{ role: "user", content: prompt }],
    0.6,
    "StepD",
    { enableThinking: false, maxTokens: 3000 }
  );

  const parsed = parseAIJson(rawContent);
  const plans = sanitizeMarketingPlans(parsed?.posters || parsed);
  const minRequired = posterCount; // v5.0: 必须凑齐 3 张海报
  if (plans.length < minRequired) {
    throw new Error(
      `营销海报规划产出不足 ${minRequired} 条 (目标: ${posterCount}, 实际: ${plans.length})，请求会被重试`
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
      mode,
      existing_task_id,
    } = reqBody;
    const generateMode: 'full' | 'regenerate_images' | 'regenerate_copy' =
      (mode === 'regenerate_images' || mode === 'regenerate_copy') ? mode : 'full';
    // 参数校验（仅 full 模式需要严格校验前端表单参数；
    // regenerate_* 模式以 existing_task_id 为入参，原始数据从主任务表加载）
    if (generateMode !== 'full') {
      if (!existing_task_id || typeof existing_task_id !== 'string') {
        return new Response(
          JSON.stringify({ error: "regenerate 模式必须提供 existing_task_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (generateMode === 'full' && (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0)) {
      return new Response(
        JSON.stringify({ error: "至少需要提供一张商品图片 URL" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 校验每个元素是否为有效的 URL 字符串（仅 full 模式）
    const invalidUrls = generateMode === 'full' ? image_urls.filter(
      (u: any) => typeof u !== 'string' || !u.startsWith('http')
    ) : [];
    if (invalidUrls.length > 0) {
      return new Response(
        JSON.stringify({ error: `图片 URL 格式无效，必须为 http/https 开头的字符串` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (generateMode === 'full' && !product_name) {
      return new Response(
        JSON.stringify({ error: "商品名称不能为空" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (generateMode === 'full' && (typeof price !== 'number' || !isFinite(price) || price <= 0)) {
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

    let lastProgress = 0;
    let lastStage = "初始化中...";

    const sendSSE = async (data: any) => {
      if (data?.status === "processing") {
        if (typeof data.progress === "number") {
          lastProgress = data.progress;
        }
        if (typeof data.stage === "string" && data.stage.trim()) {
          lastStage = data.stage;
        }
      }

      try {
        await writer.write(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      } catch {
        // 客户端可能已断开连接，忽略写入错误
      }
    };

    const heartbeatTimer = setInterval(() => {
      void sendSSE({
        status: "processing",
        progress: lastProgress,
        stage: lastStage,
        heartbeat: true,
      });
    }, 10000); // v3.0: 10s heartbeat (was 15s) to keep SSE alive through proxies

    let listingTaskId: string | null = null;
    const updateListingTask = async (
      status: "processing" | "processing_images" | "done" | "partial" | "error",
      payload: Record<string, any> = {}
    ) => {
      if (!listingTaskId) return;
      try {
        await supabase
          .from("ai_listing_generation_tasks")
          .update({ status, ...payload })
          .eq("id", listingTaskId);
      } catch (persistError) {
        console.error("[AI Listing] 持久化任务状态失败:", persistError);
      }
    };

    // 7. 异步执行 AI 链路
    (async () => {
      const startTime = Date.now();

      try {
        // ============== regenerate 模式：复用现有主任务 ==============
        if (generateMode !== 'full') {
          listingTaskId = existing_task_id as string;
          // 读取主任务以获取原 request_payload + result_payload
          const { data: parentRow, error: parentReadErr } = await supabase
            .from('ai_listing_generation_tasks')
            .select('id, request_payload, result_payload, created_by')
            .eq('id', listingTaskId)
            .maybeSingle();
          if (parentReadErr || !parentRow) {
            throw new Error(`未找到主任务 ${listingTaskId}: ${parentReadErr?.message || '不存在'}`);
          }
          // 校验当前管理员能否操作（必须是本人创建的任务）
          if (parentRow.created_by && String(parentRow.created_by) !== String(adminId)) {
            throw new Error('无权操作他人创建的任务');
          }
          const origReq = parentRow.request_payload || {};
          const origResult = parentRow.result_payload || {};
          const reqImageUrls: string[] = Array.isArray(origReq.image_urls) ? origReq.image_urls : [];
          const reqProductName: string = origReq.product_name || '';
          const reqPrice: number = typeof origReq.price === 'number' ? origReq.price : 0;
          const reqCategory: string = origReq.category || '';
          const reqSpecs: string = origReq.specs || '';
          const reqNotes: string = origReq.notes || '';

          if (generateMode === 'regenerate_copy') {
            // 仅重新生成文案：复用 analysis（如有），否则重新做 Step A
            await sendSSE({ status: 'processing', progress: 10, stage: '正在重新生成文案...', task_id: listingTaskId });
            await updateListingTask('processing', { error_message: null });
            let analysisResult = origResult.analysis;
            if (!analysisResult) {
              const analysis = await withRetry(() => callQwenVL(
                dashscopeApiKey, reqImageUrls, reqCategory, reqProductName, reqSpecs, reqNotes
              ));
              analysisResult = await withRetry(() => ensureLocalizedAIUnderstanding({
                apiKey: dashscopeApiKey, analysis, productName: reqProductName, price: reqPrice,
              }));
            }
            const copywriting = await withRetry(() => callQwenPlus(dashscopeApiKey, analysisResult, reqPrice));
            // 合并新文案 + 保留旧的图片相关字段
            const merged = {
              ...origResult,
              ...copywriting,
              analysis: analysisResult,
            };
            // 保持原状态（done/partial/processing_images）；若主任务已是终态则维持
            const prevStatus = (await supabase
              .from('ai_listing_generation_tasks')
              .select('status')
              .eq('id', listingTaskId)
              .maybeSingle()).data?.status || 'done';
            const keepStatus = (prevStatus === 'processing_images') ? 'processing_images' : (prevStatus === 'partial' ? 'partial' : 'done');
            await updateListingTask(keepStatus as any, {
              result_payload: merged,
              error_message: null,
              completed_at: keepStatus === 'processing_images' ? null : new Date().toISOString(),
            });
            await sendSSE({
              status: keepStatus === 'processing_images' ? 'processing_images' : (keepStatus === 'partial' ? 'partial' : 'done'),
              progress: 100,
              result: merged,
              message: '文案已重新生成',
              duration_ms: Date.now() - startTime,
              task_id: listingTaskId,
            });
            return;
          }

          // ===== regenerate_images: 重新规划+入队海报 =====
          await sendSSE({ status: 'processing', progress: 10, stage: '正在重新规划营销海报...', task_id: listingTaskId });
          await updateListingTask('processing', { error_message: null });

          // 1) analysis 必须存在（否则需要先重新文案）
          let analysisResult = origResult.analysis;
          if (!analysisResult) {
            const analysis = await withRetry(() => callQwenVL(
              dashscopeApiKey, reqImageUrls, reqCategory, reqProductName, reqSpecs, reqNotes
            ));
            analysisResult = await withRetry(() => ensureLocalizedAIUnderstanding({
              apiKey: dashscopeApiKey, analysis, productName: reqProductName, price: reqPrice,
            }));
          }

          // 2) 抠图：优先复用 segmented_image；否则重新抠
          let segmentedUrl: string | null = origResult.segmented_image || null;
          if (!segmentedUrl) {
            const segmentProxyUrl = Deno.env.get('SEGMENT_PROXY_URL') || 'https://tezbarakat.com/api/segment';
            const segmentProxyKey = Deno.env.get('SEGMENT_PROXY_KEY') || 'dodo-segment-2024';
            try {
              const segResp = await fetch(segmentProxyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_url: reqImageUrls[0], api_key: segmentProxyKey }),
              });
              const segData = await segResp.json();
              if (!segResp.ok || segData.error) throw new Error(segData.error || `抠图代理 HTTP ${segResp.status}`);
              segmentedUrl = segData.segmented_url as string;
            } catch (e) {
              throw new Error(`抠图失败，无法重新生成海报: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          // 3) 重新规划海报
          const plans: MarketingPosterPlan[] = await withRetry(
            () => callQwenMarketingPlanner(
              dashscopeApiKey, analysisResult,
              { title_ru: origResult.title_ru, bullets_ru: origResult.bullets_ru },
              reqProductName, reqPrice
            ), 2, 1000
          );
          if (!plans.length) throw new Error('海报规划返回空');

          // 4-0) 持久化抠图 URL（阿里云 OSS 签名 URL 可能已过期）
          {
            const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
            const isAlreadyPermanent = segmentedUrl!.includes(supabaseUrl) || segmentedUrl!.includes("supabase.co/storage");
            if (!isAlreadyPermanent) {
              try {
                console.log("[重生海报] 持久化抠图 URL 到 Supabase Storage...");
                segmentedUrl = await downloadAndUploadToStorage(segmentedUrl!, supabase);
                console.log(`[重生海报] 抠图已持久化: ${segmentedUrl.slice(0, 80)}...`);
              } catch (persistErr) {
                const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
                console.error("[重生海报] 抠图持久化失败（降级）:", errMsg);
              }
            }
          }

          // 4) 删除旧的 ai_image_tasks 子任务
          await supabase.from('ai_image_tasks').delete().eq('parent_task_id', listingTaskId);

          // 5) 写入新的子任务（统一为 3 张）
          const rows = plans.map((p, idx) => ({
            parent_task_id: listingTaskId!,
            admin_user_id: String(adminId),
            base_image_url: segmentedUrl!,
            ref_prompt: p.ref_prompt,
            ru_caption: p.ru_caption,
            text_theme: p.text_theme,
            caption_position: p.caption_position,
            display_order: idx,
            status: 'pending',
          }));
          const { error: insErr } = await supabase.from('ai_image_tasks').insert(rows);
          if (insErr) throw new Error(`重新入队失败: ${insErr.message}`);

          // 6) 重置 result_payload 中的图片相关字段为"等待中"
          const resetResult = {
            ...origResult,
            background_images: [],
            marketing_images: [],
            parent_task_id: listingTaskId,
            enqueued_images: rows.length,
            segmented_image: segmentedUrl,
            analysis: analysisResult,
          };
          await updateListingTask('processing_images', {
            result_payload: resetResult,
            error_message: null,
            completed_at: null,
          });
          await sendSSE({
            status: 'processing_images',
            progress: 100,
            stage: `${rows.length} 张营销海报已重新加入后台队列，请等待实时推送…`,
            result: resetResult,
            duration_ms: Date.now() - startTime,
            task_id: listingTaskId,
          });
          return;
        }

        // ============== full 模式（原逻辑） ==============
        const { data: listingTaskRow, error: listingTaskError } = await supabase
          .from("ai_listing_generation_tasks")
          .insert({
            status: "processing",
            request_payload: reqBody,
            created_by: String(adminId),
          })
          .select("id")
          .single();

        listingTaskId = listingTaskRow?.id || null;
        if (listingTaskError || !listingTaskId) {
          throw new Error(
            `创建 AI 上架持久化任务失败: ${listingTaskError?.message || "未返回任务 ID"}`
          );
        }

        // ---- Step A: 图片理解 ----
        await sendSSE({
          status: "processing",
          progress: 10,
          stage: "正在分析商品图片...",
          task_id: listingTaskId,
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

        // ---- v3.0: 并行执行 Step B（文案）+ Step C（抠图）+ Step D（海报规划）----
        // Step B 和 Step C 互不依赖，可以并行
        // Step D 只需要 analysisResult，不需要 segmentedUrl，也可以并行
        await sendSSE({
          status: "processing",
          progress: 30,
          stage: "正在并行生成文案、抠图和海报规划...",
        });

        const segmentProxyUrl = Deno.env.get("SEGMENT_PROXY_URL") || "https://tezbarakat.com/api/segment";
        const segmentProxyKey = Deno.env.get("SEGMENT_PROXY_KEY") || "dodo-segment-2024";

        // 并行启动 Step B + Step C + Step D
        const [copywritingResult, segmentResult, planResult] = await Promise.allSettled([
          // Step B: 三语文案
          withRetry(() => callQwenPlus(dashscopeApiKey, analysisResult, price)),
          // Step C: 抠图
          (async () => {
            const segController = new AbortController();
            const segTimeout = setTimeout(() => segController.abort(), 60000); // 60s (was 90s)
            try {
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
              const segData = await segResp.json();
              if (!segResp.ok || segData.error) {
                throw new Error(segData.error || `抠图代理返回错误 (HTTP ${segResp.status})`);
              }
              console.log(`[Step C] 商品分割完成 (耗时 ${segData.duration_ms}ms):`, segData.segmented_url);
              return segData.segmented_url as string;
            } catch (e) {
              clearTimeout(segTimeout);
              throw e;
            }
          })(),
          // Step D: 海报规划（只需要 analysisResult，不需要 segmentedUrl）
          withRetry(
            () => callQwenMarketingPlanner(
              dashscopeApiKey,
              analysisResult,
              null, // copywriting not yet available, planner uses analysisResult directly
              product_name,
              price
            ),
            2,
            1000
          ),
        ]);

        // 解析并行结果
        // Step B: 文案（必须成功）
        if (copywritingResult.status === "rejected") {
          throw new Error(`文案生成失败: ${copywritingResult.reason?.message || copywritingResult.reason}`);
        }
        const copywriting = copywritingResult.value;
        console.log("[Step B] 文案生成完成");

        // Step C: 抠图（可降级）
        let segmentedUrl: string | null = null;
        let segmentFailed = false;
        if (segmentResult.status === "fulfilled") {
          segmentedUrl = segmentResult.value;
        } else {
          segmentFailed = true;
          const errMsg = segmentResult.reason instanceof Error
            ? (segmentResult.reason.name === 'AbortError' ? '抠图超时 (60s)' : segmentResult.reason.message)
            : String(segmentResult.reason);
          console.error("[Step C] 商品分割失败（降级处理）:", errMsg);
          await sendSSE({
            status: "processing",
            progress: 50,
            stage: "抠图失败，将使用原始图片继续...",
            error: errMsg,
          });
        }

        // Step D: 海报规划（可降级，但需要抠图成功才有意义）
        let plans: MarketingPosterPlan[] = [];
        let planFailed = false;
        if (segmentedUrl && planResult.status === "fulfilled") {
          plans = planResult.value;
          console.log(`[Step D] 海报规划完成: ${plans.length} 条`);
        } else if (!segmentedUrl) {
          planFailed = true;
          console.log("[Step D] 抠图失败，跳过海报规划");
        } else {
          planFailed = true;
          const errMsg = planResult.status === "rejected"
            ? (planResult.reason instanceof Error ? planResult.reason.message : String(planResult.reason))
            : "未知错误";
          console.error("[Step D] 海报规划失败（降级）:", errMsg);
          await sendSSE({
            status: "processing",
            progress: 60,
            stage: "海报规划失败，将仅返回文案结果...",
            error: errMsg,
          });
        }

        // ---- Step E-0: 持久化抠图 URL（阿里云 OSS 签名 URL 有效期约 1 小时，
        //   后台 pg_cron 处理时可能已过期，提前上传到 Supabase Storage 获取永久 URL）----
        if (segmentedUrl && plans.length > 0 && !planFailed) {
          const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
          const isAlreadyPermanent = segmentedUrl.includes(supabaseUrl) || segmentedUrl.includes("supabase.co/storage");
          if (!isAlreadyPermanent) {
            try {
              console.log("[Step E-0] 持久化抠图 URL 到 Supabase Storage...");
              segmentedUrl = await downloadAndUploadToStorage(segmentedUrl, supabase);
              console.log(`[Step E-0] 抠图已持久化: ${segmentedUrl.slice(0, 80)}...`);
            } catch (persistErr) {
              // 持久化失败不阻断：后台 processor 仍有 persistBaseImage 兜底
              const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
              console.error("[Step E-0] 抠图持久化失败（降级，后台 processor 会重试）:", errMsg);
            }
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
            task_id: listingTaskId,
          });
          // 直接复用主任务 ID 作为 parent_task_id，避免前台与后台维护两套任务主键。
          // 这样图片处理器可以天然回写 ai_listing_generation_tasks，前端也只需轮询一张主表。
          parentTaskId = listingTaskId;
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
          await updateListingTask("error", {
            error_message: "文案生成结果不完整",
            completed_at: new Date().toISOString(),
          });
          await sendSSE({
            status: "error",
            progress: 100,
            error: "文案生成结果不完整",
            task_id: listingTaskId,
          });
        } else if (segmentFailed) {
          // 分割失败 → 仅文案
          const partialResult = {
            ...copywriting,
            background_images: [],
            marketing_images: [],
            parent_task_id: null,
            enqueued_images: 0,
            original_images: image_urls,
            material_guess: analysisResult.material_guess || null,
            analysis: analysisResult,
          };
          await updateListingTask("partial", {
            result_payload: partialResult,
            completed_at: new Date().toISOString(),
          });
          await sendSSE({
            status: "partial",
            progress: 100,
            result: partialResult,
            message: "抠图失败，可使用原始图片上架",
            duration_ms: duration,
            task_id: listingTaskId,
          });
        } else if (planFailed || !parentTaskId) {
          // 规划/入队失败 → 返回文案 + 抠图原图
          const partialResult = {
            ...copywriting,
            background_images: segmentedUrl ? [segmentedUrl] : [],
            marketing_images: [],
            parent_task_id: null,
            enqueued_images: 0,
            segmented_image: segmentedUrl,
            original_images: image_urls,
            material_guess: analysisResult.material_guess || null,
            analysis: analysisResult,
          };
          await updateListingTask("partial", {
            result_payload: partialResult,
            completed_at: new Date().toISOString(),
          });
          await sendSSE({
            status: "partial",
            progress: 100,
            result: partialResult,
            message: "海报规划或入队失败，仅返回文案和抠图原图",
            duration_ms: duration,
            task_id: listingTaskId,
          });
        } else {
          // 正常分叉：SSE 立即返回，后台任务由 pg_cron/processor 逐张完成
          const processingImagesResult = {
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
          };
          await updateListingTask("processing_images", {
            result_payload: processingImagesResult,
            error_message: null,
            completed_at: null,
          });
          await sendSSE({
            status: "processing_images",
            progress: 100,
            stage: `文案已完成，${enqueuedCount} 张营销海报已加入后台队列，请等待实时推送…`,
            result: processingImagesResult,
            duration_ms: duration,
            task_id: listingTaskId,
          });
        }

        console.log(
          `[AI Listing] 主函数完成，耗时 ${duration}ms，规划海报 ${plans.length} 条，入队 ${enqueuedCount} 条`
        );
      } catch (error) {
        // 致命错误（Step A / Step B / 任意未预期分支失败）
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[AI Listing] 致命错误:", errMsg);
        await updateListingTask("error", {
          error_message: errMsg,
          completed_at: new Date().toISOString(),
        });
        await sendSSE({
          status: "error",
          progress: 0,
          error: errMsg,
          task_id: listingTaskId,
        });
      } finally {
        clearInterval(heartbeatTimer);
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
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
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
