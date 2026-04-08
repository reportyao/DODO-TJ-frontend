/**
 * 金刚区 · 一级分类网格
 *
 * 横向滚动的分类入口，支持选中高亮。
 * 设计参考：圆形图标 + 分类名称，单行横滑，选中态带底部指示条。
 *
 * 交互逻辑：
 * - 点击分类：在首页内筛选该分类的商品
 * - 选中状态下显示"查看全部 >"链接，点击进入独立的分类商品列表页
 *
 * 与现有 ProductList 保持一致的 px-4 外边距和 Tailwind 样式规范。
 *
 * [审查修复]
 * - CATEGORY_ICON_MAP 的 key 与种子数据 homepage_categories.code 不匹配
 * [遗漏修复]
 * - 新增分类落地页入口（"查看全部 >"），链接到 /category/:categoryId
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
            {t('common.all') || '全部'}
          </span>
          {!selectedId && (
            <div className="w-4 h-0.5 rounded-full bg-orange-500" />
          )}
        </button>

        {/* 分类按钮 */}
        {categories.map((cat) => {
          const isSelected = selectedId === cat.id;
          // [审查修复] icon_key 在种子数据中是 icon_daily_goods 等字符串，不是 emoji，
          // 因此 fallback 不应直接显示 icon_key，而应回退到默认 emoji
          const icon = getCategoryIcon(cat.code);
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
