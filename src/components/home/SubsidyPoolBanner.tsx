import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
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
 */
export const SubsidyPoolBanner: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<SubsidyData | null>(null);
  const [currentMsgIndex, setCurrentMsgIndex] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke('get-subsidy-pool');
        if (!error && result) setData(result);
      } catch (err) {
        console.error('Failed to fetch subsidy pool:', err);
      }
    };
    fetchData();
  }, []);

  const marqueeItems = useMemo(() => generateFakeItems(15), []);

  useEffect(() => {
    if (marqueeItems.length === 0) return;
    const interval = setInterval(() => {
      setCurrentMsgIndex((prev) => (prev + 1) % marqueeItems.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [marqueeItems.length]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate('/wallet')}
      className="mx-4 mt-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 shadow-md cursor-pointer active:scale-[0.98] transition-transform"
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
          <AnimatePresence mode="wait">
            {marqueeItems.length > 0 && (
              <motion.div
                key={currentMsgIndex}
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -16, opacity: 0 }}
                transition={{ duration: 0.35, ease: 'easeInOut' }}
                className="absolute inset-0 flex items-center text-white/90 text-[11px] whitespace-nowrap"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 flex-shrink-0 animate-pulse" />
                <span className="truncate">
                  {marqueeItems[currentMsgIndex].name}
                  ({marqueeItems[currentMsgIndex].phone})
                  {' '}{t('subsidyPool.marqueeDeposit')}{' '}
                  {marqueeItems[currentMsgIndex].amount} TJS{' '}
                  {t('subsidyPool.marqueeBonus')}{' '}
                  {marqueeItems[currentMsgIndex].bonus}{' '}
                  {t('subsidyPool.marqueePoints')}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};
