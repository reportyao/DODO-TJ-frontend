/**
 * i18nFallback 工具函数单元测试
 *
 * 覆盖范围：
 * - getI18nText: 多语言回退逻辑（zh/ru/tg 三语回退链）
 * - t: 简化版文本获取（含 fallback 参数）
 * - getCoverImage: 封面图多语言回退逻辑
 */
import { describe, it, expect } from 'vitest';
import { getI18nText, t, getCoverImage } from '../i18nFallback';
import type { I18nText, SupportedLang } from '../../types/homepage';

// ============================================================
// 测试数据
// ============================================================

const FULL_I18N: I18nText = {
  zh: '中文标题',
  ru: 'Русский заголовок',
  tg: 'Сарлавҳаи тоҷикӣ',
};

const ZH_ONLY: I18nText = {
  zh: '仅中文',
  ru: '',
  tg: '',
};

const RU_ONLY: I18nText = {
  zh: '',
  ru: 'Только русский',
  tg: '',
};

const TG_ONLY: I18nText = {
  zh: '',
  ru: '',
  tg: 'Танҳо тоҷикӣ',
};

const EMPTY_I18N: I18nText = {
  zh: '',
  ru: '',
  tg: '',
};

const WHITESPACE_I18N: I18nText = {
  zh: '  ',
  ru: '  ',
  tg: '  ',
};

// ============================================================
// getI18nText 测试
// ============================================================

describe('getI18nText', () => {
  describe('正常回退逻辑', () => {
    it('zh 语言优先返回中文', () => {
      const result = getI18nText(FULL_I18N, 'zh');
      expect(result.text).toBe('中文标题');
      expect(result.hitLang).toBe('zh');
    });

    it('ru 语言优先返回俄语', () => {
      const result = getI18nText(FULL_I18N, 'ru');
      expect(result.text).toBe('Русский заголовок');
      expect(result.hitLang).toBe('ru');
    });

    it('tg 语言优先返回塔吉克语', () => {
      const result = getI18nText(FULL_I18N, 'tg');
      expect(result.text).toBe('Сарлавҳаи тоҷикӣ');
      expect(result.hitLang).toBe('tg');
    });
  });

  describe('回退链 - zh: zh -> ru -> tg', () => {
    it('zh 缺失时回退到 ru', () => {
      const result = getI18nText(RU_ONLY, 'zh');
      expect(result.text).toBe('Только русский');
      expect(result.hitLang).toBe('ru');
    });

    it('zh 和 ru 都缺失时回退到 tg', () => {
      const result = getI18nText(TG_ONLY, 'zh');
      expect(result.text).toBe('Танҳо тоҷикӣ');
      expect(result.hitLang).toBe('tg');
    });
  });

  describe('回退链 - ru: ru -> tg -> zh', () => {
    it('ru 缺失时回退到 tg', () => {
      const result = getI18nText(TG_ONLY, 'ru');
      expect(result.text).toBe('Танҳо тоҷикӣ');
      expect(result.hitLang).toBe('tg');
    });

    it('ru 和 tg 都缺失时回退到 zh', () => {
      const result = getI18nText(ZH_ONLY, 'ru');
      expect(result.text).toBe('仅中文');
      expect(result.hitLang).toBe('zh');
    });
  });

  describe('回退链 - tg: tg -> ru -> zh', () => {
    it('tg 缺失时回退到 ru', () => {
      const result = getI18nText(RU_ONLY, 'tg');
      expect(result.text).toBe('Только русский');
      expect(result.hitLang).toBe('ru');
    });

    it('tg 和 ru 都缺失时回退到 zh', () => {
      const result = getI18nText(ZH_ONLY, 'tg');
      expect(result.text).toBe('仅中文');
      expect(result.hitLang).toBe('zh');
    });
  });

  describe('边界情况', () => {
    it('null 输入返回空字符串和 null hitLang', () => {
      const result = getI18nText(null, 'zh');
      expect(result.text).toBe('');
      expect(result.hitLang).toBeNull();
    });

    it('undefined 输入返回空字符串和 null hitLang', () => {
      const result = getI18nText(undefined, 'zh');
      expect(result.text).toBe('');
      expect(result.hitLang).toBeNull();
    });

    it('所有语言都为空字符串时返回空', () => {
      const result = getI18nText(EMPTY_I18N, 'zh');
      expect(result.text).toBe('');
      expect(result.hitLang).toBeNull();
    });

    it('所有语言都是空白字符串时返回空', () => {
      const result = getI18nText(WHITESPACE_I18N, 'zh');
      expect(result.text).toBe('');
      expect(result.hitLang).toBeNull();
    });
  });
});

