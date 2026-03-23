import React, { useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CameraIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import { uploadImage } from '../lib/uploadImage'
import toast from 'react-hot-toast'

/**
 * 头像上传组件
 * 
 * 统一的头像选择、压缩、上传逻辑，供注册页和个人资料编辑页复用。
 * 
 * 特性：
 * - 图片压缩（browser-image-compression，转 WebP）
 * - 弱网自适应压缩参数
 * - 头像专用压缩参数（最大 512px，0.3MB）
 * - 上传到 Supabase Storage（payment-proofs/avatars/）
 * - 圆形预览 + 相机图标
 */

interface AvatarUploadProps {
  /** 当前头像 URL（已有头像时显示） */
  currentAvatarUrl?: string | null
  /** 用户名首字母（无头像时的占位符） */
  fallbackInitial?: string
  /** 头像尺寸（px），默认 96 */
  size?: number
  /** 上传成功后的回调，返回新的头像 URL */
  onUploadSuccess: (url: string) => void
  /** 上传中状态变化回调 */
  onUploadingChange?: (uploading: boolean) => void
  /** 是否禁用上传 */
  disabled?: boolean
}

const AvatarUpload: React.FC<AvatarUploadProps> = ({
  currentAvatarUrl,
  fallbackInitial = 'U',
  size = 96,
  onUploadSuccess,
  onUploadingChange,
  disabled = false,
}) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imgLoadError, setImgLoadError] = useState(false)

  // 显示的头像 URL：优先本地预览 > 当前头像
  const displayUrl = previewUrl || currentAvatarUrl

  const handleClick = useCallback(() => {
    if (disabled || isUploading) return
    fileInputRef.current?.click()
  }, [disabled, isUploading])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 重置 input value，允许重复选择同一文件
    e.target.value = ''

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      toast.error(t('deposit.invalidFileType') || '请选择图片文件')
      return
    }

    // 验证文件大小（原始文件不超过 20MB）
    if (file.size > 20 * 1024 * 1024) {
      toast.error(t('profile.avatarTooLarge') || '图片文件过大，请选择小于20MB的图片')
      return
    }

    // 立即显示本地预览
    const localPreview = URL.createObjectURL(file)
    setPreviewUrl(localPreview)
    setImgLoadError(false)

    // 开始上传
    setIsUploading(true)
    onUploadingChange?.(true)

    try {
      console.log('[AvatarUpload] Starting avatar upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      })

      // 使用统一的 uploadImage 函数（内部已包含压缩和 WebP 转换）
      // 头像上传到 payment-proofs bucket 的 avatars 文件夹
      const publicUrl = await uploadImage(file, true, 'payment-proofs', 'avatars')

      console.log('[AvatarUpload] Upload successful:', publicUrl)
      onUploadSuccess(publicUrl)
      toast.success(t('deposit.uploadSuccess') || '上传成功')
    } catch (error) {
      console.error('[AvatarUpload] Upload failed:', error)
      // 上传失败，恢复原头像
      setPreviewUrl(null)
      const errorMessage = error instanceof Error ? error.message : String(error)
      toast.error(`${t('deposit.uploadFailed') || '上传失败'}：${errorMessage}`)
    } finally {
      setIsUploading(false)
      onUploadingChange?.(false)
      // 清理本地预览 URL
      URL.revokeObjectURL(localPreview)
    }
  }, [onUploadSuccess, onUploadingChange, t])

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative cursor-pointer group"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label={t('profile.changeAvatar') || '更换头像'}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      >
        {/* 头像图片或占位符 */}
        {displayUrl && !imgLoadError ? (
          <img
            src={displayUrl}
            alt="Avatar"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              borderRadius: '9999px',
              border: '4px solid #f3f4f6',
              objectFit: 'cover',
              maxWidth: 'none',
            }}
            onError={() => {
              console.error('[AvatarUpload] Image load failed:', displayUrl)
              setImgLoadError(true)
            }}
          />
        ) : (
          <div
            className="bg-gradient-to-r from-primary to-primary-dark rounded-full flex items-center justify-center"
            style={{ width: `${size}px`, height: `${size}px` }}
          >
            <UserCircleIcon className="text-white" style={{ width: `${size * 0.67}px`, height: `${size * 0.67}px` }} />
          </div>
        )}

        {/* 上传中遮罩 */}
        {isUploading && (
          <div
            className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center"
            style={{ width: `${size}px`, height: `${size}px` }}
          >
            <svg className="animate-spin text-white" style={{ width: `${size * 0.3}px`, height: `${size * 0.3}px` }} viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {/* 相机图标按钮 */}
        {!isUploading && (
          <div className="absolute bottom-0 right-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg group-hover:bg-primary-dark transition-colors">
            <CameraIcon className="w-4 h-4 text-white" />
          </div>
        )}
      </div>

      {/* 提示文字 */}
      <p className="text-sm text-gray-500 mt-3">
        {isUploading
          ? (t('deposit.compressing') || '压缩中...')
          : (t('profile.tapToChangeAvatar') || '点击更换头像')
        }
      </p>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || isUploading}
      />
    </div>
  )
}

export default AvatarUpload
