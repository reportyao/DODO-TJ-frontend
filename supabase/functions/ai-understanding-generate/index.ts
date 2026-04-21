/**
 * AI 商品理解生成 — Edge Function（异步派发版 v3.0）
 *
 * 【背景 / 修复说明】
 *  Supabase Edge Functions 网关存在 150s 的 idle timeout 硬上限：
 *  当客户端 → CF 网关 → Deno worker 链路在 150s 内没有收到任何字节，
 *  网关将强制返回 504 IDLE_TIMEOUT，且无法通过函数代码或控制台修改。
 *
 *  历史版本（v2.x）在单次同步请求中串联：
 *    qwen-vl-max(图片+长 prompt) → qwen3.5-plus(三语长文+ thinking)
 *  并叠加 90s × 3 retry，最坏 540s，远超 150s，导致前端在
 *  /admin/inventory-products 页面点击"AI 商品理解"时稳定 504：
 *    POST .../ai-understanding-generate 504 (Gateway Timeout)
 *    AI 理解生成失败: Error: AI 理解生成失败
 *
 * 【新版方案】
 *  采用 "任务派发 + 后台执行 + 前端轮询" 模式（Supabase 官方
 *  推荐的长任务处理范式，参考 EdgeRuntime.waitUntil 文档）：
 *
 *    1. POST 进入函数后：
 *       - 校验 admin session
 *       - 校验商品 / force_regenerate
 *       - 在 ai_understanding_jobs 表创建一条 pending 任务
 *       - 调用 EdgeRuntime.waitUntil(runJob(jobId)) 在后台执行
 *       - 立即返回 202 + { job_id, status: 'pending' }
 *       - 整条同步链路 < 1s，完全避开 150s 网关上限
 *
 *    2. 后台 runJob() 执行真实的 LLM 调用：
 *       - 单步硬 60s 超时（小于 worker 总寿命）
 *       - 视觉/文本模型支持降级链
 *       - 视觉步骤限制为最多 1 张图，避免重复编码 + 巨大上下文
 *       - 文本步骤显式关闭 thinking（提升 50%+ 响应速度，对营销文案影响可接受）
 *       - 任一步骤异常立即写 failed 并退出，不进行无限重试
 *
 *    3. 前端通过 ai-understanding-job-status 接口轮询 job 状态。
 *
 * 【兼容性】
 *  - 请求体与旧版完全兼容：{ product_id, force_regenerate? }
 *  - 旧版返回结构（success + ai_understanding）依然在"已存在且不强制
 *    重生成"路径下保留（属于真正可瞬时返回的场景）。
 *  - 新增字段：job_id / status / poll_url，用于异步流程。
 *  - 前端可通过 status === 'pending' 判断是否需要进入轮询逻辑。
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
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// CORS
// ============================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================
// 模型与超时配置
// ============================================================
/**
 * 单次 DashScope 调用最长 60s。
 *
 * - Edge Function worker 通常有约 400s 的 wall-clock，足够承载
 *   "VL 60s + Text 60s + 各 1 次降级 ≈ 240s" 的最坏后台执行时间。
 * - 关键约束并不是 worker 寿命，而是 150s 网关 idle timeout，但
 *   后台执行（waitUntil）不再受网关 idle timeout 约束，因此可以
 *   安心承担更长的真实计算耗时。
 */
const DASHSCOPE_REQUEST_TIMEOUT_MS = 60_000;

/**
 * 视觉理解模型降级链，与 ai-listing-generate 保持一致。
 * 首选最新旗舰，失败/限流回退到稳定版。
 */
const VISION_MODELS = ["qwen3-vl-plus", "qwen-vl-max"] as const;

/**
 * 文本生成模型降级链。
 *  - 优先使用 qwen-plus（响应快、稳定，适合多语言文案）
 *  - 回退到 qwen3.5-plus（与历史版本兼容）
 *  - 再回退到 qwen-max（旗舰文本，最稳）
 */
const TEXT_MODELS = ["qwen-plus", "qwen3.5-plus", "qwen-max"] as const;

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
  generation_mode: "semantic_facts_to_unified_tg_ru_zh";
  primary_market_language: "tg";
  display_priority: LanguageCode[];
  source_language: "multi";
};

// ============================================================
// 工具函数
// ============================================================
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

  // 防御性处理 thinking 模式可能残留的 <think>...</think>
  const thinkEnd = cleaned.indexOf("</think>");
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

  // 兼容模型偶尔在 JSON 之前/之后追加散文
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
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

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean).slice(0, limit);
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
    normalized[field] = cleanText(payload?.[field]);
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

