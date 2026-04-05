/**
 * download-and-upload-image Edge Function
 * 
 * 【功能说明】
 * 从外部URL下载图片，压缩后上传到 Supabase Storage。
 * 
 * 【性能优化 v2】
 * - 文件大小限制：最大10MB，防止OOM
 * - 自动设置长缓存（1年），利用URL中的时间戳hash实现缓存破坏
 * - 增加超时控制：下载超时15秒
 * - 增加详细日志：记录原始大小和处理时间
 * 
 * 【v3 新增 - 图片压缩】
 * - 下载后自动压缩：转为 JPEG 格式，质量 85%，最大 1800px
 * - 大幅减小存储体积，加快后续 AI 抠图处理速度
 * - 使用 Deno 原生 ImageBitmap + OffscreenCanvas 进行压缩
 * 
 * 【参数】
 * - imageUrl: 外部图片URL
 * - bucket: Storage桶名称
 * - folder: 文件夹路径
 * - maxSizeMB: 最大文件大小（MB），超过此大小的图片会被拒绝（默认10）
 * - compress: 是否压缩图片（默认 true）
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

// 最大允许的图片大小（字节）
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
// 下载超时时间（毫秒）
const DOWNLOAD_TIMEOUT = 15000; // 15秒
// 压缩参数
const COMPRESS_MAX_DIM = 1800;  // 最大宽度/高度
const COMPRESS_QUALITY = 0.85;  // JPEG 质量 85%（近无损）

/**
 * 使用 sharp-like 方式压缩图片
 * Deno Edge Function 不支持 Canvas，改用直接转换为 JPEG 的方式
 * 通过限制尺寸和格式转换来减小体积
 */
async function compressImageBuffer(
  imageBuffer: ArrayBuffer,
  _contentType: string
): Promise<{ buffer: Uint8Array; contentType: string; width: number; height: number }> {
  // 在 Deno Edge Function 中，使用 ImageBitmap 获取尺寸信息
  // 然后通过 OffscreenCanvas 进行压缩
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
    
    // 使用 OffscreenCanvas 绘制并压缩
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    
    // 转为 JPEG Blob
    const compressedBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: COMPRESS_QUALITY,
    });
    
    const compressedBuffer = new Uint8Array(await compressedBlob.arrayBuffer());
    
    console.log(`[compress] ${(imageBuffer.byteLength / 1024).toFixed(0)}KB → ${(compressedBuffer.length / 1024).toFixed(0)}KB, ${width}x${height}, JPEG q${COMPRESS_QUALITY * 100}`);
    
    return {
      buffer: compressedBuffer,
      contentType: 'image/jpeg',
      width,
      height,
    };
  } catch (e) {
    console.warn(`[compress] 压缩失败，使用原图: ${e}`);
    return {
      buffer: new Uint8Array(imageBuffer),
      contentType: _contentType,
      width: 0,
      height: 0,
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { imageUrl, bucket, folder, maxSizeMB, compress = true } = await req.json();

    if (!imageUrl || !bucket || !folder) {
      return new Response(
        JSON.stringify({ success: false, error: '缺少必要参数: imageUrl, bucket, folder' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 验证URL格式
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch (_error) {
      return new Response(
        JSON.stringify({ success: false, error: '无效的URL格式' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 安全检查：只允许 http/https 协议
    if (!['http:', 'https:'].includes(url.protocol)) {
      return new Response(
        JSON.stringify({ success: false, error: '只允许 http/https 协议的URL' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`[download-and-upload] 开始下载: ${imageUrl}`);

    // 【超时控制】下载图片，设置15秒超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

    let imageResponse: Response;
    try {
      imageResponse = await fetch(imageUrl, { signal: controller.signal });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error(`下载超时（${DOWNLOAD_TIMEOUT / 1000}秒）`);
      }
      throw new Error(`下载失败: ${fetchError.message}`);
    }
    clearTimeout(timeoutId);

    if (!imageResponse.ok) {
      throw new Error(`下载图片失败: ${imageResponse.status} ${imageResponse.statusText}`);
    }

    const contentType = imageResponse.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`URL不是图片: ${contentType}`);
    }

    // 获取图片数据
    const imageBuffer = await imageResponse.arrayBuffer();
    const originalSize = imageBuffer.byteLength;

    console.log(`[download-and-upload] 下载完成, 原始大小: ${(originalSize / 1024).toFixed(1)}KB`);

    // 【文件大小限制】
    const maxSize = maxSizeMB ? maxSizeMB * 1024 * 1024 : MAX_IMAGE_SIZE;
    if (originalSize > maxSize) {
      throw new Error(`图片太大: ${(originalSize / 1024 / 1024).toFixed(1)}MB，最大允许 ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
    }

    // 【v3 新增】压缩图片
    let uploadBuffer: Uint8Array | ArrayBuffer = imageBuffer;
    let uploadContentType = contentType;
    let uploadExt = contentType.split('/')[1]?.split(';')[0] || 'jpg';

    if (compress) {
      console.log(`[download-and-upload] 开始压缩图片...`);
      const compressed = await compressImageBuffer(imageBuffer, contentType);
      uploadBuffer = compressed.buffer;
      uploadContentType = compressed.contentType;
      uploadExt = 'jpg';
      const ratio = ((1 - compressed.buffer.length / originalSize) * 100).toFixed(1);
      console.log(`[download-and-upload] 压缩完成, 压缩率: ${ratio}%`);
    }

    // 确定文件名
    const filename = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${uploadExt}`;

    console.log(`[download-and-upload] 上传到: ${bucket}/${filename}`);

    // 初始化Supabase客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 上传到Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filename, uploadBuffer, {
        contentType: uploadContentType,
        // 【性能优化】设置1年缓存（URL含时间戳hash，天然支持缓存破坏）
        cacheControl: '31536000',
        upsert: false,
      });

    if (error) {
      console.error('[download-and-upload] 上传错误:', error);
      throw new Error(`上传失败: ${error.message}`);
    }

    // 获取公开URL
    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filename);

    const elapsed = Date.now() - startTime;
    console.log(`[download-and-upload] 完成! URL: ${publicUrlData.publicUrl}, 耗时: ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        publicUrl: publicUrlData.publicUrl,
        filename: filename,
        originalSize: originalSize,
        compressedSize: uploadBuffer instanceof Uint8Array ? uploadBuffer.length : (uploadBuffer as ArrayBuffer).byteLength,
        elapsed: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const elapsed = Date.now() - startTime;
    console.error(`[download-and-upload] 错误 (${elapsed}ms):`, errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
