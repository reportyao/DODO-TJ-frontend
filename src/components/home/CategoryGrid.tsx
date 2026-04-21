/**
 * 金刚区 · 一级分类入口
 *
 * 首页采用横向轻卡片分类条，兼顾俄语、塔吉克语等长文案场景：
 * - 每个分类入口使用固定宽度，避免因文案长短造成布局抖动
 * - 对俄语/塔吉克语的常见分类使用更短的导航标签
 * - 标签允许最多两行，避免长词强制单行导致单屏可见项过少
 * - 选中态采用浅色背景 + 边框高亮，而非仅靠下划线
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getLocalizedText } from '../../lib/utils';
import { getCategoryIcon } from '../../utils/categoryIcons';
import type { HomeFeedCategory } from '../../types/homepage';

interface CategoryGridProps {
  categories: HomeFeedCategory[];
  selectedId?: string;
  onSelect: (categoryId: string | undefined) => void;
  isLoading?: boolean;
}

const CATEGORY_SHORT_LABELS: Record<string, Partial<Record<'ru' | 'tg', string>>> = {
  daily_goods: { ru: 'Дом', tg: 'Рӯзгор' },
  home_appliance: { ru: 'Техника', tg: 'Техника' },
  food_kitchen: { ru: 'Кухня', tg: 'Ошхона' },
  personal_care: { ru: 'Уход', tg: 'Нигоҳубин' },
  clothing_bags: { ru: 'Одежда', tg: 'Либос' },
  digital_tech: { ru: 'Гаджеты', tg: 'Рақамӣ' },
  mother_baby: { ru: 'Мама и малыш', tg: 'Модару кӯдак' },
  sports_outdoor: { ru: 'Спорт', tg: 'Варзиш' },
};

function getCategoryDisplayName(code: string, fallbackName: string, language: string): string {
  const normalized = language.startsWith('ru') ? 'ru' : language.startsWith('tg') ? 'tg' : undefined;
  if (!normalized) {
    return fallbackName;
  }

  return CATEGORY_SHORT_LABELS[code]?.[normalized] || fallbackName;
}

export const CategoryGrid: React.FC<CategoryGridProps> = ({
  categories,
  selectedId,
  onSelect,
  isLoading = false,
}) => {
  const { i18n, t } = useTranslation();

  const selectedCategory = selectedId
    ? categories.find((c) => c.id === selectedId)
    : undefined;

  if (isLoading) {
    return (
      <div className="px-4 mt-3">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide py-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="w-[76px] h-[78px] rounded-2xl border border-gray-100 bg-white animate-pulse flex-shrink-0"
            />
          ))}
        </div>
      </div>
    );
  }

  if (categories.length === 0) {return null;}

  return (
    <div className="px-4 mt-3">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1">
        <button
          onClick={() => onSelect(undefined)}
          className={`w-[76px] min-h-[78px] rounded-2xl border px-2.5 py-2.5 flex flex-col items-center justify-start flex-shrink-0 transition-all duration-200 shadow-sm ${
            !selectedId
              ? 'bg-amber-50 border-amber-200 shadow-amber-100/70'
              : 'bg-white border-gray-100 hover:border-amber-100 hover:bg-amber-50/40'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-transform duration-200 ${
              !selectedId ? 'bg-white text-orange-500' : 'bg-gray-50 text-gray-700'
            }`}
          >
            🔥
          </div>
          <span
            className={`mt-1.5 text-[11px] font-medium text-center leading-tight line-clamp-2 min-h-[2rem] ${
              !selectedId ? 'text-orange-600' : 'text-gray-600'
            }`}
          >
            {t('common.all') || '全部'}
          </span>
        </button>

        {categories.map((cat) => {
          const isSelected = selectedId === cat.id;
          const icon = getCategoryIcon(cat.code);
          const localizedName = getLocalizedText(cat.name_i18n as Record<string, string>, i18n.language);
          const name = getCategoryDisplayName(cat.code, localizedName, i18n.language);

          return (
            <button
              key={cat.id}
              onClick={() => onSelect(isSelected ? undefined : cat.id)}
              className={`w-[76px] min-h-[78px] rounded-2xl border px-2.5 py-2.5 flex flex-col items-center justify-start flex-shrink-0 transition-all duration-200 shadow-sm ${
                isSelected
                  ? 'bg-amber-50 border-amber-200 shadow-amber-100/70'
                  : 'bg-white border-gray-100 hover:border-amber-100 hover:bg-amber-50/40'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-transform duration-200 ${
                  isSelected ? 'bg-white text-orange-500' : 'bg-gray-50 text-gray-700'
                }`}
              >
                {icon}
              </div>
              <span
                className={`mt-1.5 text-[11px] font-medium text-center leading-tight line-clamp-2 min-h-[2rem] ${
                  isSelected ? 'text-orange-600' : 'text-gray-600'
                }`}
              >
                {name}
              </span>
            </button>
          );
        })}
      </div>

      {selectedCategory && (
        <div className="flex justify-end mt-2 mb-1">
          <Link
            to={`/category/${selectedCategory.id}?code=${selectedCategory.code}&name=${encodeURIComponent(
              getLocalizedText(selectedCategory.name_i18n as Record<string, string>, i18n.language)
            )}`}
            className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-orange-600 font-medium border border-orange-100 shadow-sm hover:bg-orange-50 transition-colors"
          >
            {t('common.viewAll') || '查看全部'}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </div>
  );
};

export default CategoryGrid;
