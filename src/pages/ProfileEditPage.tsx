import React, { useState } from 'react'

import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import { 
  ArrowLeftIcon,
  UserCircleIcon,
  CameraIcon
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const ProfileEditPage: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useUser()
  
  const [formData, setFormData] = useState({
    first_name: user?.first_name || '',
  })
  
  const [isSaving, setIsSaving] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)
      
      // TODO: 调用API保存用户信息
      // await userService.updateProfile(user.id, formData)
      
      // 模拟API调用
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      toast.success(t('success.updateSuccess'))
      navigate(-1)
    } catch (error) {
      console.error('Save failed:', error)
      toast.error(t('error.validationError'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 页面标题 */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="w-6 h-6 text-gray-600" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">{t('common.edit')}</h1>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? t('common.submitting') : t('common.save')}
          </button>
        </div>
      </div>

      {/* 头像部分 */}
      <div className="bg-white mx-4 mt-4 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col items-center">
          <div className="relative">
            {user?.avatar_url ? (
              <img 
                src={user.avatar_url} 
                alt="Avatar"
                style={{ width: '96px', height: '96px', borderRadius: '9999px', border: '4px solid #f3f4f6', objectFit: 'cover', maxWidth: 'none' }}
              />
            ) : (
              <div className="w-24 h-24 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                <UserCircleIcon className="w-16 h-16 text-white" />
              </div>
            )}
            
            <button className="absolute bottom-0 right-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center shadow-lg hover:bg-blue-700 transition-colors">
              <CameraIcon className="w-4 h-4 text-white" />
            </button>
          </div>
          
          <p className="text-sm text-gray-500 mt-3">{t('common.upload')}</p>
        </div>
      </div>

      {/* 表单部分 */}
      <div className="mx-4 mt-4">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          {/* 名字 */}
          <div className="p-4 border-b border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('profile.name') || t('common.name') || '名字'}
            </label>
            <input
              type="text"
              name="first_name"
              value={formData.first_name}
              onChange={handleChange}
              placeholder={t('profile.namePlaceholder') || '请输入您的名字'}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* 手机号 (只读) */}
          <div className="p-4 border-b border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('auth.phoneNumber') || '手机号'}
            </label>
            <input
              type="text"
              value={(user as any)?.phone_number || ''}
              disabled
              className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">{t('profile.phoneReadonly') || '手机号不可修改'}</p>
          </div>

          {/* 推荐码 (只读) */}
          <div className="p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('invite.myInviteCode')}
            </label>
            <input
              type="text"
              value={user?.referral_code || user?.invite_code || ''}
              disabled
              className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed font-mono text-center text-lg"
            />
            <p className="text-xs text-gray-500 mt-1">{t('home.referralCode')}</p>
          </div>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="mx-4 mt-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-blue-800">
            💡 <strong>{t('common.note')}:</strong> {t('profile.editNote') || '修改信息后请点击保存按钮。'}
          </p>
        </div>
      </div>
    </div>
  )
}

export default ProfileEditPage
