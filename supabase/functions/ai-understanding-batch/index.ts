/**
 * AI 商品理解批量回填 — Edge Function
 *
 * 分批处理所有缺少 ai_understanding 的 inventory_products，
 * 逐个调用 AI 生成理解数据并保存。支持限速和断点续传。
 *
 * 新版链路：
 *   1. 先生成俄语商品理解
 *   2. 再以俄语为标准翻译为中文和塔吉克语
 *   3. 以多语言嵌套结构写回 inventory_products / lotteries
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

  const thinkEnd = cleaned.indexOf("</think>");
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

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

async function generateRussianUnderstanding(apiKey: string, product: any) {
  const name = product.name_i18n?.ru || product.name_i18n?.zh || product.name || "Неизвестный товар";
  const desc = product.description_i18n?.ru || product.description_i18n?.zh || product.description || "";
  const specs = product.specifications_i18n?.ru || product.specifications_i18n?.zh || product.specifications || "";
  const material = product.material_i18n?.ru || product.material_i18n?.zh || product.material || "";
  const price = product.original_price || 0;
  const imageUrls: string[] = product.image_urls || (product.image_url ? [product.image_url] : []);

  if (imageUrls.length > 0) {
    const images = imageUrls.slice(0, 3);
    const content: any[] = images.map((url: string) => ({
      type: "image_url",
      image_url: { url },
    }));

    content.push({
      type: "text",
      text: `你是一名服务于塔吉克斯坦电商平台的商品分析师，目标受众主要使用俄语。请结合商品图片和基础信息，只输出高质量俄语商品理解结果。

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

要求：所有字段必须是自然、准确、适合塔吉克斯坦市场的俄语表达，只输出 JSON。`,
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

要求：只输出 JSON，不要添加任何说明。`;

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
2. zh 与 tg 必须以 ru 原文为唯一标准进行翻译。
3. 文风自然、简洁、适合商品详情页和导购卡片。
4. recommended_badge 必须足够简短，适合做标签。
5. 只输出 JSON。

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

        const ruUnderstanding = await generateRussianUnderstanding(dashscopeApiKey, product);
        const translatedUnderstanding = await translateUnderstandingFromRu(dashscopeApiKey, ruUnderstanding);

        const understandingData = normalizeLocalizedAIUnderstanding(translatedUnderstanding, {
          generated_by: "ai-understanding-batch",
          model_used: hasImages ? "qwen-vl-max -> qwen3.5-plus" : "qwen3.5-plus -> qwen3.5-plus",
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
