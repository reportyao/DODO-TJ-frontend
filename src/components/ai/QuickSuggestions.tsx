import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { LightBulbIcon } from '@heroicons/react/24/outline';
import { suggestions } from '../../data/suggestions';
import { useTranslation } from 'react-i18next';

export function QuickSuggestions() {
  const { t } = useTranslation();
  // 随机选择5条建议
  const randomSuggestions = useMemo(() => {
    const shuffled = [...suggestions].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  }, []);

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2 text-gray-700">
        <LightBulbIcon className="w-5 h-5" />
        <h3 className="text-sm font-medium">{t('ai.quickSuggestionsTitle')}</h3>
      </div>

      {/* 建议列表 - 只显示塔吉克语 */}
      <div className="space-y-2">
        {randomSuggestions.map((suggestion, index) => (
          <motion.div
            key={suggestion.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm"
          >
            <p className="text-sm text-gray-700 leading-relaxed">
              "{suggestion.tj}"
            </p>
          </motion.div>
        ))}
      </div>

      {/* 提示文本 */}
      <p className="text-xs text-gray-500 text-center">
        {t('ai.quickSuggestionsHint')}
      </p>
    </div>
  );
}
