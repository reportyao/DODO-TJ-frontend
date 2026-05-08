/**
 * B2B 底部导航 (兼容别名)
 *
 * 历史上 B2B 模式与普通模式有不同的底部导航。
 * 现已全站统一为三项：首页 / 购物车 / 我的。
 * 这里直接复用 BottomNavigation，保留命名仅为避免外部 import 改动遗漏。
 */
import React from 'react'
import { BottomNavigation } from './BottomNavigation'

export const B2BBottomNavigation: React.FC = () => {
  return <BottomNavigation />
}

export default B2BBottomNavigation
