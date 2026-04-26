/**
 * 希望之树 - 单个任务卡片组件
 *
 * 展示任务名称、奖励水滴数、完成状态和操作按钮。
 * 参考 UI 设计图中的 Daily Tasks 卡片样式。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GiftTreeTask, TodayTaskLog } from '../types';
import { TASK_ICONS } from '../constants';

interface TaskItemProps {
  task: GiftTreeTask;
  todayLog?: TodayTaskLog;
  onAction?: (taskCode: string) => void;
  isLoading?: boolean;
}

function getLocalizedText(
  i18n: Record<string, string> | undefined,
  lang: string
): string {
  if (!i18n) return '';
  return i18n[lang] || i18n['zh'] || i18n['en'] || Object.values(i18n)[0] || '';
}

const TaskItem: React.FC<TaskItemProps> = ({
  task,
  todayLog,
  onAction,
  isLoading = false,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'zh';

  const completedCount = todayLog?.count || 0;
  const isDone = completedCount >= task.daily_limit;
  const isOnetime = task.category === 'ONETIME';
  const hasProgress = task.daily_limit > 1 && completedCount > 0 && !isDone;
  const progressPercent = task.daily_limit > 1 ? (completedCount / task.daily_limit) * 100 : 0;

  const title = getLocalizedText(task.title_i18n, lang);
  const actionLabel = getLocalizedText(task.action_label_i18n, lang);
  const icon = TASK_ICONS[task.task_code] || '📋';

  const isRecommended = task.task_code === 'WALLET_DEPOSIT' || task.task_code === 'FIRST_LOTTERY';

  const handleClick = () => {
    if (isDone) return;
    if (task.action_route) {
      navigate(task.action_route);
    } else if (onAction) {
      onAction(task.task_code);
    }
  };

  return (
    <div
      className={`relative bg-white rounded-xl p-3.5 shadow-sm border transition-all ${
        isRecommended && !isDone
          ? 'border-primary/40 bg-gradient-to-r from-primary-light/20 to-white'
          : 'border-gray-100'
      }`}
    >
      {/* Recommended badge */}
      {isRecommended && !isDone && (
        <div className="absolute -top-2 right-3 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5">
          <span>⭐</span>
          <span>{t('giftTree.recommended', 'Recommended')}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* Left: icon + info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary-light/30 flex items-center justify-center text-xl flex-shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground text-sm truncate">
              {title}
            </div>
            {hasProgress && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">
                  {completedCount}/{task.daily_limit}
                </span>
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[100px]">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
            {isOnetime && isDone && (
              <span className="text-[10px] text-muted-foreground">
                {t('giftTree.oneTimeCompleted', 'One-time completed')}
              </span>
            )}
          </div>
        </div>

        {/* Right: reward + action */}
        <div className="flex flex-col items-end gap-1 ml-2">
          <span className="text-accent font-bold text-sm whitespace-nowrap">
            +{task.reward_water} {t('giftTree.drops', 'drops')}
          </span>
          {isDone ? (
            <div className="flex items-center gap-1 bg-success/10 text-success px-2.5 py-1 rounded-full">
              <span className="text-xs">✓</span>
              <span className="text-xs font-medium">
                {t('giftTree.taskDone', 'Checked')}
              </span>
            </div>
          ) : (
            <button
              onClick={handleClick}
              disabled={isLoading}
              className="bg-accent text-white text-xs font-medium px-3 py-1 rounded-full hover:bg-accent/90 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
            >
              {isLoading ? '...' : actionLabel || t('giftTree.taskGo', 'Go')}
              {task.action_route && ' →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskItem;
