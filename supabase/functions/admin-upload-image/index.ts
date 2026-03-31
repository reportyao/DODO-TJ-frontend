/**
 * 管理后台图片上传 Edge Function
 * 
 * 替代前端直接使用 service_role_key 上传图片的方式。
 * 管理员通过 session_token 认证后，由服务端使用 service_role 权限上传。
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // 生成唯一文件名
    const ext = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";
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