// ============================================================
// t 简化版测试
// ============================================================

describe('t (简化版)', () => {
  it('正常返回文本', () => {
    expect(t(FULL_I18N, 'zh')).toBe('中文标题');
  });

  it('所有语言为空时返回默认 fallback 空字符串', () => {
    expect(t(EMPTY_I18N, 'zh')).toBe('');
  });

  it('所有语言为空时返回自定义 fallback', () => {
    expect(t(EMPTY_I18N, 'zh', '默认文本')).toBe('默认文本');
  });

  it('null 输入时返回 fallback', () => {
    expect(t(null, 'ru', 'Нет данных')).toBe('Нет данных');
  });

  it('回退逻辑与 getI18nText 一致', () => {
    expect(t(ZH_ONLY, 'tg')).toBe('仅中文');
    expect(t(TG_ONLY, 'ru')).toBe('Танҳо тоҷикӣ');
  });
});

// ============================================================
// getCoverImage 测试
// ============================================================

describe('getCoverImage', () => {
  const fullImages = {
    cover_image_default: 'https://cdn.example.com/default.jpg',
    cover_image_zh: 'https://cdn.example.com/zh.jpg',
    cover_image_ru: 'https://cdn.example.com/ru.jpg',
    cover_image_tg: 'https://cdn.example.com/tg.jpg',
  };

  const zhOnlyImages = {
    cover_image_default: 'https://cdn.example.com/default.jpg',
    cover_image_zh: 'https://cdn.example.com/zh.jpg',
    cover_image_ru: null,
    cover_image_tg: null,
  };

  const defaultOnlyImages = {
    cover_image_default: 'https://cdn.example.com/default.jpg',
    cover_image_zh: null,
    cover_image_ru: null,
    cover_image_tg: null,
  };

  describe('优先返回当前语言封面', () => {
    it('zh 语言返回中文封面', () => {
      expect(getCoverImage(fullImages, 'zh')).toBe('https://cdn.example.com/zh.jpg');
    });

    it('ru 语言返回俄语封面', () => {
      expect(getCoverImage(fullImages, 'ru')).toBe('https://cdn.example.com/ru.jpg');
    });

    it('tg 语言返回塔吉克语封面', () => {
      expect(getCoverImage(fullImages, 'tg')).toBe('https://cdn.example.com/tg.jpg');
    });
  });

  describe('封面图回退逻辑', () => {
    it('tg 缺失时回退到 ru', () => {
      const images = { ...fullImages, cover_image_tg: null };
      expect(getCoverImage(images, 'tg')).toBe('https://cdn.example.com/ru.jpg');
    });

    it('tg 和 ru 都缺失时回退到 zh', () => {
      expect(getCoverImage(zhOnlyImages, 'tg')).toBe('https://cdn.example.com/zh.jpg');
    });

    it('所有语言封面都缺失时回退到 default', () => {
      expect(getCoverImage(defaultOnlyImages, 'tg')).toBe('https://cdn.example.com/default.jpg');
    });
  });

  describe('边界情况', () => {
    it('null 输入返回 null', () => {
      expect(getCoverImage(null, 'zh')).toBeNull();
    });

    it('undefined 输入返回 null', () => {
      expect(getCoverImage(undefined, 'zh')).toBeNull();
    });

    it('所有字段都为 null 时返回 null', () => {
      const emptyImages = {
        cover_image_default: null,
        cover_image_zh: null,
        cover_image_ru: null,
        cover_image_tg: null,
      };
      expect(getCoverImage(emptyImages, 'zh')).toBeNull();
    });

    it('空白字符串封面被跳过', () => {
      const whitespaceImages = {
        cover_image_default: 'https://cdn.example.com/default.jpg',
        cover_image_zh: '   ',
        cover_image_ru: null,
        cover_image_tg: null,
      };
      expect(getCoverImage(whitespaceImages, 'zh')).toBe('https://cdn.example.com/default.jpg');
    });

    it('default 也为空时返回 null', () => {
      const noDefault = {
        cover_image_default: '',
        cover_image_zh: null,
        cover_image_ru: null,
        cover_image_tg: null,
      };
      expect(getCoverImage(noDefault, 'zh')).toBeNull();
    });
  });
});
