/**
 * 希望之树 - 首页浮动入口按钮
 *
 * 挂载在 SceneHomePage，遵循极简加载原则：
 * - 不主动发请求，读取 React Query 缓存
 * - 静态展示优先，仅展示树图标和定期抖动动画
 * - 点击进入种树页面时才发起真实网络请求
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
      className="fixed right-4 bottom-24 z-40 w-14 h-14 rounded-full bg-white shadow-lg border border-primary/20 flex items-center justify-center animate-bounce-slow active:scale-90 transition-transform"
      style={{ animationDuration: '3s' }}
      aria-label="Hope Tree"
    >
      <span className="text-2xl">🌳</span>
      {/* Progress badge */}
      {progress !== null && progress > 0 && progress < 100 && (
        <div className="absolute -top-1 -right-1 bg-accent text-white text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
          {progress}%
        </div>
      )}
      {/* New indicator for users without tree */}
      {!hasTree && (
        <div className="absolute -top-1 -right-1 bg-destructive text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">
          NEW
        </div>
      )}

      {/* CSS for slow bounce */}
      <style>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 3s ease-in-out infinite;
        }
      `}</style>
    </button>
  );
};

export default GiftTreeFloatingEntry;
