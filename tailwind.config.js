/**
 * DODO App Tailwind CSS 配色规范
 * ================================
 *
 * 【品牌配色体系】
 *
 * 1. 主色 (Primary) — 暗金色系
 *    - primary:       #B8860B  → 按钮、品牌元素、选中态、导航高亮
 *    - primary-light: #E0B98A  → 背景渐变、卡片高亮、hover 态、浅色标签
 *    - primary-dark:  #8B6914  → 按钮 pressed 态、深色强调
 *    - primary-foreground: #FFFFFF → 主色上的文本（仅用于深色主色背景）
 *    ⚠️ 注意：primary-light (#E0B98A) 亮度较高，上面的文本必须用深色 (#333333)
 *
 * 2. 辅助色 (Accent) — 宝石绿
 *    - accent:        #006B6B  → 次要按钮、CTA、强调链接、充值相关
 *    - accent-light:  #E0F2F1  → 宝石绿浅色背景
 *    - accent-foreground: #FFFFFF → 辅助色上的文本
 *
 * 3. 功能色 (Semantic)
 *    - success:       #2E7D32  → 成功状态、已完成、正向操作
 *    - warning:       #E65100  → 警告状态、待处理、需注意
 *    - error/destructive: #C62828 → 错误状态、删除、危险操作
 *
 * 4. 中性色 (Neutral)
 *    - background:    #FDFDFD  → 页面背景
 *    - foreground:    #333333  → 主要文本（炭黑）
 *    - muted:         #F5F5F5  → 次要背景、禁用态背景
 *    - muted-foreground: #757575 → 次要文本、描述、提示
 *    - border:        #E5E7EB  → 边框、分割线
 *    - input:         #E5E7EB  → 输入框边框
 *
 * 【使用规则】
 *
 * ✅ 正确用法：
 *   - 主按钮: bg-primary text-white → 暗金色背景 + 白色文本
 *   - 次要按钮: bg-accent text-white → 宝石绿背景 + 白色文本
 *   - 浅色标签: bg-primary-light text-foreground → 浅金沙背景 + 深色文本
 *   - 成功提示: text-success → 深绿色文本
 *   - 错误提示: text-destructive → 深红色文本
 *   - 页面背景: bg-background → 米白色
 *   - 卡片: bg-card → 白色
 *
 * ❌ 禁止用法：
 *   - 不要使用 blue-xxx 系列（已从品牌色中移除）
 *   - 不要使用 purple-xxx 系列（已从品牌色中移除）
 *   - 不要使用 pink-xxx 系列（已从品牌色中移除）
 *   - 不要在 primary-light 背景上使用白色文本（对比度不足）
 *
 * 【渐变规范】
 *   - 品牌渐变: from-primary to-primary-dark → 金色渐变
 *   - 高亮渐变: from-primary-light to-primary → 浅金到深金
 *   - 辅助渐变: from-accent to-teal-800 → 宝石绿渐变
 *
 * @type {import("tailwindcss").Config}
 */
module.exports = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        /* ── 中性色（通过 CSS 变量，支持亮/暗模式切换） ── */
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        /* ── 主色：暗金色系 ── */
        primary: {
          DEFAULT: "#B8860B",       /* 暗金色 — 按钮、品牌元素、选中态 */
          light: "#E0B98A",         /* 浅金沙 — 背景渐变、卡片高亮、hover */
          dark: "#8B6914",          /* 深金色 — pressed 态、深色强调 */
          foreground: "#FFFFFF",    /* 主色上的文本 */
        },

        /* ── 辅助色：宝石绿 ── */
        accent: {
          DEFAULT: "#006B6B",       /* 宝石绿 — 次要按钮、CTA、强调 */
          light: "#E0F2F1",         /* 宝石绿浅色背景 */
          foreground: "#FFFFFF",    /* 辅助色上的文本 */
        },

        /* ── 功能色 ── */
        success: {
          DEFAULT: "#2E7D32",       /* 成功 — 深绿 (on-bg 5.04:1 ✅) */
          light: "#E8F5E9",         /* 成功浅色背景 */
        },
        warning: {
          DEFAULT: "#E65100",       /* 警告 — 深橙 (on-bg 3.73:1, 仅用于图标/大文本) */
          light: "#FFF3E0",         /* 警告浅色背景 */
        },
        destructive: {
          DEFAULT: "#C62828",       /* 错误/危险 — 深红 (on-bg 5.53:1 ✅) */
          light: "#FFEBEE",         /* 错误浅色背景 */
          foreground: "#FFFFFF",    /* 错误色上的文本 */
        },

        /* ── 次要/静音色 ── */
        secondary: {
          DEFAULT: "#F5F5F5",       /* 次要背景色 */
          foreground: "#333333",    /* 次要背景上的文本 */
        },
        muted: {
          DEFAULT: "#F5F5F5",       /* 静音背景 */
          foreground: "#757575",    /* 次要文本 (on-bg 4.53:1 ✅) */
        },

        /* ── 卡片/弹出层 ── */
        popover: {
          DEFAULT: "#FFFFFF",
          foreground: "#333333",
        },
        card: {
          DEFAULT: "#FFFFFF",
          foreground: "#333333",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  safelist: [
    /* 功能色 safelist — 确保动态类名能被正确编译 */
    "bg-success",
    "bg-warning",
    "bg-destructive",
    "text-success",
    "text-warning",
    "text-destructive",
    "border-success",
    "border-warning",
    "border-destructive",
  ],
  plugins: [require("tailwindcss-animate")],
}
