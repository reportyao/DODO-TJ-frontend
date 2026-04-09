/**
 * AI 专题生成助手 — Edge Function
 *
 * 核心后端逻辑，串联两层 AI 调用，通过 SSE 流式返回进度和结果。
 *
 * 执行链路（两层架构）：
 *   Step A: 商品理解层 (qwen-plus)
 *     → 分析选中商品在塔吉克本地生活中的使用场景、目标人群、生活锚点、风险点
 *   Step B: 内容表达层 (qwen-plus)
 *     → 基于理解层结果 + 运营输入，生成三语专题草稿（标题、副标题、导语、正文块、
 *       卡片文案变体、商品场景说明）
 *
 * 认证：x-admin-session-token → verify_admin_session RPC
 * 响应：SSE (text/event-stream)
 *
 * SSE 事件格式（与 ai-listing-generate 保持一致）：
 *   data: {"status":"processing","progress":N,"stage":"..."}
 *   data: {"status":"done","progress":100,"result":{...}}
 *   data: {"status":"error","error":"..."}
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
// 工具函数
// ============================================================

/** 带指数退避的重试包装器 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
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

/** 解析 AI 返回的 JSON（可能被 markdown 代码块包裹） */
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

/** 空话黑名单检测 */
const BANNED_PHRASES = [
  "高品质", "甄选", "满足多元需求", "品质生活", "尊享体验",
  "提升幸福感", "优选好物", "匠心之选", "品质之选", "臻选",
  "轻奢", "赋能", "高端大气", "引领潮流", "满足多样需求",
  "为品质生活提供更多可能", "开启美好生活",
];

function detectBannedPhrases(text: string): string[] {
  const found: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (text.includes(phrase)) {
      found.push(phrase);
    }
  }
  return found;
}

/** 检查三语文本完整性 */
function checkI18nCompleteness(
  obj: Record<string, string> | null | undefined,
  languages: string[]
): string[] {
  const missing: string[] = [];
  if (!obj) return languages;
  for (const lang of languages) {
    if (!obj[lang] || obj[lang].trim().length === 0) {
      missing.push(lang);
    }
  }
  return missing;
}

// ============================================================
// Step A: 商品理解层 (qwen-plus)
// ============================================================

