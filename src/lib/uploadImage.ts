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
    console.log('[uploadImage] Starting upload:', { 
      fileName: file.name, 
      fileSize: file.size, 
      fileType: file.type,
      compress,
      bucket,
      folder 
    })

    let fileToUpload = file
    let contentType = file.type || 'application/octet-stream'
    let fileExt = file.name.split('.').pop() || 'jpg'
    let fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

    // 尝试压缩图片（如果启用且是图片类型）
    if (compress && file.type.startsWith('image/')) {
      try {
        console.log('[uploadImage] Attempting image compression...')
        
        // 动态导入 browser-image-compression 以避免加载失败
        const imageCompression = (await import('browser-image-compression')).default
        
        // 【弱网自适应】根据网络状态调整压缩参数
        const networkQuality = getNetworkQuality()
        const maxSizeMB = networkQuality === 'slow' ? 0.5 : 1  // 弱网时压缩到0.5MB
        const maxDimension = networkQuality === 'slow' ? 1280 : 1920  // 弱网时降低分辨率
        
        console.log('[uploadImage] Network quality:', networkQuality, 
          '| maxSizeMB:', maxSizeMB, '| maxDimension:', maxDimension)
        
        const compressedFile = await imageCompression(file, {
          maxSizeMB,
          maxWidthOrHeight: maxDimension,
          useWebWorker: true,
          fileType: 'image/webp', // 转换为 WebP 格式
        })

        fileToUpload = compressedFile
        contentType = 'image/webp'
        fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.webp`
        
        console.log('[uploadImage] Compression successful:', {
          originalSize: file.size,
          compressedSize: compressedFile.size,
          compressionRatio: ((1 - compressedFile.size / file.size) * 100).toFixed(1) + '%'
        })
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
    console.log('[uploadImage] Uploading to path:', filePath)

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

    console.log('[uploadImage] Upload successful:', uploadData)

    // 获取公开URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath)

    console.log('[uploadImage] Public URL:', publicUrl)
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
  console.log('[uploadImages] Starting batch upload:', { 
    fileCount: files.length, 
    compress, 
    bucket, 
    folder 
  })
  
  // 【并发上传】所有图片同时开始上传
  const uploadPromises = files.map((file, i) => {
    console.log(`[uploadImages] Queuing file ${i + 1}/${files.length}:`, file.name)
    return uploadImage(file, compress, bucket, folder)
  })

  try {
    const results = await Promise.all(uploadPromises)
    console.log('[uploadImages] Batch upload complete:', results)
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

    console.log('[deleteImage] Deleting:', { url, bucket, filePath })

    const { error } = await supabase.storage
      .from(bucket)
      .remove([filePath])

    if (error) {
      throw error
    }
    
    console.log('[deleteImage] Delete successful')
  } catch (error) {
    console.error('[deleteImage] Failed:', error)
    throw new Error('Image delete failed')
  }
}
