/**
 * DODO 首页场景化改造 · 多语言回退工具函数
 *
 * 当当前语言内容缺失时，系统按预设顺序自动选择可用文案。
 *
 * 回退顺序:
 * - zh: zh -> ru -> tg
 * - ru: ru -> tg -> zh
 * - tg: tg -> ru -> zh
 *
 * 塔语优先回退俄语，因为从用户理解成本看，俄语在当地语境更接近现实使用环境。
 */

import type { I18nText, SupportedLang } from '../types/homepage';

/** 各语言的回退顺序 */
const FALLBACK_ORDER: Record<SupportedLang, SupportedLang[]> = {
  zh: ['zh', 'ru', 'tg'],
  ru: ['ru', 'tg', 'zh'],
  tg: ['tg', 'ru', 'zh'],
};

/**
 * 从 i18n 对象中按回退顺序获取文本
 *
 * @param value - 三语 i18n 对象，如 { zh: '标题', ru: 'Заголовок', tg: 'Сарлавҳа' }
 * @param lang - 当前用户语言
 * @returns { text, hitLang } - 命中的文本和实际使用的语言
 *
 * @example
 * ```ts
 * const { text, hitLang } = getI18nText(topic.title_i18n, 'tg');
 * // 如果 tg 为空，会自动回退到 ru，再回退到 zh
 * ```
 */
export function getI18nText(
  value: I18nText | null | undefined,
  lang: SupportedLang
): { text: string; hitLang: SupportedLang | null } {
  if (!value) {return { text: '', hitLang: null };}

  const order = FALLBACK_ORDER[lang] || FALLBACK_ORDER.zh;

  for (const key of order) {
    const text = value[key];
    if (text && text.trim()) {
      return { text, hitLang: key };
    }
  }

  return { text: '', hitLang: null };
}

/**
 * 从 i18n 对象中按回退顺序获取文本（简化版，只返回字符串）
 *
 * @param value - 三语 i18n 对象
 * @param lang - 当前用户语言
 * @param fallback - 所有语言都为空时的兜底文本
 * @returns 文本字符串
 */
export function t(
  value: I18nText | null | undefined,
  lang: SupportedLang,
  fallback = ''
): string {
  const { text } = getI18nText(value, lang);
  return text || fallback;
}

/**
 * 获取当前语言对应的封面图
 *
 * @param images - 包含 cover_image_default, cover_image_zh, cover_image_ru, cover_image_tg 的对象
 * @param lang - 当前用户语言
 * @returns 封面图 URL 或 null
 */
export function getCoverImage(
  images: {
    cover_image_default?: string | null;
    cover_image_zh?: string | null;
    cover_image_ru?: string | null;
    cover_image_tg?: string | null;
    cover_image_url?: string | null; // v2: AI 生成的封面图
  } | null | undefined,
  lang: SupportedLang
): string | null {
  if (!images) {return null;}

  const order = FALLBACK_ORDER[lang] || FALLBACK_ORDER.zh;

  // 优先使用当前语言的封面
  for (const l of order) {
    const key = `cover_image_${l}` as keyof typeof images;
    const url = images[key];
    if (url && typeof url === 'string' && url.trim()) {
      return url;
    }
  }

  // 回退到默认封面
  if (images.cover_image_default) {return images.cover_image_default;}

  // [BUG-M6 修复] 最终回退到 AI 生成的封面图
  if ((images as any).cover_image_url) {return (images as any).cover_image_url;}

  return null;
}