async function runProductUnderstanding(
  apiKey: string,
  products: any[],
  topicGoal: string,
  coreScene: string[],
  targetAudience: string[],
  localContextHints: string[],
  lexiconEntries: any[]
): Promise<any> {
  // 构建商品信息摘要
  const productSummaries = products.map((p, i) => {
    const name = p.name_i18n?.zh || p.name_i18n?.ru || p.name || "未知商品";
    const desc = p.description_i18n?.zh || p.description_i18n?.ru || "";
    const categories = (p.categories || []).map((c: any) => c.name_i18n?.zh || c.code).join("、");
    const tags = (p.tags || []).map((t: any) => t.name_i18n?.zh || t.code).join("、");
    const price = p.original_price || p.active_lottery?.ticket_price || "未知";
    return `商品${i + 1}: ${name}\n  描述: ${desc}\n  分类: ${categories || "无"}\n  标签: ${tags || "无"}\n  价格: ${price} сомони`;
  }).join("\n\n");

  // 构建词库参考
  const lexiconRef = lexiconEntries.length > 0
    ? lexiconEntries.map((e: any) => {
        const title = e.title_i18n?.zh || e.code;
        const content = e.content_i18n?.zh || "";
        const good = e.example_good || "";
        const bad = e.example_bad || "";
        const anchors = (e.local_anchors || []).join("、");
        return `[${e.lexicon_group}] ${title}: ${content}${good ? `\n  好例子: ${good}` : ""}${bad ? `\n  坏例子: ${bad}` : ""}${anchors ? `\n  本地锚点: ${anchors}` : ""}`;
      }).join("\n")
    : "暂无词库条目";

  const prompt = `你是一名深入了解塔吉克斯坦本地生活的商品分析师。你的任务不是写广告文案，而是分析以下商品在塔吉克本地日常生活中最真实、最自然的使用情境。

【专题目标】
${topicGoal}

【核心场景】
${coreScene.join("、") || "未指定"}

【目标人群】
${targetAudience.join("、") || "未指定"}

【选中商品】
${productSummaries}

【本地化词库参考】
${lexiconRef}

${localContextHints.length > 0 ? `【本地生活提示】\n运营提供的本地化关键词：${localContextHints.join("、")}\n请在分析中优先考虑这些本地生活场景和习惯。\n` : ""}
请对每个商品进行深度理解分析，并输出以下 JSON 结构：
{
  "overall_theme": "这组商品整体适合什么样的生活主题（一句话）",
  "story_angle": "推荐的叙事角度（例如：冬天回家晚了，想快点吃上热饭）",
  "local_anchors_used": ["实际引用的本地生活锚点1", "锚点2", "锚点3"],
  "risk_notes": ["需要注意的风险点，如某商品不适合该场景", "可能的文化敏感点"],
  "products_analysis": [
    {
      "product_id": "商品ID",
      "product_name": "商品名称",
      "best_scene": "这个商品在本次专题场景中最自然的使用画面（具体到动作和场景）",
      "target_people": "最适合的人群描述",
      "local_life_connection": "与塔吉克本地生活的真实连接点",
      "selling_angle": "不是卖点，而是'为什么这个人在这个场景下会觉得这个东西好用'",
      "recommended_badge": "推荐的商品角标文案（如：做饭省心、待客体面、冬天必备）"
    }
  ],
  "recommended_topic_type": "story|collection|seasonal|gift_guide",
  "recommended_card_style": "story_card|image_card|minimal_card"
}

要求：
1. "best_scene" 必须是具体的生活画面，不能是抽象描述
2. "local_life_connection" 必须引用真实的塔吉克生活习惯
3. 不要使用"高品质""甄选""品质生活"等空泛营销词
4. 请只输出 JSON，不要添加任何其他文字说明`;

  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`商品理解层调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("商品理解层返回内容为空");
  }

  return parseAIJson(rawContent);
}

// ============================================================
// Step B: 内容表达层 (qwen-plus)
// ============================================================

async function runContentGeneration(
  apiKey: string,
  understanding: any,
  topicGoal: string,
  manualNotes: string,
  toneConstraints: string[],
  outputLanguages: string[],
  localContextHints: string[],
  lexiconEntries: any[],
  selectedProducts: any[] = []
): Promise<any> {
  // 构建语气约束
  const toneRef = toneConstraints.length > 0
    ? `【语气约束】\n不要出现以下风格：${toneConstraints.join("、")}`
    : "";

  // 构建好例子/坏例子参考
  const styleExamples = lexiconEntries
    .filter((e: any) => e.example_good || e.example_bad)
    .map((e: any) => {
      let ref = `[${e.lexicon_group}]`;
      if (e.example_good) ref += `\n  好例子: ${e.example_good}`;
      if (e.example_bad) ref += `\n  坏例子: ${e.example_bad}`;
      if (e.tone_notes) ref += `\n  口吻要求: ${e.tone_notes}`;
      return ref;
    }).join("\n");

  const langInstruction = outputLanguages.includes("tg")
    ? "必须同时输出中文(zh)、俄语(ru)和塔吉克语(tg)三个语种。俄语和塔吉克语不是中文的逐句直译，而是基于同一个生活场景做本地化改写，让当地人读起来自然、亲切。"
    : "必须同时输出中文(zh)和俄语(ru)两个语种。俄语不是中文的逐句直译，而是基于同一个生活场景做本地化改写。";

  const prompt = `你不是广告文案生成器，而是本地生活内容编辑。你的任务是先理解商品在塔吉克本地生活中最真实、最自然的使用情境，再用家常、人话、能让人代入的方式写出专题草稿。你不能堆砌"高品质、优选、满足多样需求、尊享、甄选"等空泛营销套话。你必须优先使用真实的家庭、待客、做饭、送礼、节庆、邻里往来等生活画面来解释商品价值。

【专题目标】
${topicGoal}

【商品理解层分析结果】
${JSON.stringify(understanding, null, 2)}

${manualNotes ? `【运营补充说明】\n${manualNotes}` : ""}

${localContextHints.length > 0 ? `【本地生活提示】\n运营提供的本地化关键词：${localContextHints.join("、")}\n请在内容中自然融入这些本地生活元素。` : ""}

${toneRef}

${styleExamples ? `【文案风格参考】\n${styleExamples}` : ""}

【语言要求】
${langInstruction}

请基于以上信息，生成完整的专题草稿，输出以下 JSON 结构：
{
  "title_i18n": {"zh": "中文标题（15-25字，像朋友推荐，不像广告标题）", "ru": "俄语标题", "tg": "塔吉克语标题"},
  "subtitle_i18n": {"zh": "中文副标题（一句话点明场景）", "ru": "俄语副标题", "tg": "塔吉克语副标题"},
  "intro_i18n": {"zh": "中文导语（2-3句，描绘一个具体的生活画面，让人代入）", "ru": "俄语导语", "tg": "塔吉克语导语"},
  "story_blocks_i18n": [
    {
      "block_key": "block_1",
      "block_type": "paragraph",
      "zh": "中文正文段落（围绕一个生活场景展开，自然引入商品）",
      "ru": "俄语正文段落（本地化改写，不是直译）",
      "tg": "塔吉克语正文段落"
    },
    {
      "block_key": "block_2",
      "block_type": "paragraph",
      "zh": "第二段（可以换一个场景或角度）",
      "ru": "俄语第二段",
      "tg": "塔吉克语第二段"
    }
  ],
  "placement_variants": [
    {
      "variant_name": "首页主推位",
      "title_i18n": {"zh": "卡片标题（8-15字，吸引点击）", "ru": "俄语卡片标题", "tg": "塔吉克语卡片标题"},
      "subtitle_i18n": {"zh": "卡片副标题", "ru": "俄语卡片副标题", "tg": "塔吉克语卡片副标题"},
      "angle": "这个卡片变体的切入角度"
    },
    {
      "variant_name": "分类页推荐位",
      "title_i18n": {"zh": "另一个角度的卡片标题", "ru": "俄语", "tg": "塔吉克语"},
      "subtitle_i18n": {"zh": "副标题", "ru": "俄语", "tg": "塔吉克语"},
      "angle": "切入角度"
    }
  ],
  "product_notes": [
    // ❗❗ 必须为下方列出的每一个商品都生成一条 product_note，不可省略任何商品
    {
      "product_id": "商品ID",
      "note_i18n": {"zh": "这个商品在本专题中的场景说明（1-2句）", "ru": "俄语", "tg": "塔吉克语"},
      "badge_text_i18n": {"zh": "角标文案（2-4字）", "ru": "俄语角标", "tg": "塔吉克语角标"}
    }
  ],
  "recommended_category_ids": [],
  "recommended_tag_ids": []
}

要求：
1. 标题和导语必须像"熟人推荐"，不能像"品牌宣传册"
2. 正文段落要有具体的生活画面，不能只是抽象描述商品功能
3. 俄语和塔吉克语必须做本地化改写，不是中文的逐句翻译
4. 卡片变体至少 2 个，从不同角度吸引点击
5. ❗❗ product_notes 必须包含下方列出的每一个商品，不可省略任何一个，每个商品的 note 必须说明"这个商品在这个场景下为什么好用"
6. 请只输出 JSON，不要添加任何其他文字说明

【必须生成 product_note 的商品列表】
${selectedProducts.map((p: any, i: number) => {
  const name = p.name_i18n?.zh || p.name_i18n?.ru || p.name || '未知商品';
  return `商品${i + 1}: ID=${p.id}, 名称=${name}`;
}).join('\n')}
❗❗ 以上 ${selectedProducts.length} 个商品必须全部出现在 product_notes 数组中，不可省略。`;

  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`内容表达层调用失败 (HTTP ${response.status}): ${errText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("内容表达层返回内容为空");
  }

  return parseAIJson(rawContent);
}

