import { supabase } from './supabase'

/**
 * 图片上传工具模块
 * 
 * 【性能优化】
 * - 压缩转WebP：减少60-80%文件大小
 * - 弱网自适应：根据网络状态调整压缩参数
 * - 并发上传：多张图片并发处理（而非串行）
 * - 长缓存：cacheControl 设为1年（图片URL含hash，天然支持缓存破坏）
 */

let compressionModulePromise: Promise<typeof import('browser-image-compression')> | null = null

function loadCompressionModule() {
  if (!compressionModulePromise) {
    compressionModulePromise = import('browser-image-compression')
  }
  return compressionModulePromise
}

export function prewarmImageCompression(): void {
  if (typeof window === 'undefined') {return}

  const warmup = () => {
    void loadCompressionModule().catch(() => {
      compressionModulePromise = null
    })
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warmup, { timeout: 1200 })
    return
  }

  globalThis.setTimeout(warmup, 300)
}

/** 获取当前网络状态，用于自适应压缩参数 */
function getNetworkQuality(): 'fast' | 'slow' {
  const connection = (navigator as any).connection || 
    (navigator as any).mozConnection || 
    (navigator as any).webkitConnection;
  
  if (connection) {
    const type = connection.effectiveType;
    if (type === '2g' || type === 'slow-2g' || type === '3g') {
      return 'slow';
    }
  }
  return 'fast';
}

/**
 * 上传单张图片到 Supabase Storage
 * 
 * @param file 图片文件
 * @param compress 是否压缩（默认true）
 * @param bucket 存储桶名称
 * @param folder 文件夹路径 (可选)
 * @returns 图片的公开URL
 */
export async function uploadImage(
  file: File,
  compress: boolean = true,
  bucket: string = 'payment-proofs',
  folder?: string
): Promise<string> {
  try {

    let fileToUpload = file
    let contentType = file.type || 'application/octet-stream'
    const fileExt = file.name.split('.').pop() || 'jpg'
    let fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

    const shouldCompress =
      compress &&
      file.type.startsWith('image/') &&
      file.size > 250 * 1024 &&
      !file.type.includes('webp')

    // 尝试压缩图片（如果启用且是图片类型）
    if (shouldCompress) {
      try {
        
        // 动态导入 browser-image-compression 以避免加载失败
        const imageCompression = (await loadCompressionModule()).default
        
        // 【弱网自适应】根据网络状态调整压缩参数
        const networkQuality = getNetworkQuality()
        const maxSizeMB = networkQuality === 'slow' ? 0.5 : 1  // 弱网时压缩到0.5MB
        const maxDimension = networkQuality === 'slow' ? 1280 : 1920  // 弱网时降低分辨率
        
        const compressedFile = await imageCompression(file, {
          maxSizeMB,
          maxWidthOrHeight: maxDimension,
          useWebWorker: true,
          fileType: 'image/webp', // 转换为 WebP 格式
        })

        fileToUpload = compressedFile
        contentType = 'image/webp'
        fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.webp`
        
      } catch (compressionError) {
        // 压缩失败时，使用原始文件
        console.warn('[uploadImage] Compression failed, using original file:', compressionError)
        fileToUpload = file
        contentType = file.type || 'image/jpeg'
        fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
      }
    }

    // 生成唯一文件路径
    const filePath = folder ? `${folder}/${fileName}` : fileName

    // 上传文件
    const { error: uploadError, data: uploadData } = await supabase.storage
      .from(bucket)
      .upload(filePath, fileToUpload, {
        // 【性能优化】设置为1年缓存（图片URL含时间戳hash，天然支持缓存破坏）
        cacheControl: '31536000',
        upsert: false,
        contentType: contentType,
      })

    if (uploadError) {
      console.error('[uploadImage] Upload error:', uploadError)
      throw uploadError
    }

    // 获取公开URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath)

    return publicUrl
  } catch (error) {
    console.error('[uploadImage] Failed:', error)
    if (error instanceof Error) {
      throw new Error(`Image upload failed: ${error.message}`)
    }
    throw new Error('Image upload failed: unknown error')
  }
}

/**
 * 上传多张图片（并发处理）
 * 
 * 【性能优化】使用 Promise.all 并发上传，而非串行逐个上传
 * 3张图片的上传时间从 ~9秒 降低到 ~3秒（假设单张3秒）
 * 
 * @param files 图片文件数组
 * @param compress 是否压缩
 * @param bucket 存储桶名称
 * @param folder 文件夹路径 (可选)
 * @returns 图片URL数组（顺序与输入一致）
 */
export async function uploadImages(
  files: File[],
  compress: boolean = true,
  bucket: string = 'payment-proofs',
  folder?: string
): Promise<string[]> {
  
  // 【并发上传】所有图片同时开始上传
  const uploadPromises = files.map((file, i) => {
    return uploadImage(file, compress, bucket, folder)
  })

  try {
    const results = await Promise.all(uploadPromises)
    return results
  } catch (error) {
    console.error('[uploadImages] Batch upload failed:', error)
    throw error
  }
}

/**
 * 删除图片
 * @param url 图片URL
 * @param bucket 存储桶名称
 */
export async function deleteImage(url: string, bucket: string = 'payment-proofs'): Promise<void> {
  try {
    // 从URL提取文件路径
    const urlParts = url.split('/')
    const bucketIndex = urlParts.indexOf(bucket)
    if (bucketIndex === -1) {
      throw new Error('Invalid URL: bucket not found')
    }
    const filePath = urlParts.slice(bucketIndex + 1).join('/')

    const { error } = await supabase.storage
      .from(bucket)
      .remove([filePath])

    if (error) {
      throw error
    }
    
  } catch (error) {
    console.error('[deleteImage] Failed:', error)
    throw new Error('Image delete failed')
  }
}
