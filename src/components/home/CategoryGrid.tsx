/**
 * 金刚区 · 一级分类网格
 *
 * 横向滚动的分类入口，支持选中高亮。
 * 设计参考：圆形图标 + 分类名称，单行横滑，选中态带底部指示条。
 *
 * 与现有 ProductList 保持一致的 px-4 外边距和 Tailwind 样式规范。
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalizedText } from '../../lib/utils';
import type { HomeFeedCategory } from '../../types/homepage';

// ============================================================
// 图标映射：code → emoji/图标
// 后续可替换为自定义 SVG 图标
// ============================================================
const CATEGORY_ICON_MAP: Record<string, string> = {
  electronics: '📱',
  home_living: '🏠',
  beauty_care: '💄',
  food_drink: '🍽️',
  fashion: '👗',
  mother_baby: '👶',
  sports_outdoor: '⚽',
  gifts_festival: '🎁',
};

interface CategoryGridProps {
  categories: HomeFeedCategory[];
  selectedId?: string;
  onSelect: (categoryId: string | undefined) => void;
  isLoading?: boolean;
}

export const CategoryGrid: React.FC<CategoryGridProps> = ({
  categories,
  selectedId,
  onSelect,
  isLoading = false,
}) => {
  const { i18n } = useTranslation();

  if (isLoading) {
    return (
      <div className="px-4 mt-3">
        <div className="flex space-x-4 overflow-x-auto scrollbar-hide py-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-col items-center space-y-1.5 flex-shrink-0 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-gray-200" />
              <div className="w-10 h-3 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (categories.length === 0) return null;

  return (
    <div className="px-4 mt-3">
      <div className="flex space-x-3 overflow-x-auto scrollbar-hide py-2 -mx-1 px-1">
        {/* "全部" 按钮 */}
        <button
          onClick={() => onSelect(undefined)}
          className="flex flex-col items-center space-y-1.5 flex-shrink-0 group"
        >
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-200 ${
              !selectedId
                ? 'bg-gradient-to-br from-orange-400 to-red-500 text-white shadow-md scale-105'
                : 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'
            }`}
          >
            🔥
          </div>
          <span
            className={`text-[11px] font-medium whitespace-nowrap transition-colors ${
              !selectedId ? 'text-orange-600' : 'text-gray-500'
            }`}
          >
            全部
          </span>
          {!selectedId && (
            <div className="w-4 h-0.5 rounded-full bg-orange-500" />
          )}
        </button>

        {/* 分类按钮 */}
        {categories.map((cat) => {
          const isSelected = selectedId === cat.id;
          const icon = CATEGORY_ICON_MAP[cat.code] || cat.icon_key || '📦';
          const name = getLocalizedText(cat.name_i18n as Record<string, string>, i18n.language);

          return (
            <button
              key={cat.id}
              onClick={() => onSelect(isSelected ? undefined : cat.id)}
              className="flex flex-col items-center space-y-1.5 flex-shrink-0 group"
            >
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-200 ${
                  isSelected
                    ? 'bg-gradient-to-br from-orange-400 to-red-500 text-white shadow-md scale-105'
                    : 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'
                }`}
              >
                {icon}
              </div>
              <span
                className={`text-[11px] font-medium whitespace-nowrap max-w-[56px] truncate transition-colors ${
                  isSelected ? 'text-orange-600' : 'text-gray-500'
                }`}
              >
                {name}
              </span>
              {isSelected && (
                <div className="w-4 h-0.5 rounded-full bg-orange-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryGrid;
