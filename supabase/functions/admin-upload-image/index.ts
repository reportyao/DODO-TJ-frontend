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
 * 
 * [v3 极限压缩优化]
 *   - 服务端接收图片后进行二次压缩（WebP 格式，质量 72%，最大 1200px）
 *   - 即使前端已压缩，服务端再次确保极限压缩，双重保障
 *   - 对于已经足够小的图片（<100KB）或 GIF/SVG 跳过压缩
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
  "topics",
  "inventory-products",
  "wholesaler-stores",
];
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

// 压缩配置
const COMPRESS_MAX_DIM = 1200;    // 最大宽度/高度 1200px
const COMPRESS_QUALITY = 0.72;    // WebP 质量 72%（极限压缩，视觉质量依然优秀）
const COMPRESS_SKIP_SIZE = 100 * 1024; // 小于 100KB 的图片跳过压缩

/**
 * 服务端图片压缩：使用 OffscreenCanvas 将图片压缩为 WebP 格式
 */
async function compressImageServer(
  imageBuffer: ArrayBuffer,
  contentType: string
): Promise<{ buffer: Uint8Array; contentType: string; compressed: boolean }> {
  // GIF 和 SVG 不压缩（保留动画/矢量特性）
  if (contentType === "image/gif" || contentType === "image/svg+xml") {
    return { buffer: new Uint8Array(imageBuffer), contentType, compressed: false };
  }

  // 小于阈值的图片跳过压缩
  if (imageBuffer.byteLength <= COMPRESS_SKIP_SIZE) {
    return { buffer: new Uint8Array(imageBuffer), contentType, compressed: false };
  }

  try {
    const blob = new Blob([imageBuffer]);
    const bitmap = await createImageBitmap(blob);
    
    let { width, height } = bitmap;
    
    // 等比缩放到最大尺寸
    if (width > COMPRESS_MAX_DIM || height > COMPRESS_MAX_DIM) {
      const ratio = Math.min(COMPRESS_MAX_DIM / width, COMPRESS_MAX_DIM / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    
    // 使用 OffscreenCanvas 绘制并压缩为 WebP
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    
    const compressedBlob = await canvas.convertToBlob({
      type: "image/webp",
      quality: COMPRESS_QUALITY,
    });
    
    const compressedBuffer = new Uint8Array(await compressedBlob.arrayBuffer());
    
    // 只有压缩后更小才使用压缩版本
    if (compressedBuffer.length < imageBuffer.byteLength) {
      const ratio = ((1 - compressedBuffer.length / imageBuffer.byteLength) * 100).toFixed(1);
      console.log(`[admin-upload-image] 压缩: ${(imageBuffer.byteLength / 1024).toFixed(0)}KB → ${(compressedBuffer.length / 1024).toFixed(0)}KB (${ratio}% 减小, ${width}x${height}, WebP q${COMPRESS_QUALITY * 100})`);
      return { buffer: compressedBuffer, contentType: "image/webp", compressed: true };
    }
    
    // 压缩后反而更大，使用原图
    console.log(`[admin-upload-image] 压缩后更大，保留原图 (${(imageBuffer.byteLength / 1024).toFixed(0)}KB)`);
    return { buffer: new Uint8Array(imageBuffer), contentType, compressed: false };
  } catch (e) {
    console.warn(`[admin-upload-image] 压缩失败，使用原图: ${e}`);
    return { buffer: new Uint8Array(imageBuffer), contentType, compressed: false };
  }
}

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

    // 获取原始文件数据
    const originalBuffer = await file.arrayBuffer();
    const originalSize = originalBuffer.byteLength;

    // [v3] 服务端极限压缩
    const { buffer: uploadBuffer, contentType: finalContentType, compressed } = 
      await compressImageServer(originalBuffer, file.type);

    // 根据最终内容类型确定扩展名
    const ext = finalContentType === "image/webp" ? "webp" 
      : finalContentType === "image/png" ? "png" 
      : finalContentType === "image/gif" ? "gif"
      : finalContentType === "image/svg+xml" ? "svg"
      : "jpg";
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    // 使用 service_role 上传
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, uploadBuffer, {
        cacheControl: "31536000",
        upsert: false,
        contentType: finalContentType,
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

    // 记录审计日志（含压缩信息）
    await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      action: "upload_image",
      details: { 
        bucket, 
        path: filePath, 
        originalSize,
        finalSize: uploadBuffer.length,
        compressed,
        type: finalContentType,
        compressionRatio: compressed ? `${((1 - uploadBuffer.length / originalSize) * 100).toFixed(1)}%` : 'N/A',
      },
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