// ============================================================
// DashScope 调用：单步硬超时 + 模型降级
// ============================================================
/**
 * 带模型降级的 DashScope OpenAI-compatible 调用。
 *
 * - 不再做时间叠加式重试。每次模型切换都是"一次性尝试"，
 *   单步总耗时严格控制在 timeoutMs * models.length 以内。
 * - thinking 模式默认关闭（enable_thinking=false），显著缩短响应。
 *
 * 失败语义：
 *   - 命中 isQuotaOrModelError → 自动尝试下一个模型
 *   - 其它错误（含超时、网络） → 直接抛出，由调用方决定降级
 *     （视觉/文本拆分调用，单步失败即整体 failed，避免链式雪崩）
 */
async function callDashscopeWithFallback(params: {
  apiKey: string;
  models: readonly string[];
  messages: any[];
  temperature: number;
  /** 控制是否打开 thinking。文本/视觉文案场景默认关闭。 */
  enableThinking?: boolean;
  /** 限制最大 tokens，避免长输出导致超时 */
  maxTokens?: number;
}): Promise<{ payload: any; modelUsed: string }> {
  const { apiKey, models, messages, temperature, enableThinking = false, maxTokens } = params;

  let lastError: unknown;
  for (const model of models) {
    try {
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
            // 阿里 DashScope OpenAI-compatible 通过 enable_thinking 关闭推理过程，
            // 大幅缩短响应时间。多语言营销文案对 thinking 收益有限，性价比不高。
            enable_thinking: enableThinking,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
          }),
        },
        DASHSCOPE_REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        const errText = await response.text();
        const errMsg = `${model} 调用失败 (HTTP ${response.status}): ${errText}`;
        if (isQuotaOrModelError(`${response.status} ${errText}`)) {
          console.warn(`[ai-understanding] 模型 ${model} 配额/不可用，尝试下一个：${errMsg}`);
          lastError = new Error(errMsg);
          continue;
        }
        throw new Error(errMsg);
      }

      const result = await response.json();
      const rawContent = result.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error(
          `${model} 返回内容为空。原始响应: ${JSON.stringify(result).slice(0, 500)}`,
        );
      }

      return { payload: parseAIJson(rawContent), modelUsed: model };
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (isQuotaOrModelError(msg)) {
        console.warn(`[ai-understanding] 模型 ${model} 命中配额/模型错误，尝试下一个：${msg}`);
        continue;
      }
      // 非配额错误：跳到下一个模型也尝试一次（含超时/网络故障）
      console.warn(`[ai-understanding] 模型 ${model} 其他错误，尝试下一个：${msg}`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`所有模型均失败：${String(lastError)}`);
}

// ============================================================
// 业务 prompt
// ============================================================
function buildSemanticFactsPrompt(params: {
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}) {
  const { name, desc, specs, material, price } = params;
  return `你是一名面向塔吉克斯坦电商业务的商品理解专家。请抽取一份"语言无关、可复用、可审计"的结构化商品事实，为后续生成塔吉克语和俄语用户文案提供统一依据。

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
2. 这是事实层，不要写营销文案，不要写多语言。
3. usage_steps、usage_tips、parameter_highlights 必须尽量具体。
4. local_context_signals 必须贴近塔吉克斯坦真实生活。
5. 信息不足时基于图片做谨慎推断，避免明显夸大。`;
}

