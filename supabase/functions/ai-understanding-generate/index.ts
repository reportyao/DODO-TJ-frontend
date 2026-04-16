/**
 * AI 商品理解生成 — Edge Function
 *
 * 为指定的库存商品生成 AI 理解数据，并保存到 inventory_products.ai_understanding 字段。
 * 同时同步更新关联的 lotteries 表。
 *
 * 新版链路：
 *   1. 先基于图片/文本生成语言无关的结构化商品事实 semantic_facts
 *   2. 再分别基于 semantic_facts 直接生成塔吉克语与俄语用户文案
 *   3. 最后仅为后台运营补充中文辅助翻译
 *   4. 以多语言嵌套结构 + 事实层元数据保存到数据库
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
  generation_mode: "semantic_facts_to_tg_ru_then_translate_zh";
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
  return JSON.parse(cleaned);
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
    generation_mode: "semantic_facts_to_tg_ru_then_translate_zh",
    primary_market_language: "tg",
    display_priority: ["tg", "ru", "zh"],
    source_language: "multi",
  };
}

async function callDashscope(apiKey: string, model: string, messages: any[], temperature: number) {
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
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${model} 调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error(`${model} 返回内容为空`);
  }

  return parseAIJson(rawContent);
}

function buildSemanticFactsPrompt(params: {
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const { name, desc, specs, material, price } = params;
  return `你是一名面向塔吉克斯坦电商业务的商品理解专家。你的任务不是直接写营销文案，而是先抽取一份“语言无关、可复用、可审计”的结构化商品事实，为后续分别生成塔吉克语和俄语用户文案提供统一依据。

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
3. usage_steps、usage_tips、parameter_highlights 必须尽量具体，帮助第一次接触这类商品的人理解“怎么用”。
4. local_context_signals 必须贴近塔吉克斯坦真实生活，而不是泛泛写“适合本地”。
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

function buildDirectUnderstandingPrompt(params: {
  language: "tg" | "ru";
  semanticFacts: SemanticFacts;
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const { language, semanticFacts, name, desc, specs, material, price } = params;
  const languageName = language === "tg" ? "塔吉克语" : "俄语";
  const extraRules = language === "tg"
    ? `
5. 请直接输出自然、地道、面向塔吉克普通消费者的塔吉克语，不要夹杂中文，也尽量避免俄语硬翻译腔。
6. 语言要像本地熟人推荐商品一样易懂，不要写成官方说明书。`
    : `
5. 请直接输出自然、可信、适合塔吉克斯坦电商用户阅读的俄语，不要写成官样宣传稿。
6. 语言要有人味，像懂商品的人在认真推荐。`;

  return `你是一名服务于塔吉克斯坦电商平台的本地化商品文案专家。现在请基于同一份结构化商品事实，直接生成面向普通用户的${languageName}商品理解文案。

【商品信息】
- 名称：${name}
- 描述：${desc || "未提供"}
- 规格：${specs || "未提供"}
- 材质：${material || "未提供"}
- 价格：${price} сомони

【结构化商品事实】
${JSON.stringify(semanticFacts, null, 2)}

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
4. recommended_badge 要短、顺口、适合做商品角标。${extraRules}
7. 只输出 JSON，不要附加任何说明。`;
}

async function generateDirectUnderstandingByLanguage(params: {
  apiKey: string;
  language: "tg" | "ru";
  semanticFacts: SemanticFacts;
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const prompt = buildDirectUnderstandingPrompt(params);
  return normalizeSingleLanguageUnderstanding(
    await callDashscope(params.apiKey, "qwen3.5-plus", [{ role: "user", content: prompt }], 0.45)
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
    await callDashscope(params.apiKey, "qwen3.5-plus", [{ role: "user", content: prompt }], 0.2)
  );
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

    const semanticFacts = await generateSemanticFacts({
      apiKey: dashscopeApiKey,
      imageUrls,
      name,
      desc,
      specs,
      material,
      price,
    });

    // 并行生成塔吉克语和俄语文案以减少总耗时
    const [tgUnderstanding, ruUnderstanding] = await Promise.all([
      generateDirectUnderstandingByLanguage({
        apiKey: dashscopeApiKey,
        language: "tg",
        semanticFacts,
        name,
        desc,
        specs,
        material,
        price,
      }),
      generateDirectUnderstandingByLanguage({
        apiKey: dashscopeApiKey,
        language: "ru",
        semanticFacts,
        name,
        desc,
        specs,
        material,
        price,
      }),
    ]);

    const zhUnderstanding = await generateChineseBackofficeUnderstanding({
      apiKey: dashscopeApiKey,
      semanticFacts,
      tgUnderstanding,
      ruUnderstanding,
    });

    const understandingData = buildLocalizedUnderstanding({
      tg: tgUnderstanding,
      ru: ruUnderstanding,
      zh: zhUnderstanding,
      semanticFacts,
      generated_by: "ai-understanding-generate",
      model_used: imageUrls.length > 0
        ? "qwen-vl-max -> qwen3.5-plus(tg) -> qwen3.5-plus(ru) -> qwen3.5-plus(zh)"
        : "qwen3.5-plus -> qwen3.5-plus(tg) -> qwen3.5-plus(ru) -> qwen3.5-plus(zh)",
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
