import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import {
  LockClosedIcon,
  UserIcon,
  TicketIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'
import PhoneInput from '../components/ui/PhoneInput'
import toast from 'react-hot-toast'
import AvatarUpload from '../components/AvatarUpload'
import { supabase } from '../lib/supabase'

const RegisterPage: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { registerWithPhone } = useUser()

  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)

  // 从 URL 参数中获取邀请码
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) {
      setReferralCode(ref)
    }
  }, [searchParams])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!phoneNumber.trim()) {
      toast.error(t('auth.phoneRequired'))
      return
    }
    if (!password) {
      toast.error(t('auth.passwordRequired'))
      return
    }
    if (password.length < 6) {
      toast.error(t('auth.passwordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      toast.error(t('auth.passwordMismatch'))
      return
    }
    if (isUploadingAvatar) {
      toast.error(t('profile.waitForAvatarUpload') || '请等待头像上传完成')
      return
    }

    setIsLoading(true)
    try {
      // 使用 UserContext 的 registerWithPhone，它会自动处理 session 存储和状态更新
      await registerWithPhone(
        phoneNumber.trim(),
        password,
        firstName.trim() || undefined,
        referralCode.trim() || undefined
      )

      // 注册成功后，如果有头像，更新到 users 表
      if (avatarUrl) {
        try {
          const storedUser = localStorage.getItem('custom_user')
          if (storedUser) {
            const parsedUser = JSON.parse(storedUser)
            const { error: updateError } = await supabase
              .from('users')
              .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
              .eq('id', parsedUser.id)

            if (updateError) {
              console.error('[RegisterPage] Failed to save avatar:', updateError)
            } else {
              // 更新本地缓存
              parsedUser.avatar_url = avatarUrl
              localStorage.setItem('custom_user', JSON.stringify(parsedUser))
              console.log('[RegisterPage] Avatar saved successfully')
            }
          }
        } catch (avatarError) {
          console.error('[RegisterPage] Avatar save error:', avatarError)
          // 头像保存失败不阻断注册流程
        }
      }

      // 注册成功后跳转（UserContext 已处理 toast 和状态）
      navigate('/', { replace: true })
    } catch (error: any) {
      console.error('Registration failed:', error)
      toast.error(error.message || t('auth.registerFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-6">
          <picture>
            <source srcSet="/dodo-logo.webp" type="image/webp" />
            <img 
              src="/dodo-logo.png" 
              alt="DODO Logo"
              className="w-24 h-24 mx-auto mb-3 drop-shadow-lg"
              style={{ objectFit: 'contain' }}
            />
          </picture>
          <h1 className="text-2xl font-bold text-gray-900">DODO</h1>
          <p className="text-gray-500 mt-1">{t('auth.registerSubtitle')}</p>
        </div>

        {/* Register Form */}
        <form onSubmit={handleRegister} className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
          {/* Avatar Upload */}
          <div className="pb-2">
            <AvatarUpload
              currentAvatarUrl={avatarUrl}
              fallbackInitial={firstName?.[0] || 'U'}
              size={80}
              onUploadSuccess={(url) => setAvatarUrl(url)}
              onUploadingChange={(uploading) => setIsUploadingAvatar(uploading)}
              disabled={isLoading}
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('auth.phoneNumber')} <span className="text-red-500">*</span>
            </label>
            <PhoneInput
              value={phoneNumber}
              onChange={setPhoneNumber}
              autoComplete="tel"
              required
            />
          </div>

          {/* Name (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('auth.firstName')}
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={t('auth.firstNamePlaceholder')}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                autoComplete="given-name"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('auth.password')} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('auth.confirmPassword')} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('auth.confirmPasswordPlaceholder')}
                className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showConfirmPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Referral Code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('auth.referralCode')}
              {!searchParams.get('ref') && (
                <span className="text-gray-400 ml-1 text-xs">({t('common.optional')})</span>
              )}
            </label>
            <div className="relative">
              <TicketIcon className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${searchParams.get('ref') ? 'text-green-500' : 'text-gray-400'}`} />
              <input
                type="text"
                value={referralCode}
                onChange={(e) => !searchParams.get('ref') && setReferralCode(e.target.value.toUpperCase())}
                placeholder={t('auth.referralCodePlaceholder')}
                className={`w-full pl-10 pr-4 py-3 border rounded-xl transition-all text-gray-900 placeholder-gray-400 uppercase ${
                  searchParams.get('ref')
                    ? 'border-green-300 bg-green-50 text-green-800 cursor-not-allowed'
                    : 'border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent'
                }`}
                readOnly={!!searchParams.get('ref')}
              />
            </div>
            {searchParams.get('ref') && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <span>✓</span>
                <span>{t('auth.referralCodeApplied')}</span>
              </p>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || isUploadingAvatar}
            className="w-full py-3 bg-gradient-to-r from-primary to-primary-dark text-white font-semibold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-2"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('common.loading')}
              </span>
            ) : (
              t('auth.register')
            )}
          </button>
        </form>

        {/* Login Link */}
        <p className="text-center mt-6 text-gray-600">
          {t('auth.hasAccount')}{' '}
          <Link
            to="/login"
            className="text-primary hover:text-primary-dark font-semibold"
          >
            {t('auth.loginNow')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default RegisterPage
