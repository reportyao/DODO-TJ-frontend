/**
 * AI 商品理解任务状态查询 — Edge Function
 *
 * 配合 ai-understanding-generate(异步派发版 v3.0) 使用。
 * 前端在派发任务后通过 job_id 轮询本接口获取实时状态。
 *
 * 设计：
 *   - 使用 service_role 客户端读取 ai_understanding_jobs（受 RLS 保护）
 *   - 校验 admin session token，避免任意客户端枚举他人任务
 *   - 返回精简字段（不下发完整 result，避免无谓带宽）
 *
 * 请求：
 *   GET  /functions/v1/ai-understanding-job-status?job_id=<uuid>
 *   POST /functions/v1/ai-understanding-job-status   { job_id: <uuid> }
 *
 * 认证：x-admin-session-token → verify_admin_session RPC
 *
 * 响应：
 *   {
 *     success: true,
 *     job: {
 *       id, product_id, status, stage, progress,
 *       error, model_used, started_at, finished_at, created_at, updated_at
 *     },
 *     ai_understanding?: jsonb   // 仅在 status=succeeded 时返回
 *   }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: adminId, error: authError } = await supabase.rpc(
      "verify_admin_session",
      { p_session_token: sessionToken },
    );
    if (authError || !adminId) {
      return new Response(JSON.stringify({ error: "ADMIN_AUTH_FAILED" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let jobId: string | undefined;
    if (req.method === "GET") {
      jobId = new URL(req.url).searchParams.get("job_id") || undefined;
    } else {
      const body = await req.json().catch(() => ({}));
      jobId = (body as any)?.job_id;
    }

    if (!jobId || typeof jobId !== "string") {
      return new Response(JSON.stringify({ error: "job_id 参数缺失或非法" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: jobErr } = await supabase
      .from("ai_understanding_jobs")
      .select(
        "id, product_id, status, stage, progress, error, model_used, started_at, finished_at, created_at, updated_at, result",
      )
      .eq("id", jobId)
      .single();

    if (jobErr || !job) {
      return new Response(
        JSON.stringify({ error: `任务不存在: ${jobErr?.message || "not found"}` }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const responseBody: Record<string, unknown> = {
      success: true,
      job: {
        id: job.id,
        product_id: job.product_id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        error: job.error,
        model_used: job.model_used,
        started_at: job.started_at,
        finished_at: job.finished_at,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
    };

    if (job.status === "succeeded" && job.result) {
      responseBody.ai_understanding = job.result;
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[ai-understanding-job-status] 错误:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
