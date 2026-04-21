import React from 'react';
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

function formatFullNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * 首页精简版补贴池横条
 *
 * 目标：减少首页顶部运营信息噪音，让用户更快进入商品浏览。
 * 保留补贴池剩余额度与钱包入口，但去掉高噪声跑马灯。
 */
export const SubsidyPoolBanner: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data } = useQuery<SubsidyData | null>({
    queryKey: ['subsidy-pool'],
    queryFn: async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke('get-subsidy-pool');
        if (!error && result) {return result;}
        return null;
      } catch (err) {
        console.error('Failed to fetch subsidy pool:', err);
        return null;
      }
    },
    staleTime: staleTimes.static,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });

  return (
    <div
      onClick={() => navigate('/wallet')}
      className="mx-4 mt-3 rounded-2xl bg-white border border-amber-100 shadow-sm cursor-pointer active:scale-[0.99] transition-transform duration-200"
    >
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center flex-shrink-0">
            <FireIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-gray-500 leading-none">
              {t('subsidyPool.remaining')}
            </p>
            <div className="mt-1 flex items-baseline gap-1.5 min-w-0">
              <span className="text-base font-bold text-gray-900 truncate">
                {data ? formatFullNumber(data.remaining) : '---'}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                TJS
              </span>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 rounded-full bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 border border-amber-100 whitespace-nowrap">
          {t('subsidyPool.depositNow')} →
        </div>
      </div>
    </div>
  );
};
