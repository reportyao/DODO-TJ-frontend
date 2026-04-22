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
  source: 'real' | 'synthetic';
}

interface MarqueeResponse {
  items: Array<MarqueeItem & { created_at?: string }>;
}

const TAJIK_NAMES = [
  'Рустам', 'Фаридун', 'Исмоил', 'Саид', 'Абдулло', 'Шахром', 'Алишер', 'Сорбон',
  'Наврӯз', 'Далер', 'Фирӯз', 'Бахтиёр', 'Зуҳур', 'Парвиз', 'Муҳаммад', 'Комрон',
  'Меҳрона', 'Мадина', 'Шаҳноза', 'Нилуфар', 'Фотима', 'Ситора', 'Муниса', 'Зарина',
  'Гулнора', 'Меҳринисо', 'Сабрина', 'Рухшона', 'Лайло', 'Мафтуна',
];

const PHONE_PREFIXES = ['90', '91', '92', '93', '98', '55', '50', '77'];
const AMOUNT_OPTIONS = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000];
const AMOUNT_WEIGHTS = [20, 18, 20, 12, 14, 10, 10, 6, 5, 4, 3, 2, 2, 1, 1];
const MIN_AMOUNT = 100;
const MAX_AMOUNT = 3000;

function formatFullNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function generatePhone(): string {
  const prefix = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
  const d1 = Math.floor(Math.random() * 10);
  const d2 = Math.floor(Math.random() * 10);
  const d3 = Math.floor(Math.random() * 10);
  return `992${prefix}${d1}***${d2}${d3}`;
}

function pickWeightedAmount(): number {
  const totalWeight = AMOUNT_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let random = Math.random() * totalWeight;

  for (let index = 0; index < AMOUNT_OPTIONS.length; index += 1) {
    random -= AMOUNT_WEIGHTS[index];
    if (random <= 0) {
      return AMOUNT_OPTIONS[index];
    }
  }

  return 200;
}

function shuffleArray<T>(items: T[]): T[] {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

function normalizeItem(item: Partial<MarqueeItem> | null | undefined): MarqueeItem | null {
  if (!item) {return null;}

  const amount = Math.round(Number(item.amount));
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return null;
  }

  const cleanName = String(item.name || '').trim().slice(0, 24);
  const cleanPhone = String(item.phone || '').trim().slice(0, 20);
  if (!cleanName || !cleanPhone) {
    return null;
  }

  return {
    name: cleanName,
    phone: cleanPhone,
    amount,
    bonus: Math.round(amount * 0.5),
    source: item.source === 'real' ? 'real' : 'synthetic',
  };
}

function generateSyntheticItem(): MarqueeItem {
  const amount = pickWeightedAmount();
  return {
    name: TAJIK_NAMES[Math.floor(Math.random() * TAJIK_NAMES.length)],
    phone: generatePhone(),
    amount,
    bonus: Math.round(amount * 0.5),
    source: 'synthetic',
  };
}

function buildMixedBatch(realItems: MarqueeItem[], size: number): MarqueeItem[] {
  const normalizedRealItems = realItems
    .map((item) => normalizeItem(item))
    .filter((item): item is MarqueeItem => Boolean(item));

  const desiredRealCount = normalizedRealItems.length > 0
    ? Math.min(normalizedRealItems.length, Math.max(2, Math.round(size * 0.35)))
    : 0;

  const pickedReal = shuffleArray(normalizedRealItems).slice(0, desiredRealCount);
  const syntheticCount = Math.max(0, size - pickedReal.length);
  const syntheticItems = Array.from({ length: syntheticCount }, () => generateSyntheticItem());

  return shuffleArray([...pickedReal, ...syntheticItems]);
}

/**
 * 首页补贴池横条（真实数据混合版）
 *
 * 设计原则：
 * - 跑马灯优先混入真实已批准充值样本，但必须先脱敏
 * - 其余内容采用受约束的本地化随机生成，避免反复出现不可信或离谱大额
 * - 随着轮播推进，持续补充新的混合批次，形成“不断随机生成”的效果
 */
export const SubsidyPoolBanner: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [currentItem, setCurrentItem] = useState<MarqueeItem | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<MarqueeItem[]>([]);
  const pointerRef = useRef(0);

  const { data: subsidyData } = useQuery<SubsidyData | null>({
    queryKey: ['subsidy-pool'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-subsidy-pool');
        if (!error && data) {return data;}
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

  const { data: marqueeResponse } = useQuery<MarqueeResponse | null>({
    queryKey: ['subsidy-marquee'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-subsidy-marquee', {
          method: 'GET',
        });
        if (!error && data) {return data as MarqueeResponse;}
        return null;
      } catch (error) {
        console.error('Failed to fetch subsidy marquee seeds:', error);
        return null;
      }
    },
    staleTime: staleTimes.static,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });

  const realItems = useMemo(() => {
    return (marqueeResponse?.items || [])
      .map((item) => normalizeItem({ ...item, source: 'real' }))
      .filter((item): item is MarqueeItem => Boolean(item));
  }, [marqueeResponse]);

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
    const initialQueue = buildMixedBatch(realItems, 16);
    queueRef.current = initialQueue;
    pointerRef.current = initialQueue.length > 0 ? 1 : 0;
    setCurrentItem(initialQueue[0] || null);
  }, [realItems]);

  useEffect(() => {
    if (!isVisible) {return;}

    const interval = setInterval(() => {
      if (queueRef.current.length - pointerRef.current < 6) {
        queueRef.current = [...queueRef.current, ...buildMixedBatch(realItems, 10)];
      }

      const nextItem = queueRef.current[pointerRef.current] || generateSyntheticItem();
      setCurrentItem(nextItem);
      pointerRef.current += 1;

      if (pointerRef.current > 24) {
        queueRef.current = queueRef.current.slice(pointerRef.current - 1);
        pointerRef.current = 1;
      }
    }, 3200);

    return () => clearInterval(interval);
  }, [isVisible, realItems]);

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
                {subsidyData ? formatFullNumber(subsidyData.remaining) : '---'}
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
                key={`${currentItem.phone}-${currentItem.amount}-${currentItem.source}`}
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
