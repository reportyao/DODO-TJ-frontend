/**
 * CategoryGrid 组件单元测试
 *
 * 覆盖范围：
 * - 分类列表渲染（图标、名称、选中状态）
 * - "全部" 按钮功能
 * - 分类选择/取消选择交互
 * - 选中分类时显示"查看全部"链接
 * - 加载骨架屏
 * - 空数据处理
 * - 图标映射回退
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { screen, fireEvent } from '@testing-library/dom';
import { MemoryRouter } from 'react-router-dom';
import { CategoryGrid } from '../CategoryGrid';
import type { HomeFeedCategory } from '../../../types/homepage';

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.all': '全部',
        'common.viewAll': '查看全部',
      };
      return map[key] || key;
    },
    i18n: { language: 'zh' },
  }),
}));

vi.mock('../../../lib/utils', () => ({
  getLocalizedText: (i18n: Record<string, string>, lang: string) => i18n?.[lang] || i18n?.zh || '',
}));

// ============================================================
// 测试数据
// ============================================================

const mockCategories: HomeFeedCategory[] = [
  {
    id: 'cat-1',
    code: 'daily_goods',
    name_i18n: { zh: '日用百货', ru: 'Товары', tg: 'Молҳо' },
    icon_key: 'icon_daily_goods',
    color_token: '#FF6B35',
    sort_order: 0,
  },
  {
    id: 'cat-2',
    code: 'home_appliance',
    name_i18n: { zh: '家用电器', ru: 'Техника', tg: 'Техника' },
    icon_key: 'icon_home_appliance',
    color_token: '#3B82F6',
    sort_order: 1,
  },
  {
    id: 'cat-3',
    code: 'unknown_code',
    name_i18n: { zh: '未知分类', ru: 'Неизвестно', tg: 'Номаълум' },
    icon_key: 'icon_unknown',
    color_token: '#666666',
    sort_order: 2,
  },
];

// ============================================================
// 辅助函数
// ============================================================

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ============================================================
// 测试
// ============================================================

describe('CategoryGrid', () => {
  describe('基本渲染', () => {
    it('应渲染"全部"按钮和所有分类', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} onSelect={onSelect} />
      );

      expect(screen.getByText('全部')).toBeInTheDocument();
      expect(screen.getByText('日用百货')).toBeInTheDocument();
      expect(screen.getByText('家用电器')).toBeInTheDocument();
      expect(screen.getByText('未知分类')).toBeInTheDocument();
    });

    it('应为已知分类显示正确的 emoji 图标', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} onSelect={onSelect} />
      );

      // 🔥 是"全部"按钮的图标
      expect(screen.getByText('🔥')).toBeInTheDocument();
      // 🏠 是 daily_goods 的图标
      expect(screen.getByText('🏠')).toBeInTheDocument();
      // 📺 是 home_appliance 的图标
      expect(screen.getByText('📺')).toBeInTheDocument();
    });

    it('未知分类 code 应回退到默认 📦 图标', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} onSelect={onSelect} />
      );

      expect(screen.getByText('📦')).toBeInTheDocument();
    });
  });

  describe('选择交互', () => {
    it('点击分类应调用 onSelect 并传递分类 ID', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} onSelect={onSelect} />
      );

      fireEvent.click(screen.getByText('日用百货'));
      expect(onSelect).toHaveBeenCalledWith('cat-1');
    });

    it('点击已选中的分类应取消选择（传递 undefined）', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} selectedId="cat-1" onSelect={onSelect} />
      );

      fireEvent.click(screen.getByText('日用百货'));
      expect(onSelect).toHaveBeenCalledWith(undefined);
    });

    it('点击"全部"按钮应传递 undefined', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} selectedId="cat-1" onSelect={onSelect} />
      );

      fireEvent.click(screen.getByText('全部'));
      expect(onSelect).toHaveBeenCalledWith(undefined);
    });
  });

  describe('选中状态', () => {
    it('未选中任何分类时"全部"按钮应高亮', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} onSelect={onSelect} />
      );

      const allButton = screen.getByText('🔥').closest('div');
      expect(allButton?.className).toContain('from-orange-400');
    });

    it('选中分类时应显示"查看全部"链接', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} selectedId="cat-1" onSelect={onSelect} />
      );

      const viewAllLink = screen.getByText(/查看全部/);
      expect(viewAllLink).toBeInTheDocument();
      expect(viewAllLink.closest('a')).toHaveAttribute(
        'href',
        expect.stringContaining('/category/cat-1')
      );
    });

    it('未选中分类时不应显示"查看全部"链接', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} onSelect={onSelect} />
      );

      expect(screen.queryByText(/查看全部/)).not.toBeInTheDocument();
    });
  });

  describe('加载状态', () => {
    it('isLoading 为 true 时应显示骨架屏', () => {
      const onSelect = vi.fn();
      const { container } = renderWithRouter(
        <CategoryGrid categories={[]} isLoading={true} onSelect={onSelect} />
      );

      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('isLoading 为 true 时不应显示分类按钮', () => {
      const onSelect = vi.fn();
      renderWithRouter(
        <CategoryGrid categories={mockCategories} isLoading={true} onSelect={onSelect} />
      );

      expect(screen.queryByText('日用百货')).not.toBeInTheDocument();
    });
  });

  describe('空数据', () => {
    it('分类列表为空时不应渲染任何内容', () => {
      const onSelect = vi.fn();
      const { container } = renderWithRouter(
        <CategoryGrid categories={[]} onSelect={onSelect} />
      );

      expect(container.firstChild).toBeNull();
    });
  });
});
