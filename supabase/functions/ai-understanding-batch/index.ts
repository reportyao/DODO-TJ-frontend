/**
 * AI 商品理解批量回填 — Edge Function
 *
 * 分批处理所有缺少 ai_understanding 的 inventory_products，
 * 逐个调用 AI 生成理解数据并保存。支持限速和断点续传。
 *
 * 新版链路（与 ai-understanding-generate 保持一致）：
 *   1. 先基于图片/文本生成语言无关的结构化商品事实 semantic_facts
 *   2. 再分别基于 semantic_facts 直接生成塔吉克语与俄语用户文案
 *   3. 最后仅为后台运营补充中文辅助翻译
 *   4. 以多语言嵌套结构 + 事实层元数据保存到数据库
 *
 * 请求体：
 *   {
 *     batch_size?: number,
 *     offset?: number,
 *     delay_ms?: number,
 *     force_regenerate?: boolean
 *   }
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

  const thinkEnd = cleaned.indexOf("</think>");
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

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
2. how_to_use 需要保留"给小白看的使用理解"这个定位，可包含参数、场景和简单使用方法。
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

    const {
      batch_size = 10,
      offset = 0,
      delay_ms = 2000,
      force_regenerate = false,
    } = await req.json();

    let query = supabase
      .from("inventory_products")
      .select("*")
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (!force_regenerate) {
      query = query.is("ai_understanding", null);
    }

    const { data: products, error: queryError } = await query;

    if (queryError) {
      throw new Error(`查询商品失败: ${queryError.message}`);
    }

    if (!products || products.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "没有需要处理的商品",
          processed: 0,
          success_count: 0,
          error_count: 0,
          total_remaining: 0,
          next_offset: offset,
          results: [],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let remainingQuery = supabase
      .from("inventory_products")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE");

    if (!force_regenerate) {
      remainingQuery = remainingQuery.is("ai_understanding", null);
    }

    const { count: totalRemaining } = await remainingQuery;

    const results: Array<{
      id: string;
      name: string;
      status: "success" | "error";
      error?: string;
    }> = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const productName = product.name_i18n?.zh || product.name || "未知商品";
      const hasImages = (product.image_urls?.length || 0) > 0 || Boolean(product.image_url);

      try {
        console.log(`[ai-understanding-batch] 处理商品 ${i + 1}/${products.length}: ${productName} (${product.id})`);

        const name = product.name_i18n?.ru || product.name_i18n?.zh || product.name || "Неизвестный товар";
        const desc = product.description_i18n?.ru || product.description_i18n?.zh || product.description || "";
        const specs = product.specifications_i18n?.ru || product.specifications_i18n?.zh || product.specifications || "";
        const material = product.material_i18n?.ru || product.material_i18n?.zh || product.material || "";
        const price = product.original_price || 0;
        const imageUrls: string[] = product.image_urls || (product.image_url ? [product.image_url] : []);

        // Step 1: 生成语言无关的结构化商品事实
        const semanticFacts = await generateSemanticFacts({
          apiKey: dashscopeApiKey,
          imageUrls,
          name,
          desc,
          specs,
          material,
          price,
        });

        // Step 2: 基于 semantic_facts 直接生成塔吉克语文案
        const tgUnderstanding = await generateDirectUnderstandingByLanguage({
          apiKey: dashscopeApiKey,
          language: "tg",
          semanticFacts,
          name,
          desc,
          specs,
          material,
          price,
        });

        // Step 3: 基于 semantic_facts 直接生成俄语文案
        const ruUnderstanding = await generateDirectUnderstandingByLanguage({
          apiKey: dashscopeApiKey,
          language: "ru",
          semanticFacts,
          name,
          desc,
          specs,
          material,
          price,
        });

        // Step 4: 基于 tg + ru 文案生成中文后台辅助翻译
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
          generated_by: "ai-understanding-batch",
          model_used: hasImages
            ? "qwen-vl-max -> qwen3.5-plus(tg) -> qwen3.5-plus(ru) -> qwen3.5-plus(zh)"
            : "qwen3.5-plus -> qwen3.5-plus(tg) -> qwen3.5-plus(ru) -> qwen3.5-plus(zh)",
        });

        const { error: updateError } = await supabase
          .from("inventory_products")
          .update({ ai_understanding: understandingData })
          .eq("id", product.id);

        if (updateError) {
          throw new Error(`保存失败: ${updateError.message}`);
        }

        await supabase
          .from("lotteries")
          .update({ ai_understanding: understandingData })
          .eq("inventory_product_id", product.id);

        results.push({
          id: product.id,
          name: productName,
          status: "success",
        });
        successCount++;

        console.log(`[ai-understanding-batch] 成功: ${productName}`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[ai-understanding-batch] 失败: ${productName} — ${errMsg}`);
        results.push({
          id: product.id,
          name: productName,
          status: "error",
          error: errMsg,
        });
        errorCount++;
      }

      if (delay_ms > 0 && i < products.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay_ms));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: products.length,
        success_count: successCount,
        error_count: errorCount,
        total_remaining: Math.max(0, (totalRemaining || 0) - successCount),
        next_offset: offset + batch_size,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[ai-understanding-batch] 全局错误:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
