import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { FireIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';
import { staleTimes } from '../../lib/react-query';

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

const TAJIK_NAMES = [
  'Рустам', 'Фаридун', 'Исмоил', 'Саид', 'Мухаммад', 'Абдулло', 'Шахром', 'Алишер',
  'Сорбон', 'Наврӯз', 'Далер', 'Темур', 'Фирӯз', 'Парвиз', 'Бахтиёр', 'Зуҳур',
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
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  for (let i = 0; i < count; i += 1) {
    let random = Math.random() * totalWeight;
    let amount = amounts[0];

    for (let j = 0; j < amounts.length; j += 1) {
      random -= weights[j];
      if (random <= 0) {
        amount = amounts[j];
        break;
      }
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
 * 首页补贴池横条（柔和版）
 *
 * 保留原有核心能力：
 * - 展示补贴池剩余额度
 * - 保留“立即充值”入口
 * - 恢复跑马灯式充值播报文案
 *
 * 同时降低视觉刺激：
 * - 从高饱和渐变改为浅暖色卡片
 * - 将跑马灯放入浅色信息条，减少首屏噪音
 */
export const SubsidyPoolBanner: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentMsgIndex, setCurrentMsgIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery<SubsidyData | null>({
    queryKey: ['subsidy-pool'],
    queryFn: async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke('get-subsidy-pool');
        if (!error && result) {return result;}
        return null;
      } catch (error) {
        console.error('Failed to fetch subsidy pool:', error);
        return null;
      }
    },
    staleTime: staleTimes.static,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });

  const marqueeItemsRef = useRef<MarqueeItem[]>(generateFakeItems(15));
  const marqueeItems = marqueeItemsRef.current;

  const currentItem = useMemo(
    () => (marqueeItems.length > 0 ? marqueeItems[currentMsgIndex] : null),
    [currentMsgIndex, marqueeItems],
  );

  useEffect(() => {
    const element = bannerRef.current;
    if (!element) {return;}

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || marqueeItems.length === 0) {return;}

    const interval = setInterval(() => {
      setCurrentMsgIndex((prev) => (prev + 1) % marqueeItems.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isVisible, marqueeItems.length]);

  return (
    <div
      ref={bannerRef}
      onClick={() => navigate('/wallet')}
      className="mx-4 mt-3 overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-r from-[#fffaf0] via-white to-[#fff8ef] shadow-sm cursor-pointer active:scale-[0.99] transition-transform duration-200"
    >
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center flex-shrink-0">
            <FireIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-amber-700/70 leading-none">
              {t('subsidyPool.remaining')}
            </p>
            <div className="mt-1 flex items-baseline gap-1.5 min-w-0">
              <span className="text-base font-bold text-slate-900 truncate">
                {data ? formatFullNumber(data.remaining) : '---'}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700/60">
                TJS
              </span>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 rounded-full border border-amber-200 bg-amber-50/80 px-3 py-1.5 text-[11px] font-semibold text-amber-700 whitespace-nowrap">
          {t('subsidyPool.depositNow')} →
        </div>
      </div>

      <div className="px-3.5 pb-3">
        <div className="flex items-center gap-2 rounded-xl border border-amber-100/80 bg-amber-50/65 px-3 py-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse" />
          <div className="relative h-4 flex-1 overflow-hidden">
            {currentItem && (
              <div
                key={currentMsgIndex}
                className="absolute inset-0 flex items-center text-[11px] text-amber-900/75 whitespace-nowrap transition-opacity duration-300"
              >
                <span className="truncate">
                  {currentItem.name}
                  ({currentItem.phone})
                  {' '}
                  {t('subsidyPool.marqueeDeposit')}
                  {' '}
                  {currentItem.amount} TJS
                  {' '}
                  {t('subsidyPool.marqueeBonus')}
                  {' '}
                  {currentItem.bonus}
                  {' '}
                  {t('subsidyPool.marqueePoints')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubsidyPoolBanner;
