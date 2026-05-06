/**
 * B2B 批发商专属底部导航
 * Phase 4: 前端核心展示层
 *
 * 当用户是已认证批发商时，替换默认的 BottomNavigation
 * Tab: 进货 | 进货单 | 订单 | 我的
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BuildingStorefrontIcon,
  ShoppingCartIcon,
  ClipboardDocumentListIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import {
  BuildingStorefrontIcon as BuildingStorefrontIconSolid,
  ShoppingCartIcon as ShoppingCartIconSolid,
  ClipboardDocumentListIcon as ClipboardDocumentListIconSolid,
  UserIcon as UserIconSolid,
} from '@heroicons/react/24/solid';
import { cn } from '../../lib/utils';
import { useB2BCart } from '../../hooks/useB2B';

export const B2BBottomNavigation: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: cartItems } = useB2BCart();

  const cartCount = cartItems?.length || 0;

  const navigation = [
    {
      name: t('b2b.home'),
      path: '/b2b',
      icon: BuildingStorefrontIcon,
      activeIcon: BuildingStorefrontIconSolid,
    },
    {
      name: t('b2b.cart'),
      path: '/b2b/cart',
      icon: ShoppingCartIcon,
      activeIcon: ShoppingCartIconSolid,
      badge: cartCount,
    },
    {
      name: t('b2b.myOrders'),
      path: '/b2b/orders',
      icon: ClipboardDocumentListIcon,
      activeIcon: ClipboardDocumentListIconSolid,
    },
    {
      name: t('nav.profile'),
      path: '/profile',
      icon: UserIcon,
      activeIcon: UserIconSolid,
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-md mx-auto px-3 py-1.5">
        <div className="grid grid-cols-4 gap-1">
          {navigation.map((item) => {
            const isActive =
              location.pathname === item.path ||
              (item.path !== '/b2b' && location.pathname.startsWith(`${item.path}`));
            const Icon = isActive ? item.activeIcon : item.icon;

            return (
              <button
                key={item.name}
                onClick={() => navigate(item.path)}
                className={cn(
                  'flex min-w-0 flex-col items-center py-1.5 px-1 rounded-xl transition-all duration-200 active:scale-95',
                  isActive
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                <div className="relative">
                  <Icon className="w-6 h-6" />
                  {item.badge && item.badge > 0 && (
                    <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                  {isActive && (
                    <div className="absolute -inset-1 bg-blue-100 rounded-lg -z-10" />
                  )}
                </div>
                <span
                  className={cn(
                    'mt-1 text-[11px] leading-none font-medium truncate max-w-full',
                    isActive ? 'text-blue-600' : 'text-gray-600'
                  )}
                >
                  {item.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
