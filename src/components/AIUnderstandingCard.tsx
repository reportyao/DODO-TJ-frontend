import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type SupportedAITextLang = 'zh' | 'ru' | 'tg';

type LocalizedAIText = {
  zh?: string;
  ru?: string;
  tg?: string;
};

type AITextValue = string | LocalizedAIText | undefined;

type AIUnderstanding = {
  target_people?: AITextValue;
  suitable_for?: AITextValue;
  selling_angle?: AITextValue;
  advantages?: AITextValue;
  how_to_use?: AITextValue;
  best_scene?: AITextValue;
  usage_scene?: AITextValue;
  usage_scenarios?: AITextValue;
  local_life_connection?: AITextValue;
  recommended_badge?: AITextValue;
  semantic_facts?: {
    parameter_highlights?: string[];
    usage_steps?: string[];
    usage_scenarios?: string[];
  };
  source_language?: 'multi' | SupportedAITextLang;
  primary_market_language?: SupportedAITextLang;
  display_priority?: SupportedAITextLang[];
  zh?: Partial<Record<'target_people' | 'suitable_for' | 'selling_angle' | 'advantages' | 'how_to_use' | 'best_scene' | 'usage_scene' | 'usage_scenarios' | 'local_life_connection' | 'recommended_badge', string>>;
  ru?: Partial<Record<'target_people' | 'suitable_for' | 'selling_angle' | 'advantages' | 'how_to_use' | 'best_scene' | 'usage_scene' | 'usage_scenarios' | 'local_life_connection' | 'recommended_badge', string>>;
  tg?: Partial<Record<'target_people' | 'suitable_for' | 'selling_angle' | 'advantages' | 'how_to_use' | 'best_scene' | 'usage_scene' | 'usage_scenarios' | 'local_life_connection' | 'recommended_badge', string>>;
};

interface AIUnderstandingCardProps {
  aiUnderstanding: AIUnderstanding | null;
  specifications?: string;
  material?: string;
  details?: string;
  className?: string;
}

const normalizeLanguage = (lang: string): SupportedAITextLang => {
  if (lang === 'zh-CN' || lang.startsWith('zh')) {return 'zh';}
  if (lang.startsWith('ru')) {return 'ru';}
  if (lang.startsWith('tg')) {return 'tg';}
  return 'zh';
};

const buildLanguagePriority = (
  lang: string,
  aiUnderstanding?: AIUnderstanding | null
): SupportedAITextLang[] => {
  const current = normalizeLanguage(lang);
  const configured = (aiUnderstanding?.display_priority || []).filter(
    (item): item is SupportedAITextLang => item === 'tg' || item === 'ru' || item === 'zh'
  );
  const primary = aiUnderstanding?.primary_market_language;

  return Array.from(new Set<SupportedAITextLang>([
    current,
    ...(primary ? [primary] : []),
    ...configured,
    'tg',
    'ru',
    'zh',
  ]));
};

const readLanguageRootValue = (
  aiUnderstanding: AIUnderstanding | null | undefined,
  fieldNames: string[],
  lang: string
): string => {
  if (!aiUnderstanding) {return '';}
  const priority = buildLanguagePriority(lang, aiUnderstanding);

  for (const language of priority) {
    const languageBlock = aiUnderstanding[language];
    if (!languageBlock || typeof languageBlock !== 'object') {continue;}
    for (const fieldName of fieldNames) {
      const value = languageBlock[fieldName as keyof typeof languageBlock];
      if (typeof value === 'string' && value.trim()) {return value.trim();}
    }
  }

  return '';
};

const resolveAIText = (
  value: AITextValue,
  lang: string,
  aiUnderstanding?: AIUnderstanding | null
) => {
  if (!value) {return '';}
  if (typeof value === 'string') {return value.trim();}

  const priority = buildLanguagePriority(lang, aiUnderstanding);
  for (const language of priority) {
    if (value[language]?.trim()) {return value[language]?.trim() || '';}
  }

  return '';
};

const resolveAIField = (
  aiUnderstanding: AIUnderstanding | null | undefined,
  fieldNames: Array<keyof AIUnderstanding>,
  lang: string
): string => {
  const languageRootValue = readLanguageRootValue(
    aiUnderstanding,
    fieldNames.map(String),
    lang
  );
  if (languageRootValue) {return languageRootValue;}

  for (const fieldName of fieldNames) {
    const value = resolveAIText(aiUnderstanding?.[fieldName] as AITextValue, lang, aiUnderstanding);
    if (value) {return value;}
  }

  return '';
};

export const AIUnderstandingCard: React.FC<AIUnderstandingCardProps> = ({
  aiUnderstanding,
  className,
}) => {
  const { t, i18n } = useTranslation();

  const targetPeople = resolveAIField(aiUnderstanding, ['target_people', 'suitable_for'], i18n.language);
  const sellingAngle = resolveAIField(aiUnderstanding, ['selling_angle', 'advantages'], i18n.language);
  const howToUse = resolveAIField(aiUnderstanding, ['how_to_use'], i18n.language);
  const bestScene = resolveAIField(aiUnderstanding, ['best_scene', 'usage_scene', 'usage_scenarios', 'local_life_connection'], i18n.language);

  const sections = [
    {
      key: 'target_people',
      title: t('lottery.suitableFor'),
      text: targetPeople,
      icon: 'user',
      color: 'amber',
    },
    {
      key: 'selling_angle',
      title: t('lottery.whyGood'),
      text: sellingAngle,
      icon: 'spark',
      color: 'rose',
    },
    {
      key: 'how_to_use',
      title: t('lottery.howToUse'),
      text: howToUse,
      icon: 'tool',
      color: 'violet',
    },
    {
      key: 'best_scene',
      title: t('lottery.bestScene'),
      text: bestScene,
      icon: 'scene',
      color: 'emerald',
    },
  ].filter((section) => section.text);

  if (!aiUnderstanding || sections.length === 0) {
    return null;
  }

  const colorClasses: Record<string, { bubble: string; title: string }> = {
    amber: { bubble: 'bg-amber-100 text-amber-700', title: 'text-amber-700' },
    rose: { bubble: 'bg-rose-100 text-rose-700', title: 'text-rose-700' },
    violet: { bubble: 'bg-violet-100 text-violet-700', title: 'text-violet-700' },
    emerald: { bubble: 'bg-emerald-100 text-emerald-700', title: 'text-emerald-700' },
  };

  const iconText: Record<string, string> = {
    user: '人',
    spark: '优',
    tool: '用',
    scene: '景',
  };

  return (
    <div className={cn(
      'bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 rounded-2xl shadow-sm p-5 space-y-4 border border-amber-100/50',
      className
    )}>
      <div className="flex items-center justify-center">
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 text-white text-xs font-medium shadow-sm">
          {t('lottery.productIntroduction')}
        </span>
      </div>

      {sections.map((section) => {
        const colors = colorClasses[section.color];
        return (
          <div key={section.key} className="flex items-start gap-3">
            <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold', colors.bubble)}>
              <span>{iconText[section.icon]}</span>
            </div>
            <div className="flex-1">
              <p className={cn('text-xs font-medium mb-1', colors.title)}>{section.title}</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{section.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
