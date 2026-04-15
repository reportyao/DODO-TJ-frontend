import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { staleTimes } from '../../lib/react-query';
import { FireIcon } from '@heroicons/react/24/solid';

interface SubsidyData {
  total_pool: number;
  total_issued: number;
  remaining: number;
}

interface MarqueeItem {
  name: string;
  phone: string;
  amount: number;
  bonus: number;
}

// 塔吉克常见人名
const TAJIK_NAMES = [
  'Фирдавс', 'Мадина', 'Рустам', 'Нигина', 'Фарход',
  'Зарина', 'Бахром', 'Шахло', 'Далер', 'Парвина',
  'Сомон', 'Гулнора', 'Абдулло', 'Дилноза', 'Исмоил',
  'Сарвиноз', 'Шерали', 'Мунира', 'Комрон', 'Фотима',
  'Алишер', 'Лола', 'Сухроб', 'Манижа', 'Бобур',
];

const PHONE_PREFIXES = ['90', '91', '92', '93', '98', '55', '50', '77'];

function generatePhone(): string {
  const prefix = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
  const d1 = Math.floor(Math.random() * 10);
  const d2 = Math.floor(Math.random() * 10);
  const d3 = Math.floor(Math.random() * 10);
  return `992${prefix}${d1}***${d2}${d3}`;
}

function generateFakeItems(count: number): MarqueeItem[] {
  const items: MarqueeItem[] = [];
  const amounts = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000];
  const weights = [15, 10, 20, 8, 15, 6, 10, 4, 5, 4, 2, 1];
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  for (let i = 0; i < count; i++) {
    let r = Math.random() * totalWeight;
    let amount = amounts[0];
    for (let j = 0; j < amounts.length; j++) {
      r -= weights[j];
      if (r <= 0) { amount = amounts[j]; break; }
    }
    items.push({
      name: TAJIK_NAMES[Math.floor(Math.random() * TAJIK_NAMES.length)],
      phone: generatePhone(),
      amount,
      bonus: Math.floor(amount * 0.5),
    });
  }
  return items;
}

function formatFullNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * 首页精简版补贴池横条
 * 展示在 Banner 下方、商品列表上方
 * 包含：补贴池图标 + 剩余金额 + 跑马灯
 * 点击跳转到钱包页
 *
 * [v2 性能优化]
 * - 使用 react-query 管理缓存（10 分钟 staleTime），避免每次进入首页都重新请求
 * - 跑马灯 items 使用 useRef 保持稳定引用，避免不必要的重渲染
 * - 跑马灯 interval 只在组件可见时运行（IntersectionObserver）
 */
export const SubsidyPoolBanner: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentMsgIndex, setCurrentMsgIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  // [v2] 使用 react-query 缓存补贴池数据，10 分钟内不重复请求
  const { data } = useQuery<SubsidyData | null>({
    queryKey: ['subsidy-pool'],
    queryFn: async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke('get-subsidy-pool');
        if (!error && result) return result;
        return null;
      } catch (err) {
        console.error('Failed to fetch subsidy pool:', err);
        return null;
      }
    },
    staleTime: staleTimes.static, // 30 分钟
    gcTime: 1000 * 60 * 60, // 缓存保留 1 小时
    refetchOnWindowFocus: false,
  });

  // 跑马灯数据使用 useRef 保持稳定引用
  const marqueeItemsRef = useRef<MarqueeItem[]>(generateFakeItems(15));
  const marqueeItems = marqueeItemsRef.current;
  const currentItem = useMemo(
    () => (marqueeItems.length > 0 ? marqueeItems[currentMsgIndex] : null),
    [currentMsgIndex, marqueeItems],
  );

  // [v2] 使用 IntersectionObserver 检测可见性，不可见时暂停跑马灯
  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 跑马灯定时器 - 仅在可见时运行
  useEffect(() => {
    if (marqueeItems.length === 0 || !isVisible) return;
    const interval = setInterval(() => {
      setCurrentMsgIndex((prev) => (prev + 1) % marqueeItems.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [marqueeItems.length, isVisible]);

  return (
    <div
      ref={bannerRef}
      onClick={() => navigate('/wallet')}
      className="mx-4 mt-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 shadow-md cursor-pointer active:scale-[0.98] transition-transform duration-200"
    >
      <div className="flex items-center px-3 py-2.5 space-x-2.5">
        {/* 左侧：图标 + 剩余金额 */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          <FireIcon className="w-4 h-4 text-yellow-200" />
          <span className="text-white font-bold text-xs whitespace-nowrap">
            {data ? formatFullNumber(data.remaining) : '---'}
          </span>
          <span className="text-white/70 text-[10px]">TJS</span>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-4 bg-white/30 flex-shrink-0" />

        {/* 右侧：跑马灯 */}
        <div className="flex-1 overflow-hidden h-5 relative">
          {currentItem && (
            <div
              key={currentMsgIndex}
              className="absolute inset-0 flex items-center text-white/90 text-[11px] whitespace-nowrap transition-opacity duration-300"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 flex-shrink-0 animate-pulse" />
              <span className="truncate">
                {currentItem.name}
                ({currentItem.phone})
                {' '}{t('subsidyPool.marqueeDeposit')}{' '}
                {currentItem.amount} TJS{' '}
                {t('subsidyPool.marqueeBonus')}{' '}
                {currentItem.bonus}{' '}
                {t('subsidyPool.marqueePoints')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