async function generateSemanticFacts(params: {
  apiKey: string;
  imageUrls: string[];
  name: string;
  desc: string;
  specs: string;
  material: string;
  price: number;
}): Promise<{ semanticFacts: SemanticFacts; modelUsed: string }> {
  const { apiKey, imageUrls, name, desc, specs, material, price } = params;
  const prompt = buildSemanticFactsPrompt({ name, desc, specs, material, price });

  if (imageUrls.length > 0) {
    // 【关键性能优化】只用首图。多图收益边际递减，但耗时与 token 几乎线性增长。
    // 后台异步执行虽然不再受 150s 网关限制，但 60s/单步硬上限要求我们主动节流。
    const images = imageUrls.slice(0, 1);
    const content: any[] = images.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
    content.push({ type: "text", text: prompt });

    const { payload, modelUsed } = await callDashscopeWithFallback({
      apiKey,
      models: VISION_MODELS,
      messages: [{ role: "user", content }],
      temperature: 0.3,
      enableThinking: false,
      maxTokens: 2000,
    });
    return { semanticFacts: normalizeSemanticFacts(payload), modelUsed };
  }

  const { payload, modelUsed } = await callDashscopeWithFallback({
    apiKey,
    models: TEXT_MODELS,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    enableThinking: false,
    maxTokens: 1500,
  });
  return { semanticFacts: normalizeSemanticFacts(payload), modelUsed };
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
  const prompt = `你是一名服务于塔吉克斯坦电商平台的本地化商品文案专家。请基于结构化商品事实，一次性输出塔吉克语、俄语和中文三套商品理解文案。

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
  "tg": {"target_people":"","selling_angle":"","how_to_use":"","best_scene":"","local_life_connection":"","recommended_badge":""},
  "ru": {"target_people":"","selling_angle":"","how_to_use":"","best_scene":"","local_life_connection":"","recommended_badge":""},
  "zh": {"target_people":"","selling_angle":"","how_to_use":"","best_scene":"","local_life_connection":"","recommended_badge":""}
}

要求：
1. tg 必须自然地道，面向塔吉克普通消费者，不要夹杂中文，避免俄语硬翻译腔。
2. ru 必须自然可信，适合塔吉克斯坦电商用户阅读。
3. zh 仅用于后台辅助理解。
4. how_to_use 至少自然包含一种使用步骤、参数亮点或场景细节。
5. best_scene 必须是具体画面，不要抽象概括。
6. recommended_badge 短而顺口，适合做角标。
7. 只输出 JSON，不要附加说明。
8. 控制每个字段长度，单字段不超过 120 字。`;

  const { payload, modelUsed } = await callDashscopeWithFallback({
    apiKey: params.apiKey,
    models: TEXT_MODELS,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.35,
    enableThinking: false,
    maxTokens: 3500,
  });

  return {
    localized: {
      tg: normalizeSingleLanguageUnderstanding(payload?.tg),
      ru: normalizeSingleLanguageUnderstanding(payload?.ru),
      zh: normalizeSingleLanguageUnderstanding(payload?.zh),
    },
    modelUsed,
  };
}

// ============================================================
// Job 状态写入辅助
// ============================================================
async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
) {
  try {
    await supabase.from("ai_understanding_jobs").update(patch).eq("id", jobId);
  } catch (e) {
    console.error("[ai-understanding-generate] 写 job 状态失败:", e);
  }
}

