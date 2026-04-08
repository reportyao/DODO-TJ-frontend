/**
 * 分类图标映射
 *
 * 统一维护 homepage_categories.code → emoji 的映射关系，
 * 避免在 CategoryGrid、CategoryProductsPage 等多处重复定义。
 *
 * key 与种子数据 homepage_categories.code 对齐。
 * 后续可替换为自定义 SVG 图标。
 */
export const CATEGORY_ICON_MAP: Record<string, string> = {
  daily_goods: '🏠',       // 日用百货
  home_appliance: '📺',    // 家用电器
  food_kitchen: '🍽️',     // 食品厨房
  personal_care: '💄',     // 个护美妆
  clothing_bags: '👗',     // 服饰箱包
  digital_tech: '📱',      // 数码科技
  mother_baby: '👶',       // 母婴亲子
  sports_outdoor: '⚽',    // 运动户外
};

/** 获取分类图标，未匹配时返回默认图标 */
export function getCategoryIcon(code: string): string {
  return CATEGORY_ICON_MAP[code] || '📦';
}
