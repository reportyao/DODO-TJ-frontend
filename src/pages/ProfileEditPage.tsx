import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import { useSupabase } from '../contexts/SupabaseContext'
import {
  ArrowLeftIcon,
  UserIcon,
  PhoneIcon,
  LockClosedIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import AvatarUpload from '../components/AvatarUpload'
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

/**
 * 个人资料编辑页面
 * 
 * 功能：
 * 1. 修改头像（使用统一的 AvatarUpload 组件，带压缩）
 * 2. 修改昵称
 * 3. 修改手机号（输入两次确认，不需要验证码）
 * 4. 修改密码（验证旧密码 + 两次新密码）
 * 
 * 每个修改项独立保存，互不影响。
 */

type EditSection = 'none' | 'phone' | 'password'

const ProfileEditPage: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useUser()
  const { supabase } = useSupabase()

  // ========== 基本信息（昵称 + 头像） ==========
  const [firstName, setFirstName] = useState(user?.first_name || '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatar_url || null)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isSavingBasic, setIsSavingBasic] = useState(false)

  // 判断基本信息是否有变化
  const hasBasicChanges = firstName !== (user?.first_name || '') || avatarUrl !== (user?.avatar_url || null)

  // ========== 展开的编辑区域 ==========
  const [activeSection, setActiveSection] = useState<EditSection>('none')

  // ========== 手机号修改 ==========
  const [newPhone, setNewPhone] = useState('')
  const [confirmPhone, setConfirmPhone] = useState('')
  const [isSavingPhone, setIsSavingPhone] = useState(false)

  // ========== 密码修改 ==========
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  // ========== 更新本地缓存 ==========
  const updateLocalUser = useCallback((updates: Record<string, any>) => {
    try {
      const storedUser = localStorage.getItem('custom_user')
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser)
        const updatedUser = { ...parsedUser, ...updates }
        localStorage.setItem('custom_user', JSON.stringify(updatedUser))
      }
    } catch (e) {
      console.error('[ProfileEditPage] Failed to update local user:', e)
    }
  }, [])

  // ========== 保存基本信息（昵称 + 头像） ==========
  const handleSaveBasic = useCallback(async () => {
    if (!hasBasicChanges) return
    if (isUploadingAvatar) {
      toast.error(t('profile.waitForAvatarUpload') || '请等待头像上传完成')
      return
    }

    setIsSavingBasic(true)
    try {
      const { data, error } = await supabase.functions.invoke('update-profile', {
        body: {
          action: 'update_basic',
          first_name: firstName.trim() || null,
          avatar_url: avatarUrl,
        },
      })

      if (error) {
        const errMsg = await extractEdgeFunctionError(error)
        throw new Error(errMsg)
      }

      if (data?.success && data?.data?.user) {
        updateLocalUser(data.data.user)
        toast.success(t('success.updateSuccess') || '保存成功')
        // 刷新页面以更新 UserContext
        window.location.reload()
      } else {
        throw new Error(data?.error?.message || '保存失败')
      }
    } catch (error: any) {
      console.error('[ProfileEditPage] Save basic info failed:', error)
      toast.error(error.message || t('error.validationError') || '保存失败')
    } finally {
      setIsSavingBasic(false)
    }
  }, [hasBasicChanges, isUploadingAvatar, firstName, avatarUrl, supabase, updateLocalUser, t])

  // ========== 保存手机号 ==========
  const handleSavePhone = useCallback(async () => {
    if (!newPhone.trim()) {
      toast.error(t('profile.enterNewPhone') || '请输入新手机号')
      return
    }
    if (!confirmPhone.trim()) {
      toast.error(t('profile.confirmNewPhone') || '请再次输入新手机号')
      return
    }

    setIsSavingPhone(true)
    try {
      const { data, error } = await supabase.functions.invoke('update-profile', {
        body: {
          action: 'update_phone',
          new_phone: newPhone.trim(),
          confirm_phone: confirmPhone.trim(),
        },
      })

      if (error) {
        const errMsg = await extractEdgeFunctionError(error)
        throw new Error(errMsg)
      }

      if (data?.success && data?.data?.user) {
        updateLocalUser(data.data.user)
        toast.success(t('profile.phoneUpdated') || '手机号修改成功')
        setNewPhone('')
        setConfirmPhone('')
        setActiveSection('none')
        // 刷新页面以更新 UserContext
        window.location.reload()
      } else {
        throw new Error(data?.error?.message || '修改失败')
      }
    } catch (error: any) {
      console.error('[ProfileEditPage] Save phone failed:', error)
      toast.error(error.message || t('error.validationError') || '修改失败')
    } finally {
      setIsSavingPhone(false)
    }
  }, [newPhone, confirmPhone, supabase, updateLocalUser, t])

  // ========== 保存密码 ==========
  const handleSavePassword = useCallback(async () => {
    if (!oldPassword) {
      toast.error(t('profile.enterOldPassword') || '请输入当前密码')
      return
    }
    if (!newPassword) {
      toast.error(t('profile.enterNewPassword') || '请输入新密码')
      return
    }
    if (newPassword.length < 6) {
      toast.error(t('auth.passwordTooShort') || '密码长度至少6位')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('auth.passwordMismatch') || '两次输入的密码不一致')
      return
    }

    setIsSavingPassword(true)
    try {
      const { data, error } = await supabase.functions.invoke('update-profile', {
        body: {
          action: 'update_password',
          old_password: oldPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        },
      })

      if (error) {
        const errMsg = await extractEdgeFunctionError(error)
        throw new Error(errMsg)
      }

      if (data?.success) {
        toast.success(t('profile.passwordUpdated') || '密码修改成功')
        setOldPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setActiveSection('none')
      } else {
        throw new Error(data?.error?.message || '修改失败')
      }
    } catch (error: any) {
      console.error('[ProfileEditPage] Save password failed:', error)
      toast.error(error.message || t('error.validationError') || '修改失败')
    } finally {
      setIsSavingPassword(false)
    }
  }, [oldPassword, newPassword, confirmPassword, supabase, t])

  // ========== 切换展开区域 ==========
  const toggleSection = useCallback((section: EditSection) => {
    setActiveSection(prev => prev === section ? 'none' : section)
    // 切换时清空输入
    if (section === 'phone') {
      setNewPhone('')
      setConfirmPhone('')
    } else if (section === 'password') {
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 页面标题 */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeftIcon className="w-6 h-6 text-gray-600" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {t('profile.editProfile') || t('common.edit')}
          </h1>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 头像 + 昵称区域 */}
      {/* ============================================================ */}
      <div className="bg-white mx-4 mt-4 rounded-2xl p-6 shadow-sm">
        {/* 头像上传 */}
        <AvatarUpload
          currentAvatarUrl={avatarUrl}
          fallbackInitial={firstName?.[0] || user?.first_name?.[0] || 'U'}
          size={96}
          onUploadSuccess={(url) => setAvatarUrl(url)}
          onUploadingChange={(uploading) => setIsUploadingAvatar(uploading)}
          disabled={isSavingBasic}
        />

        {/* 昵称输入 */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <UserIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
            {t('profile.name') || '姓名'}
          </label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={t('profile.namePlaceholder') || '请输入您的姓名'}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* 保存按钮 */}
        {hasBasicChanges && (
          <button
            onClick={handleSaveBasic}
            disabled={isSavingBasic || isUploadingAvatar}
            className="w-full mt-4 py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white font-semibold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {isSavingBasic ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('common.submitting') || '提交中...'}
              </>
            ) : (
              <>
                <CheckIcon className="w-5 h-5" />
                {t('common.save') || '保存'}
              </>
            )}
          </button>
        )}
      </div>

      {/* ============================================================ */}
      {/* 手机号修改 */}
      {/* ============================================================ */}
      <div className="mx-4 mt-4">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          {/* 手机号当前值 + 展开按钮 */}
          <button
            onClick={() => toggleSection('phone')}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <PhoneIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900">
                  {t('profile.changePhone') || '修改手机号'}
                </p>
                <p className="text-xs text-gray-500">
                  {(user as any)?.phone_number || t('profile.notSet') || '未设置'}
                </p>
              </div>
            </div>
            <ChevronRightIcon className={`w-5 h-5 text-gray-400 transition-transform ${activeSection === 'phone' ? 'rotate-90' : ''}`} />
          </button>

          {/* 手机号修改表单 */}
          {activeSection === 'phone' && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500">
                {t('profile.phoneChangeHint') || '请输入两次新手机号以确认修改'}
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('profile.newPhone') || '新手机号'}
                </label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+992 XXX XXX XXX"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                  autoComplete="tel"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('profile.confirmNewPhone') || '再次输入新手机号'}
                </label>
                <input
                  type="tel"
                  value={confirmPhone}
                  onChange={(e) => setConfirmPhone(e.target.value)}
                  placeholder="+992 XXX XXX XXX"
                  className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400 ${
                    confirmPhone && newPhone && confirmPhone !== newPhone
                      ? 'border-red-300 bg-red-50'
                      : confirmPhone && newPhone && confirmPhone === newPhone
                      ? 'border-green-300 bg-green-50'
                      : 'border-gray-200'
                  }`}
                  autoComplete="tel"
                />
                {confirmPhone && newPhone && confirmPhone !== newPhone && (
                  <p className="text-xs text-red-500 mt-1">
                    {t('profile.phoneMismatch') || '两次输入的手机号不一致'}
                  </p>
                )}
                {confirmPhone && newPhone && confirmPhone === newPhone && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <CheckIcon className="w-3 h-3" />
                    {t('profile.phoneMatch') || '手机号一致'}
                  </p>
                )}
              </div>
              <button
                onClick={handleSavePhone}
                disabled={isSavingPhone || !newPhone || !confirmPhone}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isSavingPhone ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t('common.submitting') || '提交中...'}
                  </>
                ) : (
                  t('profile.savePhone') || '确认修改手机号'
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 密码修改 */}
      {/* ============================================================ */}
      <div className="mx-4 mt-4">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          {/* 密码展开按钮 */}
          <button
            onClick={() => toggleSection('password')}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <LockClosedIcon className="w-5 h-5 text-orange-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900">
                  {t('profile.changePassword') || '修改密码'}
                </p>
                <p className="text-xs text-gray-500">
                  {t('profile.passwordHint') || '需要验证当前密码'}
                </p>
              </div>
            </div>
            <ChevronRightIcon className={`w-5 h-5 text-gray-400 transition-transform ${activeSection === 'password' ? 'rotate-90' : ''}`} />
          </button>

          {/* 密码修改表单 */}
          {activeSection === 'password' && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
              {/* 旧密码 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('profile.currentPassword') || '当前密码'}
                </label>
                <div className="relative">
                  <input
                    type={showOldPassword ? 'text' : 'password'}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder={t('profile.enterCurrentPassword') || '请输入当前密码'}
                    className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOldPassword(!showOldPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showOldPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* 新密码 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('profile.newPassword') || '新密码'}
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('auth.passwordPlaceholder') || '至少6位'}
                    className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNewPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* 确认新密码 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('profile.confirmNewPassword') || '确认新密码'}
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('auth.confirmPasswordPlaceholder') || '再次输入密码'}
                    className={`w-full px-4 py-3 pr-12 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400 ${
                      confirmPassword && newPassword && confirmPassword !== newPassword
                        ? 'border-red-300 bg-red-50'
                        : confirmPassword && newPassword && confirmPassword === newPassword
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-200'
                    }`}
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
                {confirmPassword && newPassword && confirmPassword !== newPassword && (
                  <p className="text-xs text-red-500 mt-1">
                    {t('auth.passwordMismatch') || '两次输入的密码不一致'}
                  </p>
                )}
              </div>

              <button
                onClick={handleSavePassword}
                disabled={isSavingPassword || !oldPassword || !newPassword || !confirmPassword}
                className="w-full py-3 bg-orange-600 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isSavingPassword ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t('common.submitting') || '提交中...'}
                  </>
                ) : (
                  t('profile.savePassword') || '确认修改密码'
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 只读信息（推荐码） */}
      {/* ============================================================ */}
      <div className="mx-4 mt-4">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('invite.myInviteCode') || '我的邀请码'}
            </label>
            <input
              type="text"
              value={user?.referral_code || user?.invite_code || ''}
              disabled
              className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed font-mono text-center text-lg"
            />
            <p className="text-xs text-gray-400 mt-1 text-center">
              {t('profile.inviteCodeReadonly') || '邀请码不可修改'}
            </p>
          </div>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="mx-4 mt-4 mb-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-blue-800">
            <strong>{t('common.note') || '提示'}:</strong>{' '}
            {t('profile.editNote') || '个人信息修改后需重新审核'}
          </p>
        </div>
      </div>
    </div>
  )
}

export default ProfileEditPage
