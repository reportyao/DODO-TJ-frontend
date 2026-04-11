/**
 * AI 商品理解生成 — Edge Function
 *
 * 为指定的库存商品生成 AI 理解数据（target_people、selling_angle、best_scene 等），
 * 并保存到 inventory_products.ai_understanding 字段。
 * 同时同步更新关联的 lotteries 表。
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

/**
 * 解析 AI 返回的 JSON（可能被 markdown 代码块包裹）
 */
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

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. 验证管理员身份
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

    // 验证管理员 session
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

    // 2. 解析请求参数
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

    // 3. 查询商品信息
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

    // 4. 检查是否已有数据
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

    // 5. 构建 AI prompt
    const name = product.name_i18n?.zh || product.name || "未知商品";
    const desc = product.description_i18n?.zh || product.description || "";
    const specs = product.specifications_i18n?.zh || product.specifications || "";
    const material = product.material_i18n?.zh || product.material || "";
    const price = product.original_price || 0;
    const imageUrls: string[] = product.image_urls || (product.image_url ? [product.image_url] : []);

    // 构建 prompt — 如果有图片则使用多模态，否则使用纯文本
    let aiUnderstanding: any;

    if (imageUrls.length > 0) {
      // 使用视觉模型分析图片
      const images = imageUrls.slice(0, 3);
      const content: any[] = images.map((url: string) => ({
        type: "image_url",
        image_url: { url },
      }));

      content.push({
        type: "text",
        text: `你是一名深入了解塔吉克斯坦本地生活的商品分析师。请分析以下商品图片和信息，输出它在塔吉克本地日常生活中最真实、最自然的使用情境。

【商品信息】
- 名称：${name}
- 描述：${desc}
- 规格：${specs || "未提供"}
- 材质：${material || "未提供"}
- 价格：${price} сомони

请输出以下 JSON 结构：
{
  "target_people": "最适合的人群描述（具体到人群特征和生活状态）",
  "selling_angle": "为什么这个人在这个场景下会觉得这个东西好用，用大白话说清楚",
  "best_scene": "最自然的使用画面，具体到动作和场景",
  "local_life_connection": "与塔吉克斯坦本地生活的真实连接点",
  "recommended_badge": "推荐角标文案，4-6个字"
}

要求：
1. 所有内容必须用中文输出
2. "best_scene" 必须是具体的生活画面，不能是抽象描述
3. "selling_angle" 要说人话，像朋友推荐一样，不要用"高品质""甄选"等空泛词
4. "local_life_connection" 必须引用真实的塔吉克生活习惯
5. 请只输出 JSON，不要添加任何其他文字说明`,
      });

      const response = await fetch(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dashscopeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen-vl-max",
            messages: [{ role: "user", content }],
            temperature: 0.4,
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI 视觉模型调用失败 (HTTP ${response.status}): ${errText}`);
      }

      const result = await response.json();
      const rawContent = result.choices?.[0]?.message?.content;
      if (!rawContent) throw new Error("AI 返回内容为空");

      aiUnderstanding = parseAIJson(rawContent);
    } else {
      // 无图片，使用纯文本模型
      const prompt = `你是一名深入了解塔吉克斯坦本地生活的商品分析师。请分析以下商品，输出它在塔吉克本地日常生活中最真实、最自然的使用情境。

【商品信息】
- 名称：${name}
- 描述：${desc}
- 规格：${specs || "未提供"}
- 材质：${material || "未提供"}
- 价格：${price} сомони

请输出以下 JSON 结构：
{
  "target_people": "最适合的人群描述（具体到人群特征和生活状态）",
  "selling_angle": "为什么这个人在这个场景下会觉得这个东西好用，用大白话说清楚",
  "best_scene": "最自然的使用画面，具体到动作和场景",
  "local_life_connection": "与塔吉克斯坦本地生活的真实连接点",
  "recommended_badge": "推荐角标文案，4-6个字"
}

要求：用中文输出，说人话，不要空泛营销词。请只输出 JSON。`;

      const response = await fetch(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dashscopeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen3.5-plus",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.4,
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI 调用失败 (HTTP ${response.status}): ${errText}`);
      }

      const result = await response.json();
      const rawContent = result.choices?.[0]?.message?.content;
      if (!rawContent) throw new Error("AI 返回内容为空");

      aiUnderstanding = parseAIJson(rawContent);
    }

    // 6. 保存到数据库
    const understandingData = {
      ...aiUnderstanding,
      generated_at: new Date().toISOString(),
      generated_by: "ai-understanding-generate",
      model_used: imageUrls.length > 0 ? "qwen-vl-max" : "qwen3.5-plus",
    };

    const { error: updateError } = await supabase
      .from("inventory_products")
      .update({ ai_understanding: understandingData })
      .eq("id", product_id);

    if (updateError) {
      throw new Error(`保存失败: ${updateError.message}`);
    }

    // 7. 同步更新关联的 lotteries（如果有）
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
