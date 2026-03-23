import React, { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import {
  LockClosedIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import PhoneInput from '../components/ui/PhoneInput'

const LoginPage: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { loginWithPhone } = useUser()

  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!phoneNumber.trim()) {
      toast.error(t('auth.phoneRequired'))
      return
    }
    if (!password) {
      toast.error(t('auth.passwordRequired'))
      return
    }

    setIsLoading(true)
    try {
      // 使用 UserContext 的 loginWithPhone，它会自动处理 session 存储和状态更新
      await loginWithPhone(phoneNumber.trim(), password)

      // 登录成功后跳转（UserContext 已处理 toast 和状态）
      // 安全校验：只允许内部路径跳转，防止开放重定向攻击
      const rawRedirect = searchParams.get('redirect') || '/'
      const redirectTo = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'
      navigate(redirectTo, { replace: true })
    } catch (error: any) {
      console.error('Login failed:', error)
      if (error.message?.includes('PASSWORD_NOT_SET')) {
        toast.error(t('auth.passwordNotSet'))
      } else {
        toast.error(error.message || t('auth.loginFailed'))
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
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
          <p className="text-gray-500 mt-1">{t('auth.loginSubtitle')}</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          {/* Phone Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('auth.phoneNumber')}
            </label>
            <PhoneInput
              value={phoneNumber}
              onChange={setPhoneNumber}
              autoComplete="tel"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('auth.password')}
            </label>
            <div className="relative">
              <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? (
                  <EyeSlashIcon className="w-5 h-5" />
                ) : (
                  <EyeIcon className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Forgot Password */}
          <div className="text-right">
            <Link
              to="/forgot-password"
              className="text-sm text-primary hover:text-primary-dark font-medium"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-primary to-primary-dark text-white font-semibold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
              t('auth.login')
            )}
          </button>
        </form>

        {/* Register Link */}
        <p className="text-center mt-6 text-gray-600">
          {t('auth.noAccount')}{' '}
          <Link
            to={`/register${searchParams.get('ref') ? `?ref=${searchParams.get('ref')}` : ''}`}
            className="text-primary hover:text-primary-dark font-semibold"
          >
            {t('auth.registerNow')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
