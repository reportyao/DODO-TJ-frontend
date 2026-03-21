import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 内联所有语言翻译，确保任何语言的用户首次加载时都不会看到其他语言闪烁
// 三个文件总共约 275KB，gzip 后约 40KB，对首屏加载影响极小
import tgTranslation from './locales/tg.json'
import zhTranslation from './locales/zh.json'
import ruTranslation from './locales/ru.json'

// 自定义语言检测器
// 从用户缓存的配置中读取语言偏好（登录后用户的 preferred_language）
const userPreferenceDetector = {
  name: 'userPreference',
  lookup: (): string | undefined => {
    try {
      // 从缓存的用户数据中读取语言偏好
      const storedUser = localStorage.getItem('custom_user');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        const lang = parsedUser.preferred_language || parsedUser.language_code;
        if (lang) {
          if (lang.startsWith('zh')) return 'zh';
          if (lang.startsWith('ru')) return 'ru';
          if (lang.startsWith('tg') || lang.startsWith('fa')) return 'tg';
        }
      }

      return undefined;
    } catch (error) {
      console.error('Error detecting user language:', error);
      return undefined;
    }
  },
  cacheUserLanguage: () => {}
};

// 创建 LanguageDetector 实例并注册自定义检测器
const languageDetector = new LanguageDetector();
languageDetector.addDetector(userPreferenceDetector);

i18n
  .use(languageDetector) // 浏览器语言检测器（已包含自定义用户偏好检测器）
  .use(initReactI18next) // 集成 React
  .init({
    // 所有语言翻译内联打包，消除异步加载延迟
    // 确保切换语言时立即生效，不会出现其他语言闪烁
    resources: {
      tg: { translation: tgTranslation },
      zh: { translation: zhTranslation },
      ru: { translation: ruTranslation }
    },
    fallbackLng: 'tg',
    lng: undefined, // 让检测器自动检测
    supportedLngs: ['zh', 'ru', 'tg'],
    interpolation: {
      escapeValue: false
    },
    detection: {
      // localStorage 优先（用户手动切换的语言应被尊重），
      // 其次是用户偏好检测器（从缓存用户数据中获取），
      // 最后是浏览器语言
      order: ['localStorage', 'userPreference', 'navigator'],
      caches: ['localStorage']
    },
    saveMissing: false,
    missingKeyHandler: (_lng, _ns, key) => {
      console.warn(`Missing translation key: ${key}`)
    }
  })

export default i18n
