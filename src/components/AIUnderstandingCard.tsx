import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type LocalizedAIText = {
  zh?: string;
  ru?: string;
  tg?: string;
};

type AITextValue = string | LocalizedAIText | undefined;

interface AIUnderstandingCardProps {
  aiUnderstanding: {
    target_people?: AITextValue;
    selling_angle?: AITextValue;
    best_scene?: AITextValue;
    local_life_connection?: AITextValue;
    recommended_badge?: AITextValue;
    source_language?: 'ru';
  } | null;
  specifications?: string;
  material?: string;
  details?: string;
  className?: string;
}

const resolveAIText = (value: AITextValue, lang: string) => {
  if (!value) return '';
  if (typeof value === 'string') return value;

  const normalizedLang = lang === 'zh-CN' || lang === 'zh' ? 'zh' : lang === 'ru' ? 'ru' : lang === 'tg' ? 'tg' : 'zh';
  return value[normalizedLang as keyof LocalizedAIText] || value.ru || value.zh || value.tg || '';
};

export const AIUnderstandingCard: React.FC<AIUnderstandingCardProps> = ({
  aiUnderstanding,
  specifications,
  material,
  details,
  className,
}) => {
  const { t, i18n } = useTranslation();

  const targetPeople = resolveAIText(aiUnderstanding?.target_people, i18n.language);
  const sellingAngle = resolveAIText(aiUnderstanding?.selling_angle, i18n.language);
  const bestScene = resolveAIText(aiUnderstanding?.best_scene, i18n.language);
  const localLifeConnection = resolveAIText(aiUnderstanding?.local_life_connection, i18n.language);
  const recommendedBadge = resolveAIText(aiUnderstanding?.recommended_badge, i18n.language);

  if (aiUnderstanding && (targetPeople || sellingAngle)) {
    return (
      <div className={cn(
        'bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 rounded-2xl shadow-sm p-5 space-y-4 border border-amber-100/50',
        className
      )}>
        {recommendedBadge && (
          <div className="flex items-center justify-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 text-white text-xs font-medium shadow-sm">
              推荐 · {recommendedBadge}
            </span>
          </div>
        )}

        {targetPeople && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">👤</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-amber-700 mb-1">{t('lottery.suitableFor')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{targetPeople}</p>
            </div>
          </div>
        )}

        {sellingAngle && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">✨</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-rose-700 mb-1">{t('lottery.whyGood')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{sellingAngle}</p>
            </div>
          </div>
        )}

        {bestScene && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">🎯</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-blue-700 mb-1">{t('lottery.bestScene')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{bestScene}</p>
            </div>
          </div>
        )}

        {localLifeConnection && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">🏠</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-green-700 mb-1">{t('lottery.localConnection')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{localLifeConnection}</p>
            </div>
          </div>
        )}

        {(specifications || material || details) && (
          <div className="pt-3 border-t border-amber-100/80">
            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
              {specifications && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/70 border border-amber-100">
                  📐 {specifications}
                </span>
              )}
              {material && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/70 border border-amber-100">
                  🧵 {material}
                </span>
              )}
              {details && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/70 border border-amber-100">
                  ℹ️ {details}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};
