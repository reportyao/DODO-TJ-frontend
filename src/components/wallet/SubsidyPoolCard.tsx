import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { FireIcon } from '@heroicons/react/24/solid';

interface SubsidyData {
  total_pool: number;
  total_issued: number;
  remaining: number;
}

/** 跑马灯单条消息 */
interface MarqueeItem {
  name: string;
  phone: string;
  amount: number;
  bonus: number;
  isReal: boolean;
}

// 塔吉克常见人名（男女混合）
const TAJIK_NAMES = [
  'Фирдавс', 'Мадина', 'Рустам', 'Нигина', 'Фарход',
  'Зарина', 'Бахром', 'Шахло', 'Далер', 'Парвина',
  'Сомон', 'Гулнора', 'Абдулло', 'Дилноза', 'Исмоил',
  'Сарвиноз', 'Шерали', 'Мунира', 'Комрон', 'Фотима',
  'Алишер', 'Лола', 'Сухроб', 'Манижа', 'Бобур',
  'Озода', 'Навруз', 'Тахмина', 'Сиёвуш', 'Малика',
];

// 塔吉克手机号前缀（真实运营商号段）
const PHONE_PREFIXES = ['90', '91', '92', '93', '98', '55', '50', '77'];

/** 生成脱敏手机号 992 9XX ***XX */
function generatePhone(): string {
  const prefix = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
  const d1 = Math.floor(Math.random() * 10);
  const d2 = Math.floor(Math.random() * 10);
  const d3 = Math.floor(Math.random() * 10);
  return `992${prefix}${d1}***${d2}${d3}`;
}

/** 生成假的跑马灯数据 */
function generateFakeItems(count: number): MarqueeItem[] {
  const items: MarqueeItem[] = [];
  // 常见充值金额（偏向真实分布）
  const amounts = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000];
  const weights = [15, 10, 20, 8, 15, 6, 10, 4, 5, 4, 1, 1, 1]; // 小额更常见
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  for (let i = 0; i < count; i++) {
    let r = Math.random() * totalWeight;
    let amount = amounts[0];
    for (let j = 0; j < amounts.length; j++) {
      r -= weights[j];
      if (r <= 0) {
        amount = amounts[j];
        break;
      }
    }
    const name = TAJIK_NAMES[Math.floor(Math.random() * TAJIK_NAMES.length)];
    items.push({
      name,
      phone: generatePhone(),
      amount,
      bonus: Math.floor(amount * 0.5),
      isReal: false,
    });
  }
  return items;
}

/** 格式化数字为千分位 */
function formatFullNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export const SubsidyPoolCard: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<SubsidyData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentMsgIndex, setCurrentMsgIndex] = useState(0);

  useEffect(() => {
    const fetchSubsidyData = async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke('get-subsidy-pool');
        if (!error && result) {
          setData(result);
        }
      } catch (err) {
        console.error('Failed to fetch subsidy pool:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSubsidyData();
  }, []);

  // 生成跑马灯消息列表（真假混合）
  const marqueeItems = useMemo<MarqueeItem[]>(() => {
    // 生成 20 条假数据
    const fakeItems = generateFakeItems(20);
    // 随机打乱
    for (let i = fakeItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fakeItems[i], fakeItems[j]] = [fakeItems[j], fakeItems[i]];
    }
    return fakeItems;
  }, []);

  // 跑马灯自动滚动
  useEffect(() => {
    if (marqueeItems.length === 0) {return;}
    const interval = setInterval(() => {
      setCurrentMsgIndex((prev) => (prev + 1) % marqueeItems.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [marqueeItems.length]);

  // 计算进度百分比（已发放比例，最小显示1%以保证进度条可见）
  const issuedPercent = data
    ? Math.max(1, Math.round((data.total_issued / data.total_pool) * 100))
    : 1;
  // 已发放精确百分比（保留两位小数，用于显示）
  const issuedPercentDisplay = data
    ? ((data.total_issued / data.total_pool) * 100).toFixed(2)
    : '0.00';

  const formatMarqueeText = useCallback((item: MarqueeItem): string => {
    return `${item.name}(${item.phone}) ${t('subsidyPool.marqueeDeposit')} ${item.amount} TJS ${t('subsidyPool.marqueeBonus')} ${item.bonus} ${t('subsidyPool.marqueePoints')}`;
  }, [t]);

  if (isLoading) {
    return (
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl p-4 animate-pulse">
        <div className="h-24"></div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 shadow-lg"
    >
      {/* 背景装饰 */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-6 -translate-x-6" />

      <div className="relative p-4">
        {/* 标题行 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <FireIcon className="w-5 h-5 text-yellow-200" />
            <h3 className="text-white font-bold text-sm">{t('subsidyPool.title')}</h3>
          </div>
          <span className="text-xs text-white/70 bg-white/15 px-2 py-0.5 rounded-full">
            {t('subsidyPool.badgeText')}
          </span>
        </div>

        {/* 金额展示 - 完整数字 */}
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-white/70 text-xs mb-0.5">{t('subsidyPool.remaining')}</p>
            <p className="text-white text-xl font-black tracking-tight">
              {data ? formatFullNumber(data.remaining) : '---'}
              <span className="text-sm font-normal ml-1 opacity-80">TJS</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-white/70 text-xs mb-0.5">{t('subsidyPool.issued')}</p>
            <p className="text-white/90 text-lg font-bold">
              {data ? formatFullNumber(data.total_issued) : '---'}
              <span className="text-xs font-normal ml-0.5 opacity-70">TJS</span>
            </p>
          </div>
        </div>

        {/* 进度条 */}
        <div className="mb-3">
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${issuedPercent}%` }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-yellow-300 to-yellow-100 rounded-full shadow-sm"
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-white/60 text-[10px]">
              {t('subsidyPool.totalPool')}: {formatFullNumber(data?.total_pool || 10_000_000)} TJS
            </span>
            <span className="text-white/60 text-[10px]">{t('subsidyPool.issued')} {issuedPercentDisplay}%</span>
          </div>
        </div>

        {/* 跑马灯 - 替换原来的充值按钮 */}
        <div className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2 border border-white/10 overflow-hidden h-8 relative">
          <AnimatePresence mode="wait">
            {marqueeItems.length > 0 && (
              <motion.div
                key={currentMsgIndex}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
                className="absolute inset-x-3 flex items-center text-white/90 text-xs whitespace-nowrap"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-2 flex-shrink-0 animate-pulse" />
                <span className="truncate">{formatMarqueeText(marqueeItems[currentMsgIndex])}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};
