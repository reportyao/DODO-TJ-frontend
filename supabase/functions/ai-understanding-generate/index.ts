/**
 * AI 商品理解生成 — Edge Function
 *
 * 为指定的库存商品生成 AI 理解数据，并保存到 inventory_products.ai_understanding 字段。
 * 同时同步更新关联的 lotteries 表。
 *
 * 新版链路：
 *   1. 先基于图片/文本生成语言无关的结构化商品事实 semantic_facts
 *   2. 一次性生成塔吉克语、俄语和中文三套文案（统一调用，减少 API 次数）
 *   3. 以多语言嵌套结构 + 事实层元数据保存到数据库
 *
 * 请求体：
 *   {
 *     product_id: string,           // 库存商品 ID（必填）
 *     force_regenerate?: boolean    // 是否强制重新生成（即使已有数据）
 *   }
 *
 * 认证：x-admin-session-token → verify_admin_session RPC
 * 响应：JSON
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// [修复] 超时从 15s 提升到 90s，与项目中 ai-topic-generate / ai-listing-generate 保持一致
// qwen-vl-max 处理图片 + 长 prompt、qwen3.5-plus 生成多语言长文本（含 thinking）都需要较长响应时间
const DASHSCOPE_REQUEST_TIMEOUT_MS = 90000;
// [修复] 重试次数从 2 提升到 3，提高可靠性
const DASHSCOPE_MAX_RETRIES = 3;

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
type LocalizedValue = Record<LanguageCode, string>;

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

type LocalizedAIUnderstanding = Record<AIUnderstandingField, LocalizedValue> & {
  semantic_facts: SemanticFacts;
  generated_at: string;
  generated_by: string;
  model_used: string;
  generation_mode: "semantic_facts_to_unified_tg_ru_zh" | "semantic_facts_to_tg_ru_then_translate_zh";
  primary_market_language: "tg";
  display_priority: LanguageCode[];
  source_language: "multi";
};

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

  // [修复] 防御性处理 qwen3.5-plus thinking 模式可能返回的 <think>...</think> 标签
  // 与 ai-understanding-batch 的 parseAIJson 保持一致
  const thinkEnd = cleaned.indexOf("</think>");
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

  return JSON.parse(cleaned);
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = DASHSCOPE_MAX_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // [修复] 添加重试日志，便于排查间歇性失败
      console.warn(
        `[withRetry] 第 ${attempt + 1} 次失败，${attempt < maxRetries - 1 ? `${800 * (attempt + 1)}ms 后重试` : "已达最大重试次数"}:`,
        error instanceof Error ? error.message : String(error)
      );
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`DashScope 调用超时 (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringList(value: unknown, limit: number = 6): string[] {
  if (!Array.isArray(value)) {return [];}
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeSemanticFacts(payload: any): SemanticFacts {
  const raw = payload?.semantic_facts && typeof payload.semantic_facts === "object"
    ? payload.semantic_facts
    : payload || {};

  return {
    product_type: cleanText(raw.product_type),
    core_function: cleanText(raw.core_function),
    target_user_traits: cleanStringList(raw.target_user_traits),
    primary_pain_points: cleanStringList(raw.primary_pain_points),
    usage_steps: cleanStringList(raw.usage_steps),
    usage_tips: cleanStringList(raw.usage_tips),
    usage_scenarios: cleanStringList(raw.usage_scenarios),
    parameter_highlights: cleanStringList(raw.parameter_highlights),
    local_context_signals: cleanStringList(raw.local_context_signals),
    trust_signals: cleanStringList(raw.trust_signals),
    badge_candidates: cleanStringList(raw.badge_candidates, 4),
  };
}

function normalizeSingleLanguageUnderstanding(payload: any) {
  const normalized = {} as Record<AIUnderstandingField, string>;

  for (const field of AI_UNDERSTANDING_FIELDS) {
    const raw = payload?.[field];
    normalized[field] = cleanText(raw);
  }

  return normalized;
}

function buildLocalizedUnderstanding(params: {
  tg: Record<AIUnderstandingField, string>;
  ru: Record<AIUnderstandingField, string>;
  zh: Record<AIUnderstandingField, string>;
  semanticFacts: SemanticFacts;
  generated_by: string;
  model_used: string;
}): LocalizedAIUnderstanding {
  const { tg, ru, zh, semanticFacts, generated_by, model_used } = params;
  const localized = {} as Record<AIUnderstandingField, LocalizedValue>;

  for (const field of AI_UNDERSTANDING_FIELDS) {
    localized[field] = {
      tg: cleanText(tg[field]),
      ru: cleanText(ru[field]),
      zh: cleanText(zh[field]),
    };
  }

  return {
    ...localized,
    semantic_facts: semanticFacts,
    generated_at: new Date().toISOString(),
    generated_by,
    model_used,
    generation_mode: "semantic_facts_to_unified_tg_ru_zh",
    primary_market_language: "tg",
    display_priority: ["tg", "ru", "zh"],
    source_language: "multi",
  };
}

async function callDashscope(apiKey: string, model: string, messages: any[], temperature: number) {
  return await withRetry(async () => {
    const response = await fetchWithTimeout(
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
          // 保留 thinking 模式（不设置 enable_thinking，默认为 true）
          // qwen3.5-plus 的 thinking 模式有助于提升多语言文案的生成质量
          // 与项目中 ai-topic-generate / ai-listing-generate 保持一致做法
        }),
      },
      DASHSCOPE_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${model} 调用失败 (HTTP ${response.status}): ${errText}`);
    }

    const result = await response.json();
    const rawContent = result.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error(`${model} 返回内容为空。原始响应: ${JSON.stringify(result).slice(0, 500)}`);
    }

    return parseAIJson(rawContent);
  });
}

function buildSemanticFactsPrompt(params: {
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const { name, desc, specs, material, price } = params;
  return `你是一名面向塔吉克斯坦电商业务的商品理解专家。你的任务不是直接写营销文案，而是先抽取一份"语言无关、可复用、可审计"的结构化商品事实，为后续分别生成塔吉克语和俄语用户文案提供统一依据。

【商品信息】
- 名称：${name}
- 描述：${desc || "未提供"}
- 规格：${specs || "未提供"}
- 材质：${material || "未提供"}
- 价格：${price} сомони

请只输出以下 JSON：
{
  "semantic_facts": {
    "product_type": "一句话明确商品类型",
    "core_function": "一句话说明商品最核心的用途",
    "target_user_traits": ["适合的人群特征1", "适合的人群特征2"],
    "primary_pain_points": ["它解决的问题1", "它解决的问题2"],
    "usage_steps": ["使用动作或步骤1", "使用动作或步骤2"],
    "usage_tips": ["使用提醒或小技巧1", "使用提醒或小技巧2"],
    "usage_scenarios": ["典型使用场景1", "典型使用场景2"],
    "parameter_highlights": ["用户需要知道的参数或规格亮点1", "亮点2"],
    "local_context_signals": ["与塔吉克本地生活相关的连接点1", "连接点2"],
    "trust_signals": ["能增强购买信心的事实1", "事实2"],
    "badge_candidates": ["候选角标1", "候选角标2", "候选角标3"]
  }
}

要求：
1. 只输出 JSON，不要附加任何说明。
2. 这是一份中间事实层，不要写成长营销文案，不要写多语言内容。
3. usage_steps、usage_tips、parameter_highlights 必须尽量具体，帮助第一次接触这类商品的人理解"怎么用"。
4. local_context_signals 必须贴近塔吉克斯坦真实生活，而不是泛泛写"适合本地"。
5. 如果信息不足，请基于图片与已有商品信息做谨慎推断，避免明显夸大。`;
}

async function generateSemanticFacts(params: {
  apiKey: string;
  imageUrls: string[];
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const { apiKey, imageUrls, name, desc, specs, material, price } = params;
  const prompt = buildSemanticFactsPrompt({ name, desc, specs, material, price });

  if (imageUrls.length > 0) {
    const images = imageUrls.slice(0, 3);
    const content: any[] = images.map((url: string) => ({
      type: "image_url",
      image_url: { url },
    }));

    content.push({
      type: "text",
      text: prompt,
    });

    return normalizeSemanticFacts(
      await callDashscope(apiKey, "qwen-vl-max", [{ role: "user", content }], 0.3)
    );
  }

  return normalizeSemanticFacts(
    await callDashscope(apiKey, "qwen3.5-plus", [{ role: "user", content: prompt }], 0.3)
  );
}

async function generateUnifiedLocalizedUnderstanding(params: {
  apiKey: string;
  semanticFacts: SemanticFacts;
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const prompt = `你是一名服务于塔吉克斯坦电商平台的本地化商品文案专家。现在请基于同一份结构化商品事实，一次性输出塔吉克语、俄语和中文三套商品理解文案。塔吉克语和俄语直接面向用户，中文仅用于后台运营辅助理解。

【商品信息】
- 名称：${params.name}
- 描述：${params.desc || "未提供"}
- 规格：${params.specs || "未提供"}
- 材质：${params.material || "未提供"}
- 价格：${params.price} сомони

【结构化商品事实】
${JSON.stringify(params.semanticFacts, null, 2)}

请只输出以下 JSON：
{
  "tg": {
    "target_people": "",
    "selling_angle": "",
    "how_to_use": "",
    "best_scene": "",
    "local_life_connection": "",
    "recommended_badge": ""
  },
  "ru": {
    "target_people": "",
    "selling_angle": "",
    "how_to_use": "",
    "best_scene": "",
    "local_life_connection": "",
    "recommended_badge": ""
  },
  "zh": {
    "target_people": "",
    "selling_angle": "",
    "how_to_use": "",
    "best_scene": "",
    "local_life_connection": "",
    "recommended_badge": ""
  }
}

要求：
1. tg 必须是自然、地道、面向塔吉克普通消费者的塔吉克语，不要夹杂中文，也尽量避免俄语硬翻译腔。
2. ru 必须是自然、可信、适合塔吉克斯坦电商用户阅读的俄语，不要写成官样宣传稿。
3. zh 仅用于后台辅助理解，重在准确、通顺、易审核。
4. target_people、selling_angle、how_to_use 都必须直接面向普通用户，不要写分析术语。
5. how_to_use 不能空泛，至少自然包含一种使用步骤、参数亮点或场景细节，帮助第一次接触这类商品的人快速理解怎么用。
6. best_scene 必须是具体画面，不要抽象概括。
7. recommended_badge 要短、顺口、适合做商品角标。
8. 只输出 JSON，不要附加说明。`;

  const payload = await callDashscope(params.apiKey, "qwen3.5-plus", [{ role: "user", content: prompt }], 0.35);

  return {
    tg: normalizeSingleLanguageUnderstanding(payload?.tg),
    ru: normalizeSingleLanguageUnderstanding(payload?.ru),
    zh: normalizeSingleLanguageUnderstanding(payload?.zh),
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sessionToken = req.headers.get("x-admin-session-token");
    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: "ADMIN_AUTH_REQUIRED" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const dashscopeApiKey = Deno.env.get("DASHSCOPE_API_KEY") || "";

    if (!dashscopeApiKey) {
      throw new Error("DASHSCOPE_API_KEY 环境变量未配置");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: sessionData } = await supabase.rpc(
      "verify_admin_session",
      { p_session_token: sessionToken }
    );
    if (!sessionData) {
      return new Response(
        JSON.stringify({ error: "ADMIN_AUTH_FAILED" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { product_id, force_regenerate = false } = await req.json();

    if (!product_id) {
      return new Response(
        JSON.stringify({ error: "product_id 参数缺失" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: product, error: queryError } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("id", product_id)
      .single();

    if (queryError || !product) {
      return new Response(
        JSON.stringify({ error: `商品不存在: ${queryError?.message || "未找到"}` }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (product.ai_understanding && !force_regenerate) {
      return new Response(
        JSON.stringify({
          success: true,
          ai_understanding: product.ai_understanding,
          message: "该商品已有 AI 理解数据，如需重新生成请传 force_regenerate: true",
          skipped: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const name = product.name_i18n?.ru || product.name_i18n?.zh || product.name || "Неизвестный товар";
    const desc = product.description_i18n?.ru || product.description_i18n?.zh || product.description || "";
    const specs = product.specifications_i18n?.ru || product.specifications_i18n?.zh || product.specifications || "";
    const material = product.material_i18n?.ru || product.material_i18n?.zh || product.material || "";
    const price = product.original_price || 0;
    const imageUrls: string[] = product.image_urls || (product.image_url ? [product.image_url] : []);

    console.log(`[ai-understanding-generate] 开始生成: ${name} (${product_id}), 图片数: ${imageUrls.length}`);

    const semanticFacts = await generateSemanticFacts({
      apiKey: dashscopeApiKey,
      imageUrls,
      name,
      desc,
      specs,
      material,
      price,
    });

    console.log(`[ai-understanding-generate] semantic_facts 生成完成，开始生成三语文案`);

    // [可靠性修复] 将三语文案生成从 3 次模型调用简化为 1 次，显著缩短总耗时并降低 546 网关超时风险
    const localizedUnderstanding = await generateUnifiedLocalizedUnderstanding({
      apiKey: dashscopeApiKey,
      semanticFacts,
      name,
      desc,
      specs,
      material,
      price,
    });

    console.log(`[ai-understanding-generate] 三语文案生成完成，保存到数据库`);

    const understandingData = buildLocalizedUnderstanding({
      tg: localizedUnderstanding.tg,
      ru: localizedUnderstanding.ru,
      zh: localizedUnderstanding.zh,
      semanticFacts,
      generated_by: "ai-understanding-generate",
      model_used: imageUrls.length > 0
        ? "qwen-vl-max -> qwen3.5-plus(tg/ru/zh unified)"
        : "qwen3.5-plus -> qwen3.5-plus(tg/ru/zh unified)",
    });

    const { error: updateError } = await supabase
      .from("inventory_products")
      .update({ ai_understanding: understandingData })
      .eq("id", product_id);

    if (updateError) {
      throw new Error(`保存失败: ${updateError.message}`);
    }

    await supabase
      .from("lotteries")
      .update({ ai_understanding: understandingData })
      .eq("inventory_product_id", product_id);

    console.log(`[ai-understanding-generate] 完成: ${name} (${product_id})`);

    return new Response(
      JSON.stringify({
        success: true,
        ai_understanding: understandingData,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[ai-understanding-generate] 错误:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
