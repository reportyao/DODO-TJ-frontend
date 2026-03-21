import { supabase } from './supabase'

/**
 * 上传图片到Supabase Storage
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
        
        const compressedFile = await imageCompression(file, {
          maxSizeMB: 1, // 最大文件大小 1MB
          maxWidthOrHeight: 1920, // 最大分辨率 1920px
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
        cacheControl: '3600',
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
    // 提供更详细的错误信息
    if (error instanceof Error) {
      throw new Error(`Image upload failed: ${error.message}`)
    }
    throw new Error('Image upload failed: unknown error')
  }
}

/**
 * 上传多张图片
 * @param files 图片文件数组
 * @param compress 是否压缩
 * @param bucket 存储桶名称
 * @param folder 文件夹路径 (可选)
 * @returns 图片URL数组
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
  
  const results: string[] = []
  
  // 逐个上传而不是并行，以便更好地处理错误
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    console.log(`[uploadImages] Uploading file ${i + 1}/${files.length}:`, file.name)
    
    try {
      const url = await uploadImage(file, compress, bucket, folder)
      results.push(url)
    } catch (error) {
      console.error(`[uploadImages] Failed to upload file ${i + 1}:`, error)
      throw error
    }
  }
  
  console.log('[uploadImages] Batch upload complete:', results)
  return results
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
