import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import HttpBackend from 'i18next-http-backend'

// 内联 tg（塔吉克语）翻译作为默认语言
// 塔吉克斯坦是主要运营市场，塔吉克语用户占多数
// 其他语言（ru、zh）将通过 HTTP 按需加载
import tgTranslation from './locales/tg.json'

// 构建版本号，用于 i18n 文件的缓存破坏
// 每次构建时 Vite 会注入 __APP_VERSION__，确保翻译文件不被旧缓存污染
declare const __APP_VERSION__: string
const I18N_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : Date.now().toString()

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
  .use(HttpBackend) // HTTP 后端按需加载翻译文件
  .use(languageDetector) // 浏览器语言检测器（已包含自定义用户偏好检测器）
  .use(initReactI18next) // 集成 React
  .init({
    // 内联 tg 翻译，确保塔吉克语用户首次加载时不会看到其他语言闪烁
    resources: {
      tg: { translation: tgTranslation }
    },
    // 对于非 tg 语言，通过 HTTP 后端加载
    partialBundledLanguages: true,
    backend: {
      // 在 URL 中加入构建版本号，每次部署后强制浏览器重新加载翻译文件
      // 避免缓存旧的翻译文件导致文案不更新
      loadPath: `/locales/{{lng}}.json?v=${I18N_VERSION}`
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
