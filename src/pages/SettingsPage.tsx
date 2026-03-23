import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { 
  ArrowLeftIcon,
  LanguageIcon,
  CheckIcon
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const SettingsPage: React.FC = () => {
  const navigate = useNavigate()
  const { i18n, t, ready } = useTranslation()
  const [currentLanguage, setCurrentLanguage] = useState<string>('tg')
  const [isLoading, setIsLoading] = useState(true)

  const languages = [
    { code: 'tg', name: 'Tajik', nativeName: 'Тоҷикӣ' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский' },
    { code: 'zh', name: 'Chinese', nativeName: '中文' }
  ]

  // 在组件挂载时初始化当前语言
  useEffect(() => {
    try {
      const lang = i18n.language || localStorage.getItem('i18nextLng') || 'tg'
      setCurrentLanguage(lang)
      setIsLoading(false)
    } catch (error) {
      console.error('Error initializing language:', error)
      setCurrentLanguage('tg')
      setIsLoading(false)
    }
  }, [i18n.language])

  const handleLanguageChange = async (languageCode: string) => {
    try {
      await i18n.changeLanguage(languageCode)
      setCurrentLanguage(languageCode)
      localStorage.setItem('i18nextLng', languageCode)
      
      // 切换语言后，t() 已经指向新语言，直接使用 t() 获取提示文本
      toast.success(t('settings.languageChanged'))
      
      // 不再强制导航回个人中心，保持在当前页面
      // React组件会自动响应i18n语言变化重新渲染
    } catch (error) {
      console.error(t('settings.languageChangeFailed') + ':', error)
      toast.error(t('settings.languageChangeFailed'))
    }
  }

  // 如果 i18n 还没有准备好，显示加载状态
  if (!ready || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

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
          <h1 className="text-xl font-bold text-gray-900">{t('settings.title')}</h1>
        </div>
      </div>

      {/* 语言设置 */}
      <div className="mx-4 mt-4">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center space-x-2">
              <LanguageIcon className="w-5 h-5 text-gray-600" />
              <h2 className="text-base font-semibold text-gray-900">{t('settings.languageSetting')}</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1">{t('settings.selectLanguage')}</p>
          </div>
          
          <div className="divide-y divide-gray-100">
            {languages.map((language, index) => (
              <motion.button
                key={language.code}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handleLanguageChange(language.code)}
                className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">{language.nativeName}</p>
                    <p className="text-xs text-gray-500">{language.name}</p>
                  </div>
                </div>
                {currentLanguage === language.code && (
                  <CheckIcon className="w-5 h-5 text-primary" />
                )}
              </motion.button>
            ))}
          </div>
        </div>
      </div>


    </div>
  )
}

export default SettingsPage