// ============================================================
// 主处理函数
// ============================================================

serve(async (req: Request) => {
  // CORS 预检
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 只接受 POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── 创建 SSE 流 ─────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendSSE = async (data: any) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // 客户端已断开
    }
  };

  // 异步执行主逻辑
  (async () => {
    try {
      // ─── 1. 认证 ──────────────────────────────────────────
      await sendSSE({ status: "processing", progress: 5, stage: "正在验证管理员身份..." });

      const sessionToken = req.headers.get("x-admin-session-token");
      if (!sessionToken) {
        await sendSSE({ status: "error", error: "ADMIN_AUTH_REQUIRED: 缺少管理员认证" });
        await writer.close();
        return;
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const dashscopeApiKey = Deno.env.get("DASHSCOPE_API_KEY") || "";

      if (!dashscopeApiKey) {
        await sendSSE({ status: "error", error: "服务端未配置 AI API Key" });
        await writer.close();
        return;
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // 验证管理员 session
      const { data: sessionData, error: sessionError } = await supabase.rpc(
        "verify_admin_session",
        { p_session_token: sessionToken }
      );

      if (sessionError || !sessionData) {
        await sendSSE({ status: "error", error: "ADMIN_AUTH_FAILED: 管理员认证失败" });
        await writer.close();
        return;
      }

      // [v5 修复] verify_admin_session RPC 返回值可能是：
      //   - UUID 字符串 (直接返回 admin_id)
      //   - JSON 字符串 (需要 parse 后取 admin_id)
      //   - 对象 (直接取 admin_id)
      let adminId: string | undefined;
      if (typeof sessionData === "string") {
        // 尝试 JSON.parse，如果失败则直接当作 admin_id (UUID)
        try {
          const parsed = JSON.parse(sessionData);
          adminId = parsed?.admin_id || sessionData;
        } catch {
          // sessionData 本身就是 admin_id (UUID 字符串)
          adminId = sessionData;
        }
      } else if (sessionData && typeof sessionData === "object") {
        adminId = sessionData.admin_id;
      } else {
        adminId = String(sessionData);
      }

      // ─── 2. 解析请求 ─────────────────────────────────────
      await sendSSE({ status: "processing", progress: 10, stage: "正在解析请求参数..." });

      const body = await req.json();
      const {
        topic_goal,
        target_audience = [],
        core_scene = [],
        local_context_hints = [],
        selected_products = [],
        manual_notes = "",
        tone_constraints = [],
        output_languages = ["zh", "ru", "tg"],
      } = body;

      if (!topic_goal || topic_goal.trim().length === 0) {
        await sendSSE({ status: "error", error: "请输入专题目标" });
        await writer.close();
        return;
      }

      if (selected_products.length === 0) {
        await sendSSE({ status: "error", error: "请至少选择一个商品" });
        await writer.close();
        return;
      }

      // ─── 3. 创建任务记录 ──────────────────────────────────
      await sendSSE({ status: "processing", progress: 15, stage: "正在创建生成任务..." });

      const { data: taskData, error: taskError } = await supabase
        .from("ai_topic_generation_tasks")
        .insert({
          status: "processing",
          request_payload: body,
          created_by: adminId,
        })
        .select("id")
        .single();

      const taskId = taskData?.id;
      if (taskError) {
        console.error("[ai-topic-generate] 创建任务记录失败:", taskError);
        // 不阻断，继续生成
      }

      // ─── 4. 加载词库数据 ──────────────────────────────────
      // [v4 修复] 创建任务记录后，所有 processing 事件都携带 task_id
      await sendSSE({ status: "processing", progress: 20, stage: "正在加载本地化词库...", task_id: taskId });

      let lexiconEntries: any[] = [];
      try {
        const { data: lexData } = await supabase
          .from("localization_lexicon")
          .select("*")
          .eq("is_active", true)
          .order("lexicon_group")
          .order("sort_order");
        lexiconEntries = lexData || [];
      } catch (e) {
        console.error("[ai-topic-generate] 加载词库失败:", e);
        // 不阻断，词库为空也可以继续
      }

      // ─── 5. Step A: 商品理解层 ────────────────────────────
      await sendSSE({ status: "processing", progress: 25, stage: "AI 正在分析商品与本地生活场景的关系...", task_id: taskId });

      let understanding: any;
      try {
        understanding = await withRetry(
          () => runProductUnderstanding(
            dashscopeApiKey,
            selected_products,
            topic_goal,
            core_scene,
            target_audience,
            local_context_hints,
            lexiconEntries
          ),
          2,
          2000
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[ai-topic-generate] 商品理解层失败:", errMsg);
        await sendSSE({ status: "error", progress: 0, error: `商品理解层失败: ${errMsg}` });

        // 更新任务记录
        if (taskId) {
          await supabase
            .from("ai_topic_generation_tasks")
            .update({ status: "error", error_message: errMsg, completed_at: new Date().toISOString() })
            .eq("id", taskId);
        }

        await writer.close();
        return;
      }

      await sendSSE({
        status: "processing",
        progress: 50,
        stage: `商品理解完成：${understanding.story_angle || "已分析"} — 正在生成三语专题草稿...`,
        task_id: taskId,
      });

      // ─── 6. Step B: 内容表达层 ────────────────────────────
      let contentResult: any;
      try {
        contentResult = await withRetry(
          () => runContentGeneration(
            dashscopeApiKey,
            understanding,
            topic_goal,
            manual_notes,
            tone_constraints,
            output_languages,
            local_context_hints,
            lexiconEntries,
            selected_products
          ),
          2,
          2000
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[ai-topic-generate] 内容表达层失败:", errMsg);

        // 如果内容层失败但理解层成功，返回 partial 结果
        const partialResult = {
          understanding,
          title_i18n: null,
          subtitle_i18n: null,
          intro_i18n: null,
          story_blocks_i18n: [],
          placement_variants: [],
          product_notes: [],
          recommended_category_ids: [],
          recommended_tag_ids: [],
          explanation: {
            local_anchors: understanding.local_anchors_used || [],
            selected_story_angle: understanding.story_angle || "",
            risk_notes: understanding.risk_notes || [],
          },
          quality_warnings: [`内容表达层生成失败: ${errMsg}`],
        };

        if (taskId) {
          await supabase
            .from("ai_topic_generation_tasks")
            .update({
              status: "partial",
              result_payload: partialResult,
              error_message: errMsg,
              completed_at: new Date().toISOString(),
            })
            .eq("id", taskId);
        }

        await sendSSE({
          status: "partial",
          progress: 100,
          stage: "部分完成（仅商品理解，文案生成失败）",
          result: partialResult,
        });
        await writer.close();
        return;
      }

      // ─── 7. 质量校验 ─────────────────────────────────────
      await sendSSE({ status: "processing", progress: 85, stage: "正在进行质量校验...", task_id: taskId });

      const qualityWarnings: string[] = [];
      let finalStatus: "done" | "partial" = "done";

      // 检查标题完整性
      const titleMissing = checkI18nCompleteness(contentResult.title_i18n, output_languages);
      if (titleMissing.length > 0) {
        qualityWarnings.push(`标题缺少以下语种: ${titleMissing.join(", ")}`);
        finalStatus = "partial";
      }

      // 检查副标题完整性
      const subtitleMissing = checkI18nCompleteness(contentResult.subtitle_i18n, output_languages);
      if (subtitleMissing.length > 0) {
        qualityWarnings.push(`副标题缺少以下语种: ${subtitleMissing.join(", ")}`);
      }

      // 检查导语完整性
      const introMissing = checkI18nCompleteness(contentResult.intro_i18n, output_languages);
      if (introMissing.length > 0) {
        qualityWarnings.push(`导语缺少以下语种: ${introMissing.join(", ")}`);
      }

      // 检查正文块
      if (!contentResult.story_blocks_i18n || contentResult.story_blocks_i18n.length === 0) {
        qualityWarnings.push("正文块为空");
        finalStatus = "partial";
      }

      // 检查空话黑名单
      const allText = [
        contentResult.title_i18n?.zh || "",
        contentResult.subtitle_i18n?.zh || "",
        contentResult.intro_i18n?.zh || "",
        ...(contentResult.story_blocks_i18n || []).map((b: any) => b.zh || ""),
      ].join(" ");

      const bannedFound = detectBannedPhrases(allText);
      if (bannedFound.length > 0) {
        qualityWarnings.push(`检测到空泛营销套话: ${bannedFound.join("、")}`);
      }

      // 检查本地锚点
      if (!understanding.local_anchors_used || understanding.local_anchors_used.length === 0) {
        qualityWarnings.push("未输出本地生活锚点，内容可能缺乏本地化深度");
      }

      // [v7 修复] 检查 product_notes 是否覆盖所有选中商品
      const productNotes = contentResult.product_notes || [];
      const noteProductIds = new Set(productNotes.map((n: any) => n.product_id));
      const missingProducts = selected_products.filter((p: any) => !noteProductIds.has(p.id));
      if (missingProducts.length > 0) {
        qualityWarnings.push(
          `商品说明缺少 ${missingProducts.length} 个商品: ${missingProducts.map((p: any) => p.name_i18n?.zh || p.name || p.id).join('、')}`
        );
        // 为缺少的商品生成占位 product_note，确保前端显示完整
        for (const mp of missingProducts) {
          const name = mp.name_i18n?.zh || mp.name || '未知商品';
          productNotes.push({
            product_id: mp.id,
            note_i18n: {
              zh: `${name}（AI 未生成说明，请手动编辑）`,
              ru: `${mp.name_i18n?.ru || name}（описание не сгенерировано）`,
              tg: `${mp.name_i18n?.tg || name}（тавсиф тавлид нашудааст）`,
            },
            badge_text_i18n: { zh: '待编辑', ru: 'Ред.', tg: 'Таҳрир' },
          });
        }
        contentResult.product_notes = productNotes;
      }

      // ─── 8. 组装最终结果 ──────────────────────────────────
      await sendSSE({ status: "processing", progress: 90, stage: "正在组装最终结果...", task_id: taskId });

      const finalResult = {
        // 理解层结果
        understanding: {
          overall_theme: understanding.overall_theme,
          story_angle: understanding.story_angle,
          local_anchors_used: understanding.local_anchors_used || [],
          risk_notes: understanding.risk_notes || [],
          products_analysis: understanding.products_analysis || [],
          recommended_topic_type: understanding.recommended_topic_type || "story",
          recommended_card_style: understanding.recommended_card_style || "story_card",
        },
        // 内容表达层结果
        title_i18n: contentResult.title_i18n || {},
        subtitle_i18n: contentResult.subtitle_i18n || {},
        intro_i18n: contentResult.intro_i18n || {},
        story_blocks_i18n: contentResult.story_blocks_i18n || [],
        placement_variants: contentResult.placement_variants || [],
        product_notes: contentResult.product_notes || [],
        recommended_category_ids: contentResult.recommended_category_ids || [],
        recommended_tag_ids: contentResult.recommended_tag_ids || [],
        // 质量元数据
        explanation: {
          local_anchors: understanding.local_anchors_used || [],
          selected_story_angle: understanding.story_angle || "",
          risk_notes: understanding.risk_notes || [],
        },
        quality_warnings: qualityWarnings,
      };

      // ─── 9. 更新任务记录 ──────────────────────────────────
      if (taskId) {
        try {
          await supabase
            .from("ai_topic_generation_tasks")
            .update({
              status: finalStatus,
              result_payload: finalResult,
              completed_at: new Date().toISOString(),
            })
            .eq("id", taskId);
        } catch (e) {
          console.error("[ai-topic-generate] 更新任务记录失败:", e);
        }
      }

      // ─── 10. 返回最终结果 ─────────────────────────────────
      await sendSSE({
        status: finalStatus,
        progress: 100,
        stage: finalStatus === "done" ? "全部完成" : "部分完成（请检查质量警告）",
        result: finalResult,
        task_id: taskId,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[ai-topic-generate] 未预期错误:", errMsg);
      await sendSSE({ status: "error", progress: 0, error: errMsg });
    } finally {
      try {
        await writer.close();
      } catch {
        // 已关闭
      }
    }
  })();

  // 立即返回 SSE 流
  return new Response(stream.readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
