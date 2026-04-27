/**
 * 希望之树 - 首页浮动入口按钮
 *
 * 挂载在 SceneHomePage，遵循极简加载原则：
 * - 不主动发请求，读取 React Query 缓存
 * - 静态展示优先，仅展示树图标和定期抖动动画
 * - 点击进入种树页面时才发起真实网络请求
 * 增强版：更精美的渐变和阴影效果。
 *
 * 多语言适配：纯图标按钮，无文字，无需适配。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '../../../contexts/UserContext';
import { giftTreeKeys } from '../hooks/useGiftTree';
import type { GiftTreeStatus } from '../types';

const GiftTreeFloatingEntry: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const queryClient = useQueryClient();

  // Read from cache only, don't trigger network request
  const cachedStatus = user?.id
    ? queryClient.getQueryData<GiftTreeStatus>(giftTreeKeys.status(user.id))
    : null;

  const hasTree = cachedStatus?.has_tree;
  const progress = cachedStatus?.tree
    ? Math.round(
        (cachedStatus.tree.current_water / cachedStatus.tree.target_water) * 100
      )
    : null;

  const handleClick = () => {
    if (hasTree) {
      navigate('/gift-tree');
    } else {
      navigate('/gift-tree/select');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="fixed right-4 bottom-24 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-[#4CAF50] via-[#43A047] to-[#2E7D32] shadow-lg shadow-green-900/25 flex items-center justify-center active:scale-90 transition-transform border border-green-400/20"
      aria-label="Hope Tree"
    >
      {/* Pulse ring */}
      <div className="absolute inset-0 rounded-full bg-green-400/25 animate-ping" style={{ animationDuration: '2.5s' }} />

      {/* Tree SVG icon - enhanced */}
      <svg width="28" height="28" viewBox="0 0 32 32" className="relative">
        <path d="M16 28 Q16 22 15 18" stroke="#8D6E63" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse cx="16" cy="12" rx="10" ry="9" fill="white" opacity="0.95" />
        <ellipse cx="12" cy="11" rx="6" ry="6" fill="#A5D6A7" opacity="0.9" />
        <ellipse cx="20" cy="11" rx="6" ry="6" fill="#81C784" opacity="0.9" />
        <ellipse cx="16" cy="8" rx="7" ry="5" fill="#C8E6C9" opacity="0.8" />
        {/* Heart */}
        <path d="M15 14 Q15 12.5 16 13.5 Q17 12.5 17 14 L16 15.5 Z" fill="#E53935" opacity="0.9" />
      </svg>

      {/* Progress badge */}
      {progress !== null && progress > 0 && progress < 100 && (
        <div className="absolute -top-1 -right-1 bg-white text-accent text-[9px] font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-accent/20 shadow-sm tabular-nums">
          {progress}
        </div>
      )}

      {/* New indicator for users without tree */}
      {!hasTree && (
        <div className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-red-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
          NEW
        </div>
      )}
    </button>
  );
};

export default GiftTreeFloatingEntry;