// ============================================================
// 后台执行真实 LLM 链路
// ============================================================
async function runJob(
  supabase: SupabaseClient,
  jobId: string,
  productId: string,
  dashscopeApiKey: string,
) {
  const startedAt = new Date().toISOString();
  await updateJob(supabase, jobId, {
    status: "processing",
    stage: "loading_product",
    progress: 5,
    started_at: startedAt,
    error: null,
  });

  try {
    const { data: product, error: queryError } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("id", productId)
      .single();

    if (queryError || !product) {
      throw new Error(`商品不存在: ${queryError?.message || "未找到"}`);
    }

    const name =
      product.name_i18n?.ru || product.name_i18n?.zh || product.name || "Неизвестный товар";
    const desc =
      product.description_i18n?.ru ||
      product.description_i18n?.zh ||
      product.description ||
      "";
    const specs =
      product.specifications_i18n?.ru ||
      product.specifications_i18n?.zh ||
      product.specifications ||
      "";
    const material =
      product.material_i18n?.ru ||
      product.material_i18n?.zh ||
      product.material ||
      "";
    const price = Number(product.original_price) || 0;
    const imageUrls: string[] =
      product.image_urls || (product.image_url ? [product.image_url] : []);

    console.log(
      `[ai-understanding-generate#${jobId}] 开始: ${name} (${productId}), 图片数: ${imageUrls.length}`,
    );

    await updateJob(supabase, jobId, {
      stage: "semantic_facts",
      progress: 15,
    });

    const { semanticFacts, modelUsed: visionModel } = await generateSemanticFacts({
      apiKey: dashscopeApiKey,
      imageUrls,
      name,
      desc,
      specs,
      material,
      price,
    });

    console.log(
      `[ai-understanding-generate#${jobId}] semantic_facts 完成 (${visionModel})，开始三语文案`,
    );

    await updateJob(supabase, jobId, {
      stage: "localized_copy",
      progress: 55,
    });

    const { localized, modelUsed: textModel } = await generateUnifiedLocalizedUnderstanding({
      apiKey: dashscopeApiKey,
      semanticFacts,
      name,
      desc,
      specs,
      material,
      price,
    });

    const understandingData = buildLocalizedUnderstanding({
      tg: localized.tg,
      ru: localized.ru,
      zh: localized.zh,
      semanticFacts,
      generated_by: "ai-understanding-generate(async-v3)",
      model_used: `${visionModel} -> ${textModel}`,
    });

    await updateJob(supabase, jobId, {
      stage: "persisting",
      progress: 90,
    });

    const { error: updateError } = await supabase
      .from("inventory_products")
      .update({ ai_understanding: understandingData })
      .eq("id", productId);
    if (updateError) {
      throw new Error(`保存 inventory_products 失败: ${updateError.message}`);
    }

    // 同步关联抽奖
    try {
      await supabase
        .from("lotteries")
        .update({ ai_understanding: understandingData })
        .eq("inventory_product_id", productId);
    } catch (e) {
      console.warn(`[ai-understanding-generate#${jobId}] 同步 lotteries 失败（非致命）:`, e);
    }

    await updateJob(supabase, jobId, {
      status: "succeeded",
      stage: "done",
      progress: 100,
      result: understandingData,
      model_used: `${visionModel} -> ${textModel}`,
      finished_at: new Date().toISOString(),
    });

    console.log(`[ai-understanding-generate#${jobId}] 完成: ${name}`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ai-understanding-generate#${jobId}] 失败:`, errMsg);
    await updateJob(supabase, jobId, {
      status: "failed",
      error: errMsg.slice(0, 2000),
      finished_at: new Date().toISOString(),
    });
  }
}

// ============================================================
// HTTP 入口
// ============================================================
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sessionToken = req.headers.get("x-admin-session-token");
    if (!sessionToken) {
      return new Response(JSON.stringify({ error: "ADMIN_AUTH_REQUIRED" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const dashscopeApiKey = Deno.env.get("DASHSCOPE_API_KEY") || "";

    if (!dashscopeApiKey) {
      throw new Error("DASHSCOPE_API_KEY 环境变量未配置");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: adminId, error: authError } = await supabase.rpc("verify_admin_session", {
      p_session_token: sessionToken,
    });
    if (authError || !adminId) {
      return new Response(JSON.stringify({ error: "ADMIN_AUTH_FAILED" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { product_id, force_regenerate = false } = body || {};

    if (!product_id || typeof product_id !== "string") {
      return new Response(JSON.stringify({ error: "product_id 参数缺失或非法" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 校验商品 + 已存在数据快速返回
    const { data: product, error: queryError } = await supabase
      .from("inventory_products")
      .select("id, ai_understanding, image_urls, image_url, status")
      .eq("id", product_id)
      .single();

    if (queryError || !product) {
      return new Response(
        JSON.stringify({ error: `商品不存在: ${queryError?.message || "未找到"}` }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (product.ai_understanding && !force_regenerate) {
      // 兼容旧版调用方：直接返回已有数据，不创建任务
      return new Response(
        JSON.stringify({
          success: true,
          status: "succeeded",
          ai_understanding: product.ai_understanding,
          message: "该商品已有 AI 理解数据，如需重新生成请传 force_regenerate: true",
          skipped: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 复用近 2 分钟内还在 pending/processing 的同商品任务，避免重复触发
    const recentSinceIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: existingJobs } = await supabase
      .from("ai_understanding_jobs")
      .select("id, status, stage, progress, created_at")
      .eq("product_id", product_id)
      .in("status", ["pending", "processing"])
      .gte("created_at", recentSinceIso)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingJobs && existingJobs.length > 0) {
      const existing = existingJobs[0];
      return new Response(
        JSON.stringify({
          success: true,
          status: existing.status,
          job_id: existing.id,
          stage: existing.stage,
          progress: existing.progress,
          message: "已存在进行中的任务，复用之",
        }),
        {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 创建任务
    const { data: jobRow, error: jobErr } = await supabase
      .from("ai_understanding_jobs")
      .insert({
        product_id,
        status: "pending",
        force_regenerate: !!force_regenerate,
        stage: "queued",
        progress: 0,
        created_by: typeof adminId === "string" ? adminId : null,
      })
      .select("id")
      .single();

    if (jobErr || !jobRow?.id) {
      throw new Error(`创建任务失败: ${jobErr?.message || "未知错误"}`);
    }

    const jobId = jobRow.id;

    // 后台执行：waitUntil 不阻塞响应，且不受 150s 网关 idle timeout 影响
    // 其会让 worker 在响应返回后继续运行 runJob 直到完成。
    // 参考: https://supabase.com/docs/guides/functions/background-tasks
    // @ts-ignore - EdgeRuntime 是 Supabase Edge Runtime 注入的全局对象
    if (typeof EdgeRuntime !== "undefined" && typeof (EdgeRuntime as any).waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(runJob(supabase, jobId, product_id, dashscopeApiKey));
    } else {
      // 本地/不支持 waitUntil 时退化为不等待（fire-and-forget）。
      // 注意：这种 fallback 在生产 Supabase 环境通常不会触发。
      void runJob(supabase, jobId, product_id, dashscopeApiKey);
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: "pending",
        job_id: jobId,
        stage: "queued",
        progress: 0,
        poll_url: `/functions/v1/ai-understanding-job-status?job_id=${jobId}`,
        message: "AI 商品理解任务已派发，请通过 job_id 轮询状态",
      }),
      {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[ai-understanding-generate] 入口错误:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
