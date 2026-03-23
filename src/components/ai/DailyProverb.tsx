import React from 'react';
import { motion } from 'framer-motion';
import { SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useDailyProverb } from '../../hooks/ai/useDailyProverb';
import { useTranslation } from 'react-i18next';

export function DailyProverb() {
  const { t } = useTranslation();
  const { proverb, nextProverb, loading } = useDailyProverb();

  if (loading || !proverb) {
    return (
      <div className="bg-gradient-to-br from-primary to-primary rounded-2xl p-6 h-48 animate-pulse" />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-primary to-primary rounded-2xl p-6 text-white shadow-lg"
    >
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-4">
        <SparklesIcon className="w-5 h-5" />
        <span className="text-sm font-medium">{t('ai.dailyProverbTitle')}</span>
      </div>

      {/* 谚语内容 - 只显示塔吉克语 */}
      <div className="mb-4">
        <p className="text-lg font-medium leading-relaxed">
          "{proverb.tajik}"
        </p>
      </div>

      {/* 切换按钮 */}
      <button
        onClick={nextProverb}
        className="flex items-center gap-2 text-sm text-amber-100 hover:text-white transition-colors"
      >
        <ArrowPathIcon className="w-4 h-4" />
        <span>Дигар нишон диҳед</span>
      </button>
    </motion.div>
  );
}
