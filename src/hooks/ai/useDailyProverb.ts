import { useState, useEffect } from 'react';
import { proverbs, type Proverb } from '../../data/proverbs';

// 简单哈希函数
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export function useDailyProverb() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 获取用户ID (从localStorage或context)
    const getUserId = () => {
      try {
        // 优先读取迁移后的 custom_user，兼容旧版 user 存储键
        const userStr = localStorage.getItem('custom_user') || localStorage.getItem('user');
        if (userStr) {
          const user = JSON.parse(userStr);
          return user.id || 0;
        }
      } catch (error) {
        console.error('Error getting user ID:', error);
      }
      return 0;
    };

    const userId = getUserId();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // 基于用户ID和日期计算哈希值
    const hash = simpleHash(`${userId}-${today}`);
    const index = hash % proverbs.length;
    
    setCurrentIndex(index);
    setLoading(false);
  }, []);

  const nextProverb = () => {
    setCurrentIndex((prev) => (prev + 1) % proverbs.length);
  };

  const prevProverb = () => {
    setCurrentIndex((prev) => (prev - 1 + proverbs.length) % proverbs.length);
  };

  return {
    proverb: proverbs[currentIndex],
    nextProverb,
    prevProverb,
    loading
  };
}
