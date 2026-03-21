import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { FireIcon, ArrowDownIcon } from '@heroicons/react/24/solid';

interface SubsidyData {
  total_pool: number;
  total_issued: number;
  remaining: number;
}

export const SubsidyPoolCard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<SubsidyData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  // 计算进度百分比
  const progressPercent = data 
    ? Math.max(5, Math.round((data.remaining / data.total_pool) * 100))
    : 95;

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (num >= 1_000) {
      return (num / 1_000).toFixed(0) + 'K';
    }
    return num.toFixed(0);
  };

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

        {/* 金额展示 */}
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-white/70 text-xs mb-0.5">{t('subsidyPool.remaining')}</p>
            <p className="text-white text-2xl font-black tracking-tight">
              {data ? formatNumber(data.remaining) : '---'}
              <span className="text-sm font-normal ml-1 opacity-80">TJS</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-white/70 text-xs mb-0.5">{t('subsidyPool.issued')}</p>
            <p className="text-white/90 text-lg font-bold">
              {data ? formatNumber(data.total_issued) : '---'}
              <span className="text-xs font-normal ml-0.5 opacity-70">TJS</span>
            </p>
          </div>
        </div>

        {/* 进度条 */}
        <div className="mb-3">
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-yellow-300 to-yellow-100 rounded-full"
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-white/60 text-[10px]">{t('subsidyPool.totalPool')}: 10,000,000 TJS</span>
            <span className="text-white/60 text-[10px]">{progressPercent}%</span>
          </div>
        </div>

        {/* 充值按钮 */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/deposit')}
          className="w-full bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center space-x-2 border border-white/10"
        >
          <ArrowDownIcon className="w-4 h-4" />
          <span>{t('subsidyPool.depositNow')}</span>
        </motion.button>
      </div>
    </motion.div>
  );
};
