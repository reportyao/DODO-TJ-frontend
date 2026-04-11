import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface AIUnderstandingCardProps {
  aiUnderstanding: {
    target_people?: string;
    selling_angle?: string;
    best_scene?: string;
    local_life_connection?: string;
    recommended_badge?: string;
  } | null;
  specifications?: string;
  material?: string;
  details?: string;
  className?: string;
}

export const AIUnderstandingCard: React.FC<AIUnderstandingCardProps> = ({
  aiUnderstanding,
  specifications,
  material,
  details,
  className,
}) => {
  const { t } = useTranslation();

  // 有 AI 理解数据时，展示温馨导购模块
  if (aiUnderstanding && (aiUnderstanding.target_people || aiUnderstanding.selling_angle)) {
    return (
      <div className={cn(
        "bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 rounded-2xl shadow-sm p-5 space-y-4 border border-amber-100/50",
        className
      )}>
        {/* 推荐标签 */}
        {aiUnderstanding.recommended_badge && (
          <div className="flex items-center justify-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 text-white text-xs font-medium shadow-sm">
              🏷️ {aiUnderstanding.recommended_badge}
            </span>
          </div>
        )}

        {/* 适合谁用 */}
        {aiUnderstanding.target_people && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">👤</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-amber-700 mb-1">{t('lottery.suitableFor')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{aiUnderstanding.target_people}</p>
            </div>
          </div>
        )}

        {/* 好在哪儿 */}
        {aiUnderstanding.selling_angle && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">✨</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-rose-700 mb-1">{t('lottery.whyGood')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{aiUnderstanding.selling_angle}</p>
            </div>
          </div>
        )}

        {/* 最佳使用场景 */}
        {aiUnderstanding.best_scene && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">🎯</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-blue-700 mb-1">{t('lottery.bestScene')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{aiUnderstanding.best_scene}</p>
            </div>
          </div>
        )}

        {/* 本地生活连接 */}
        {aiUnderstanding.local_life_connection && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-base">🏠</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-green-700 mb-1">{t('lottery.localConnection')}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{aiUnderstanding.local_life_connection}</p>
            </div>
          </div>
        )}

        {/* 关键参数露出（如果有规格或材质，简洁展示） */}
        {(specifications || material) && (
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
            </div>
          </div>
        )}
      </div>
    );
  }

  // 降级兼容：没有 AI 理解数据时，返回 null（由调用方决定是否展示原有内容）
  return null;
};
