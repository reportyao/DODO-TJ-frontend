/**
 * AI 商品理解批量回填 — Edge Function
 *
 * 分批处理所有缺少 ai_understanding 的 inventory_products，
 * 逐个调用 AI 生成理解数据并保存。支持限速和断点续传。
 *
 * 请求体：
 *   {
 *     batch_size?: number,    // 每批处理数量，默认 10
 *     offset?: number,        // 起始偏移量，默认 0
 *     delay_ms?: number,      // 每个商品之间的延迟（毫秒），默认 2000
 *     force_regenerate?: boolean  // 是否强制重新生成所有商品（忽略已有数据），默认 false
 *   }
 *
 * 认证：x-admin-session-token → verify_admin_session RPC
 * 响应：JSON（返回处理结果摘要）
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 解析 AI 返回的 JSON（可能被 markdown 代码块包裹）
 */
function parseAIJson(text: string): any {
  let cleaned = text.trim();
  // 处理 ```json ... ``` 或 ``` ... ``` 包裹
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // 处理 qwen3.5 可能输出的 <think>...</think> 标签
  const thinkEnd = cleaned.indexOf("</think>");
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

  return JSON.parse(cleaned);
}

/**
 * 为单个商品生成 AI 理解数据
 * 支持视觉模型（有图片时）和纯文本模型（无图片时）
 */
async function generateUnderstanding(
  apiKey: string,
  product: any
): Promise<any> {
  const name = product.name_i18n?.zh || product.name || "未知商品";
  const desc = product.description_i18n?.zh || product.description || "";
  const specs =
    product.specifications_i18n?.zh || product.specifications || "";
  const material = product.material_i18n?.zh || product.material || "";
  const price = product.original_price || 0;
  const imageUrls: string[] =
    product.image_urls || (product.image_url ? [product.image_url] : []);

  if (imageUrls.length > 0) {
    // ── 视觉模型路径 ──
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
          Authorization: `Bearer ${apiKey}`,
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
      throw new Error(
        `AI 视觉模型调用失败 (HTTP ${response.status}): ${errText}`
      );
    }

    const result = await response.json();
    const rawContent = result.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI 返回内容为空");

    return parseAIJson(rawContent);
  } else {
    // ── 纯文本模型路径 ──
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
          Authorization: `Bearer ${apiKey}`,
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

    return parseAIJson(rawContent);
  }
}

// ============================================================
// 主处理函数
// ============================================================

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
    const {
      batch_size = 10,
      offset = 0,
      delay_ms = 2000,
      force_regenerate = false,
    } = await req.json();

    // 3. 查询需要处理的商品
    let query = supabase
      .from("inventory_products")
      .select("*")
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: true })
      .range(offset, offset + batch_size - 1);

    // 非强制模式只处理缺少 ai_understanding 的商品
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

    // 4. 统计剩余数量（用于前端展示进度）
    let remainingQuery = supabase
      .from("inventory_products")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE");

    if (!force_regenerate) {
      remainingQuery = remainingQuery.is("ai_understanding", null);
    }

    const { count: totalRemaining } = await remainingQuery;

    // 5. 逐个处理商品
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
      const productName =
        product.name_i18n?.zh || product.name || "未知商品";

      try {
        console.log(
          `[ai-understanding-batch] 处理商品 ${i + 1}/${products.length}: ${productName} (${product.id})`
        );

        // 调用 AI 生成理解数据
        const understanding = await generateUnderstanding(
          dashscopeApiKey,
          product
        );

        const understandingData = {
          ...understanding,
          generated_at: new Date().toISOString(),
          generated_by: "ai-understanding-batch",
          model_used:
            (product.image_urls?.length > 0 || product.image_url)
              ? "qwen-vl-max"
              : "qwen3.5-plus",
        };

        // 保存到 inventory_products
        const { error: updateError } = await supabase
          .from("inventory_products")
          .update({ ai_understanding: understandingData })
          .eq("id", product.id);

        if (updateError) {
          throw new Error(`保存失败: ${updateError.message}`);
        }

        // 同步到关联的 lotteries
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

        console.log(
          `[ai-understanding-batch] 成功: ${productName}`
        );
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[ai-understanding-batch] 失败: ${productName} — ${errMsg}`
        );
        results.push({
          id: product.id,
          name: productName,
          status: "error",
          error: errMsg,
        });
        errorCount++;
      }

      // 延迟，避免 API 限速（最后一个商品不需要延迟）
      if (delay_ms > 0 && i < products.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay_ms));
      }
    }

    // 6. 返回处理结果摘要
    return new Response(
      JSON.stringify({
        success: true,
        processed: products.length,
        success_count: successCount,
        error_count: errorCount,
        total_remaining: Math.max(
          0,
          (totalRemaining || 0) - successCount
        ),
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
