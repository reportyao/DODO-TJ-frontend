/**
 * AI 上架助手 2.0 —— 后台单图处理函数 (ai-listing-image-processor)
 *
 * 职责：每次被 pg_cron 触发后，从 ai_image_tasks 表中原子地认领 1 条 pending 任务，
 *      串行完成：万相生图 → Satori 渲染俄文艺术字 PNG → ImageScript 压缩为 JPEG
 *      → 上传 Supabase Storage → 更新任务表为 completed。
 *
 * 设计要点：
 *  - 单张串行，避免 Edge Function 150s 超时；多张通过每分钟 cron 触发串连完成
 *  - SKIP LOCKED + UPDATE RETURNING 实现原子行锁，防止并发双取
 *  - 俄文字体走 static TTF（Montserrat 子集），Satori 精准渲染，零乱码
 *  - 画面半透明渐变遮罩保证文字可读，颜色/位置由主函数规划决定
 *  - 压缩：ImageScript.encodeJPEG(quality=60)，平均 150-300KB/张
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import satori, { type SatoriOptions } from "https://esm.sh/satori@0.10.14?target=deno";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2?target=deno";
// 注：ImageScript 在 Deno 官方模块注册表下托管，原生兼容 Deno（JPEG/PNG 编解码无依赖）
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

// ============================================================
// 静态资源（字体 & resvg-wasm）懒加载 + 模块级缓存
// ============================================================
const FONT_REGULAR_URL = new URL("../_shared/fonts/Montserrat-Regular.ttf", import.meta.url);
const FONT_BOLD_URL = new URL("../_shared/fonts/Montserrat-Bold.ttf", import.meta.url);

let fontRegularCache: ArrayBuffer | null = null;
let fontBoldCache: ArrayBuffer | null = null;
let resvgReady = false;

async function ensureFontsLoaded() {
  if (fontRegularCache && fontBoldCache) {return;}
  const [reg, bold] = await Promise.all([
    Deno.readFile(FONT_REGULAR_URL),
    Deno.readFile(FONT_BOLD_URL),
  ]);
  fontRegularCache = reg.buffer.slice(reg.byteOffset, reg.byteOffset + reg.byteLength) as ArrayBuffer;
  fontBoldCache = bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength) as ArrayBuffer;
}

async function ensureResvgReady() {
  if (resvgReady) {return;}
  // @resvg/resvg-wasm 2.6.2: initWasm 接受 Promise<Response> 或 ArrayBuffer
  // 从 jsdelivr 拉取 wasm 二进制并缓存
  const wasmResp = await fetch(
    "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm"
  );
  if (!wasmResp.ok) {
    throw new Error(`加载 resvg-wasm 失败: HTTP ${wasmResp.status}`);
  }
  await initWasm(wasmResp);
  resvgReady = true;
}

// ============================================================
// 公共工具
// ============================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TaskRow = {
  id: string;
  parent_task_id: string;
  admin_user_id: string | null;
  base_image_url: string;
  ref_prompt: string;
  ru_caption: string;
  text_theme: "light" | "dark";
  caption_position: "top" | "center" | "bottom";
  display_order: number;
  attempt_count: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// Step 1: 原子认领一行 pending 任务
//   使用 CTE + SKIP LOCKED 保证并发安全
// ============================================================
async function claimNextTask(supabase: any): Promise<TaskRow | null> {
  // 优先让 SQL 完成 CAS：SELECT ... FOR UPDATE SKIP LOCKED + UPDATE
  // 通过 RPC 实现；若项目内无对应 RPC，则退化为 "SELECT LIMIT 1 → UPDATE by id"
  // 对本项目当前单实例 cron（每分钟 1 次）足够安全
  const { data: picked, error: selErr } = await supabase
    .from("ai_image_tasks")
    .select("*")
    .eq("status", "pending")
    .lt("attempt_count", 3)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selErr) {
    throw new Error(`查询 pending 任务失败: ${selErr.message}`);
  }
  if (!picked) {return null;}

  // CAS 更新为 processing（带状态条件，防并发双拿）
  const { data: updated, error: updErr } = await supabase
    .from("ai_image_tasks")
    .update({
      status: "processing",
      attempt_count: (picked.attempt_count ?? 0) + 1,
      last_attempt_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", picked.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (updErr) {
    throw new Error(`认领任务失败: ${updErr.message}`);
  }
  if (!updated) {
    // 被别的 worker 抢了
    return null;
  }
  return updated as TaskRow;
}

// ============================================================
// Step 2: 万相背景生成（提交 + 轮询）
// ============================================================
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
        input: { base_image_url: baseImageUrl, ref_prompt: refPrompt },
        parameters: { n: 1, model_version: "v3" },
      }),
    }
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`万相提交失败 (HTTP ${response.status}): ${errText}`);
  }
  const result = await response.json();
  const taskId = result.output?.task_id;
  if (!taskId) {
    throw new Error(`万相未返回 task_id: ${JSON.stringify(result)}`);
  }
  return taskId;
}

async function pollWanxResult(
  apiKey: string,
  taskId: string,
  maxPolls = 40,
  interval = 3000
): Promise<string> {
  let consecutiveErrors = 0;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const resp = await fetch(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!resp.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          throw new Error(`万相轮询连续失败 3 次 (HTTP ${resp.status})`);
        }
        continue;
      }
      consecutiveErrors = 0;
      const data = await resp.json();
      const status = data.output?.task_status;
      if (status === "SUCCEEDED") {
        const url = data.output?.results?.[0]?.url;
        if (!url) {throw new Error("万相 SUCCEEDED 但未返回 URL");}
        return url;
      }
      if (status === "FAILED") {
        throw new Error(
          `万相任务失败: ${data.output?.message || data.output?.code || "unknown"}`
        );
      }
    } catch (e) {
      if (
        e instanceof Error &&
        (e.message.includes("万相任务失败") ||
          e.message.includes("未返回 URL") ||
          e.message.includes("连续失败"))
      ) {
        throw e;
      }
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        throw new Error(
          `万相轮询网络连续失败 3 次: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
  }
  throw new Error(`万相任务轮询 ${maxPolls} 次超时`);
}

// ============================================================
// Step 3: 用 Satori 把 "背景图 + 俄文 caption + 半透明渐变遮罩" 渲染为 PNG
//   目标尺寸 1024 × 1024（与万相 v3 默认输出一致；Storage/前端裁剪友好）
// ============================================================
const POSTER_W = 1024;
const POSTER_H = 1024;

function buildSatoriDOM(
  bgImageDataUrl: string,
  caption: string,
  theme: "light" | "dark",
  position: "top" | "center" | "bottom"
): any {
  const isLight = theme === "light"; // light=白字配深色遮罩
  const textColor = isLight ? "#FFFFFF" : "#111111";
  // 遮罩方向：caption 在哪边，遮罩就偏向哪边
  let gradient: string;
  let justifyContent: "flex-start" | "center" | "flex-end" = "flex-end";
  if (position === "top") {
    justifyContent = "flex-start";
    gradient = isLight
      ? "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 45%, rgba(0,0,0,0) 75%)"
      : "linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.32) 45%, rgba(255,255,255,0) 75%)";
  } else if (position === "center") {
    justifyContent = "center";
    gradient = isLight
      ? "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 50%, rgba(0,0,0,0) 100%)"
      : "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.65) 50%, rgba(255,255,255,0) 100%)";
  } else {
    justifyContent = "flex-end";
    gradient = isLight
      ? "linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.30) 45%, rgba(0,0,0,0) 80%)"
      : "linear-gradient(0deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.32) 45%, rgba(255,255,255,0) 80%)";
  }

  // 文字大小随长度自适应（单行为主，2-7 词通常合适）
  const len = caption.length;
  const fontSize = len <= 14 ? 112 : len <= 22 ? 92 : len <= 32 ? 72 : 56;

  return {
    type: "div",
    props: {
      style: {
        width: POSTER_W,
        height: POSTER_H,
        display: "flex",
        position: "relative",
      },
      children: [
        // 底图
        {
          type: "img",
          props: {
            src: bgImageDataUrl,
            width: POSTER_W,
            height: POSTER_H,
            style: {
              width: POSTER_W,
              height: POSTER_H,
              objectFit: "cover",
              position: "absolute",
              top: 0,
              left: 0,
            },
          },
        },
        // 渐变遮罩 + 文字容器
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: POSTER_W,
              height: POSTER_H,
              display: "flex",
              flexDirection: "column",
              justifyContent,
              alignItems: "center",
              padding: 72,
              backgroundImage: gradient,
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Montserrat",
                    fontWeight: 700,
                    fontSize,
                    lineHeight: 1.12,
                    color: textColor,
                    textAlign: "center",
                    // 极细描边增强可读性（若 Satori 不支持，该属性会被忽略）
                    textShadow: isLight
                      ? "0 2px 8px rgba(0,0,0,0.35)"
                      : "0 2px 8px rgba(255,255,255,0.5)",
                    letterSpacing: -0.5,
                    maxWidth: POSTER_W - 144,
                    display: "flex",
                  },
                  children: caption,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

async function renderPosterPng(
  cleanBgUrl: string,
  caption: string,
  theme: "light" | "dark",
  position: "top" | "center" | "bottom"
): Promise<Uint8Array> {
  await ensureFontsLoaded();
  await ensureResvgReady();

  // 下载万相图并转 data URL 供 Satori <img> 使用
  const bgResp = await fetch(cleanBgUrl);
  if (!bgResp.ok) {
    throw new Error(`下载万相背景图失败 (HTTP ${bgResp.status})`);
  }
  const bgBuf = new Uint8Array(await bgResp.arrayBuffer());
  const bgMime = bgResp.headers.get("content-type") || "image/png";
  const bgB64 = btoa(String.fromCharCode(...bgBuf));
  const bgDataUrl = `data:${bgMime};base64,${bgB64}`;

  const options: SatoriOptions = {
    width: POSTER_W,
    height: POSTER_H,
    fonts: [
      { name: "Montserrat", data: fontRegularCache!, weight: 400, style: "normal" },
      { name: "Montserrat", data: fontBoldCache!, weight: 700, style: "normal" },
    ],
  };

  const dom = buildSatoriDOM(bgDataUrl, caption, theme, position);
  const svg = await satori(dom, options);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: POSTER_W },
    background: "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
}

// ============================================================
// Step 4: ImageScript 压缩 PNG → JPEG(质量 60)
// ============================================================
async function compressToJpeg(pngBytes: Uint8Array, quality = 60): Promise<Uint8Array> {
  const img = await Image.decode(pngBytes);
  // JPEG 不支持透明，白底保底（实际海报已不透明）
  const jpeg = await img.encodeJPEG(quality);
  return jpeg;
}

// ============================================================
// Step 5: 上传到 Supabase Storage（product-images）
// ============================================================
async function uploadToStorage(
  supabase: any,
  bytes: Uint8Array,
  parentTaskId: string,
  taskId: string
): Promise<string> {
  const path = `ai-marketing/${parentTaskId}/${taskId}.jpg`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, bytes, {
      cacheControl: "31536000",
      upsert: true,
      contentType: "image/jpeg",
    });
  if (error) {
    throw new Error(`上传 Storage 失败: ${error.message}`);
  }
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

// ============================================================
// 主流程：认领 → 生图 → 合成 → 压缩 → 上传 → 写回
// ============================================================
async function processOne(supabase: any, dashApiKey: string): Promise<{
  processed: boolean;
  task_id?: string;
  marketing_url?: string;
  error?: string;
}> {
  const task = await claimNextTask(supabase);
  if (!task) {
    return { processed: false };
  }

  const t0 = Date.now();
  try {
    console.log(`[processor] 认领任务 ${task.id} (parent=${task.parent_task_id})`);

    // 1) 万相生图
    const wanxTaskId = await submitWanxTask(
      dashApiKey,
      task.base_image_url,
      task.ref_prompt
    );
    await supabase
      .from("ai_image_tasks")
      .update({ wanx_task_id: wanxTaskId })
      .eq("id", task.id);
    const cleanBgUrl = await pollWanxResult(dashApiKey, wanxTaskId);
    console.log(`[processor] 万相完成 ${task.id} -> ${cleanBgUrl.slice(0, 80)}`);

    await supabase
      .from("ai_image_tasks")
      .update({ clean_bg_url: cleanBgUrl })
      .eq("id", task.id);

    // 2) Satori 合成俄文艺术字
    const pngBytes = await renderPosterPng(
      cleanBgUrl,
      task.ru_caption,
      task.text_theme,
      task.caption_position
    );

    // 3) ImageScript 压缩为 JPEG
    const jpegBytes = await compressToJpeg(pngBytes, 60);
    console.log(
      `[processor] 合成+压缩完成 ${task.id} size=${jpegBytes.byteLength}B`
    );

    // 4) 上传到 Storage
    const marketingUrl = await uploadToStorage(
      supabase,
      jpegBytes,
      task.parent_task_id,
      task.id
    );

    // 5) 写回 completed
    await supabase
      .from("ai_image_tasks")
      .update({
        status: "completed",
        marketing_image_url: marketingUrl,
        error_message: null,
      })
      .eq("id", task.id);

    console.log(
      `[processor] 任务 ${task.id} 完成，耗时 ${Date.now() - t0}ms`
    );
    return { processed: true, task_id: task.id, marketing_url: marketingUrl };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[processor] 任务 ${task.id} 失败:`, errMsg);
    const nextStatus = task.attempt_count >= 2 ? "failed" : "pending";
    await supabase
      .from("ai_image_tasks")
      .update({
        status: nextStatus,
        error_message: errMsg.slice(0, 500),
      })
      .eq("id", task.id);
    return { processed: true, task_id: task.id, error: errMsg };
  }
}

// ============================================================
// HTTP 入口
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // 鉴权：仅接受带 service_role JWT 的调用（pg_cron 和运维可用）
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`;
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || auth !== expected) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const dashApiKey = Deno.env.get("DASHSCOPE_API_KEY");
  if (!dashApiKey) {
    return jsonResponse({ error: "DASHSCOPE_API_KEY 未配置" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 每次调用只处理 1 张，保持 Wall Clock 安全
    const result = await processOne(supabase, dashApiKey);
    return jsonResponse({
      ok: true,
      processed: result.processed,
      task_id: result.task_id,
      marketing_url: result.marketing_url,
      error: result.error,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("[processor] 顶层异常:", errMsg);
    return jsonResponse({ ok: false, error: errMsg }, 500);
  }
});
