import React, { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSupabase } from '../contexts/SupabaseContext'
import {
  PhoneIcon,
  LockClosedIcon,
  KeyIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { authService } = useSupabase()

  // 从 URL 获取 token（如果是从重置链接跳转过来的）
  const tokenFromUrl = searchParams.get('token')

  const [step, setStep] = useState<'request' | 'verify'>(tokenFromUrl ? 'verify' : 'request')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [resetToken, setResetToken] = useState(tokenFromUrl || '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [requestSent, setRequestSent] = useState(false)

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!phoneNumber.trim()) {
      toast.error(t('auth.phoneRequired', '请输入手机号'))
      return
    }

    setIsLoading(true)
    try {
      await authService.requestPasswordReset(phoneNumber.trim())
      setRequestSent(true)
      toast.success(t('auth.resetLinkSent', '如果该手机号已注册，您将收到重置链接'))
    } catch (error: any) {
      toast.error(error.message || t('auth.resetRequestFailed', '请求失败'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!resetToken.trim()) {
      toast.error(t('auth.tokenRequired', '请输入重置Token'))
      return
    }
    if (!newPassword) {
      toast.error(t('auth.passwordRequired', '请输入新密码'))
      return
    }
    if (newPassword.length < 6) {
      toast.error(t('auth.passwordTooShort', '密码长度至少6位'))
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('auth.passwordMismatch', '两次输入的密码不一致'))
      return
    }

    setIsLoading(true)
    try {
      await authService.resetPassword(resetToken.trim(), newPassword)
      toast.success(t('auth.passwordResetSuccess', '密码重置成功，请使用新密码登录'))
      navigate('/login', { replace: true })
    } catch (error: any) {
      toast.error(error.message || t('auth.resetFailed', '密码重置失败'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg">
            <KeyIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('auth.resetPassword', '重置密码')}
          </h1>
          <p className="text-gray-500 mt-1">
            {step === 'request'
              ? t('auth.resetDescription', '输入您的手机号，我们将发送重置链接')
              : t('auth.setNewPassword', '设置您的新密码')}
          </p>
        </div>

        {step === 'request' && !requestSent && (
          <form onSubmit={handleRequestReset} className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('auth.phoneNumber', '手机号')}
              </label>
              <div className="relative">
                <PhoneIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+992 XXX XXX XXX"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                  autoComplete="tel"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-orange-400 to-orange-600 text-white font-semibold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? t('common.loading', '加载中...') : t('auth.sendResetLink', '发送重置链接')}
            </button>

            <button
              type="button"
              onClick={() => setStep('verify')}
              className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {t('auth.haveResetToken', '已有重置Token？点击输入')}
            </button>
          </form>
        )}

        {step === 'request' && requestSent && (
          <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-gray-700">
                {t('auth.resetLinkSentDescription', '如果该手机号已注册，重置链接将通过 WhatsApp 发送到您的手机。请检查您的消息。')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setStep('verify')}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all"
            >
              {t('auth.enterResetToken', '输入重置Token')}
            </button>

            <button
              type="button"
              onClick={() => { setRequestSent(false); }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              {t('auth.resendResetLink', '重新发送')}
            </button>
          </div>
        )}

        {step === 'verify' && (
          <form onSubmit={handleResetPassword} className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
            {/* Reset Token */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('auth.resetToken', '重置Token')}
              </label>
              <div className="relative">
                <KeyIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder={t('auth.resetTokenPlaceholder', '粘贴您收到的重置Token')}
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400 font-mono text-sm"
                  readOnly={!!tokenFromUrl}
                />
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('auth.newPassword', '新密码')}
              </label>
              <div className="relative">
                <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder', '至少6位')}
                  className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
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
                {t('auth.confirmPassword', '确认密码')}
              </label>
              <div className="relative">
                <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('auth.confirmPasswordPlaceholder', '再次输入密码')}
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-orange-400 to-orange-600 text-white font-semibold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? t('common.loading', '加载中...') : t('auth.resetPasswordSubmit', '重置密码')}
            </button>

            {!tokenFromUrl && (
              <button
                type="button"
                onClick={() => { setStep('request'); setRequestSent(false); }}
                className="w-full flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                {t('auth.backToRequest', '返回请求重置')}
              </button>
            )}
          </form>
        )}

        {/* Back to Login */}
        <p className="text-center mt-6 text-gray-600">
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-semibold flex items-center justify-center gap-1">
            <ArrowLeftIcon className="w-4 h-4" />
            {t('auth.backToLogin', '返回登录')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default ForgotPasswordPage
