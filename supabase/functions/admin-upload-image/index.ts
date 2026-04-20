/**
 * 管理后台图片上传 Edge Function
 * 
 * 替代前端直接使用 service_role_key 上传图片的方式。
 * 管理员通过 session_token 认证后，由服务端使用 service_role 权限上传。
 * 
 * [v2 修复]
 *   - 添加文件大小限制（10MB）
 *   - 添加 bucket 白名单校验
 *   - 添加文件类型白名单校验
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 安全配置
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_BUCKETS = [
  "lottery-images",
  "payment-proofs",
  "banners",
  "showoff-images",
  "avatars",
  "product-images",
  "topics",  // v2: 专题封面图上传
];
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 验证管理员 session
    const sessionToken = req.headers.get("x-admin-session-token");
    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: "缺少管理员认证信息" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: adminId, error: authError } = await supabase.rpc(
      "verify_admin_session",
      { p_session_token: sessionToken }
    );

    if (authError || !adminId) {
      return new Response(
        JSON.stringify({ error: "管理员认证失败" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 解析 multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const bucket = (formData.get("bucket") as string) || "lottery-images";
    const folder = formData.get("folder") as string | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "缺少上传文件" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // [修复 E1] 文件大小限制
    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: `文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // [修复 E2] Bucket 白名单校验
    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return new Response(
        JSON.stringify({ error: `不允许上传到 bucket: ${bucket}` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // [修复 E3] 文件类型白名单校验
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: `不支持的文件类型: ${file.type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 生成唯一文件名
    const ext = file.type === "image/webp" ? "webp" 
      : file.type === "image/png" ? "png" 
      : file.type === "image/gif" ? "gif"
      : file.type === "image/svg+xml" ? "svg"
      : "jpg";
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    // 使用 service_role 上传
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, arrayBuffer, {
        cacheControl: "31536000",
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      return new Response(
        JSON.stringify({ error: `上传失败: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 获取公开 URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    // 记录审计日志
    await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      action: "upload_image",
      details: { bucket, path: filePath, size: file.size, type: file.type },
    }).then(() => {}).catch(() => {}); // 不阻塞主流程

    return new Response(
      JSON.stringify({ url: publicUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || "服务器错误" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
