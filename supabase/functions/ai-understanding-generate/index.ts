/**
 * AI 商品理解生成 — Edge Function
 *
 * 为指定的库存商品生成 AI 理解数据（target_people、selling_angle、best_scene 等），
 * 并保存到 inventory_products.ai_understanding 字段。
 * 同时同步更新关联的 lotteries 表。
 *
 * 新版链路：
 *   1. 先基于图片/文本生成高质量俄语商品理解
 *   2. 再以俄语为标准翻译为中文和塔吉克语
 *   3. 以多语言嵌套结构保存到数据库
 *
 * 请求体：
 *   {
 *     product_id: string,           // 库存商品 ID（必填）
 *     force_regenerate?: boolean     // 是否强制重新生成（即使已有数据）
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
  "best_scene",
  "local_life_connection",
  "recommended_badge",
] as const;

type AIUnderstandingField = (typeof AI_UNDERSTANDING_FIELDS)[number];
type LocalizedValue = { ru: string; zh: string; tg: string };
type LocalizedAIUnderstanding = Record<AIUnderstandingField, LocalizedValue> & {
  generated_at: string;
  generated_by: string;
  model_used: string;
  source_language: "ru";
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

function normalizeLocalizedAIUnderstanding(payload: any, meta: {
  generated_by: string;
  model_used: string;
}): LocalizedAIUnderstanding {
  const normalized = {} as Record<AIUnderstandingField, LocalizedValue>;

  for (const field of AI_UNDERSTANDING_FIELDS) {
    const raw = payload?.[field];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      normalized[field] = {
        ru: cleanText(raw.ru),
        zh: cleanText(raw.zh),
        tg: cleanText(raw.tg),
      };
    } else {
      const fallback = cleanText(raw);
      normalized[field] = {
        ru: fallback,
        zh: fallback,
        tg: fallback,
      };
    }
  }

  return {
    ...normalized,
    generated_at: new Date().toISOString(),
    generated_by: meta.generated_by,
    model_used: meta.model_used,
    source_language: "ru",
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

async function generateRussianUnderstanding(params: {
  apiKey: string;
  imageUrls: string[];
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const { apiKey, imageUrls, name, desc, specs, material, price } = params;

  if (imageUrls.length > 0) {
    const images = imageUrls.slice(0, 3);
    const content: any[] = images.map((url: string) => ({
      type: "image_url",
      image_url: { url },
    }));

    content.push({
      type: "text",
      text: `你是一名服务于塔吉克斯坦电商平台的商品分析师，目标受众主要使用俄语。请结合商品图片和基础信息，先做商品理解，再只输出高质量俄语结果。

【商品信息】
- 名称：${name}
- 描述：${desc || "未提供"}
- 规格：${specs || "未提供"}
- 材质：${material || "未提供"}
- 价格：${price} сомони

请只输出以下 JSON：
{
  "target_people": "俄语：最适合的人群描述，具体到人群特征和生活状态",
  "selling_angle": "俄语：为什么这个人在这个场景下会觉得这个东西好用，要像熟人推荐一样自然",
  "best_scene": "俄语：最自然的使用画面，具体到动作和场景",
  "local_life_connection": "俄语：与塔吉克斯坦本地生活的真实连接点",
  "recommended_badge": "俄语：推荐角标短语，2-5个词"
}

要求：
1. 所有字段必须直接输出俄语，不要输出中文解释。
2. best_scene 必须是具体画面，不能抽象。
3. selling_angle 必须口语自然，不要空泛营销词。
4. local_life_connection 必须体现塔吉克斯坦真实生活方式或消费场景。
5. recommended_badge 要短、顺口、适合电商标签。
6. 只输出 JSON，不要附加其他说明。`,
    });

    return await callDashscope(apiKey, "qwen-vl-max", [{ role: "user", content }], 0.4);
  }

  const prompt = `你是一名服务于塔吉克斯坦电商平台的商品分析师，目标受众主要使用俄语。请根据以下商品信息，输出高质量俄语商品理解文案。

【商品信息】
- 名称：${name}
- 描述：${desc || "未提供"}
- 规格：${specs || "未提供"}
- 材质：${material || "未提供"}
- 价格：${price} сомони

请只输出以下 JSON：
{
  "target_people": "俄语：最适合的人群描述，具体到人群特征和生活状态",
  "selling_angle": "俄语：为什么这个人在这个场景下会觉得这个东西好用，要像熟人推荐一样自然",
  "best_scene": "俄语：最自然的使用画面，具体到动作和场景",
  "local_life_connection": "俄语：与塔吉克斯坦本地生活的真实连接点",
  "recommended_badge": "俄语：推荐角标短语，2-5个词"
}

要求：所有字段必须是自然、准确、面向塔吉克斯坦本地生活场景的俄语表达。只输出 JSON。`;

  return await callDashscope(apiKey, "qwen3.5-plus", [{ role: "user", content: prompt }], 0.4);
}

async function translateUnderstandingFromRu(apiKey: string, ruUnderstanding: Record<string, unknown>) {
  const prompt = `你是一名精通俄语、中文、塔吉克语的电商本地化编辑。下面给你一组“俄语原文”，请以俄语为标准，忠实翻译成中文和塔吉克语，并保留俄语原文。

请只输出以下 JSON 结构：
{
  "target_people": { "ru": "", "zh": "", "tg": "" },
  "selling_angle": { "ru": "", "zh": "", "tg": "" },
  "best_scene": { "ru": "", "zh": "", "tg": "" },
  "local_life_connection": { "ru": "", "zh": "", "tg": "" },
  "recommended_badge": { "ru": "", "zh": "", "tg": "" }
}

翻译要求：
1. ru 字段保留原文，不要改写。
2. zh 与 tg 必须以 ru 原文为唯一标准进行翻译，不能自行扩写。
3. selling_angle、best_scene、local_life_connection 要自然、口语、可读。
4. recommended_badge 必须简短，适合作为电商标签。
5. 只输出 JSON，不要附加说明。

俄语原文：${JSON.stringify(ruUnderstanding)}`;

  return await callDashscope(apiKey, "qwen3.5-plus", [{ role: "user", content: prompt }], 0.2);
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

    const ruUnderstanding = await generateRussianUnderstanding({
      apiKey: dashscopeApiKey,
      imageUrls,
      name,
      desc,
      specs,
      material,
      price,
    });

    const translatedUnderstanding = await translateUnderstandingFromRu(dashscopeApiKey, ruUnderstanding);

    const understandingData = normalizeLocalizedAIUnderstanding(translatedUnderstanding, {
      generated_by: "ai-understanding-generate",
      model_used: imageUrls.length > 0 ? "qwen-vl-max -> qwen3.5-plus" : "qwen3.5-plus -> qwen3.5-plus",
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
