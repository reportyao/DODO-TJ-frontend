/**
 * 金刚区 · 一级分类网格
 *
 * 横向滚动的分类入口，支持选中高亮。
 * 设计：纯图标 + 分类名称，单行横滑。
 * 选中态：文字变为主题色 + 底部下划线（无背景圆圈变化）。
 *
 * 多语言优化：
 * - 去掉 truncate / max-width 限制，允许文字自然换行（最多2行）
 * - 使用 text-center + min-w 保证布局稳定
 *
 * 交互逻辑：
 * - 点击分类：在首页内筛选该分类的商品
 * - 选中状态下显示"查看全部 >"链接，点击进入独立的分类商品列表页
 *
 * 与现有 ProductList 保持一致的 px-4 外边距和 Tailwind 样式规范。
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

export const CategoryGrid: React.FC<CategoryGridProps> = ({
  categories,
  selectedId,
  onSelect,
  isLoading = false,
}) => {
  const { i18n, t } = useTranslation();

  // 获取当前选中分类的信息（用于"查看全部"链接）
  const selectedCategory = selectedId
    ? categories.find((c) => c.id === selectedId)
    : undefined;

  if (isLoading) {
    return (
      <div className="px-4 mt-3">
        <div className="flex space-x-4 overflow-x-auto scrollbar-hide py-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-col items-center space-y-1.5 flex-shrink-0 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-gray-200" />
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
      <div className="flex space-x-4 overflow-x-auto scrollbar-hide py-2 -mx-1 px-1">
        {/* "全部" 按钮 */}
        <button
          onClick={() => onSelect(undefined)}
          className="flex flex-col items-center flex-shrink-0 group"
          style={{ minWidth: 48 }}
        >
          {/* 图标 - 无背景圆，仅显示 emoji */}
          <div className="w-10 h-10 flex items-center justify-center text-2xl transition-transform duration-200 group-hover:scale-110">
            🔥
          </div>
          {/* 文字 + 下划线 */}
          <span
            className={`text-[11px] font-medium text-center leading-tight mt-1 transition-colors pb-1 ${
              !selectedId
                ? 'text-orange-600 border-b-2 border-orange-500'
                : 'text-gray-500 border-b-2 border-transparent'
            }`}
          >
            {t('common.all') || '全部'}
          </span>
        </button>

        {/* 分类按钮 */}
        {categories.map((cat) => {
          const isSelected = selectedId === cat.id;
          const icon = getCategoryIcon(cat.code);
          const name = getLocalizedText(cat.name_i18n as Record<string, string>, i18n.language);

          return (
            <button
              key={cat.id}
              onClick={() => onSelect(isSelected ? undefined : cat.id)}
              className="flex flex-col items-center flex-shrink-0 group"
              style={{ minWidth: 48 }}
            >
              {/* 图标 - 无背景圆，仅显示 emoji */}
              <div className="w-10 h-10 flex items-center justify-center text-2xl transition-transform duration-200 group-hover:scale-110">
                {icon}
              </div>
              {/* 文字 - 允许自然显示，不截断；选中时显示下划线 */}
              <span
                className={`text-[11px] font-medium text-center leading-tight mt-1 transition-colors whitespace-nowrap pb-1 ${
                  isSelected
                    ? 'text-orange-600 border-b-2 border-orange-500'
                    : 'text-gray-500 border-b-2 border-transparent'
                }`}
              >
                {name}
              </span>
            </button>
          );
        })}
      </div>

      {/* 选中分类时显示"查看全部"入口，链接到独立的分类商品列表页 */}
      {selectedCategory && (
        <div className="flex justify-end mt-1 mb-1">
          <Link
            to={`/category/${selectedCategory.id}?code=${selectedCategory.code}&name=${encodeURIComponent(
              getLocalizedText(selectedCategory.name_i18n as Record<string, string>, i18n.language)
            )}`}
            className="text-xs text-orange-500 font-medium hover:text-orange-600 transition-colors"
          >
            {t('common.viewAll') || '查看全部'} →
          </Link>
        </div>
      )}
    </div>
  );
};

export default CategoryGrid;
