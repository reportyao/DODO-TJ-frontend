/**
 * 希望之树 - 单个任务卡片组件
 *
 * 展示任务名称、奖励水滴数、完成状态和操作按钮。
 * 对标设计图 Daily Tasks 卡片样式。
 * 精美卡片设计，带有渐变图标、进度条和推荐标签。
 *
 * 多语言适配策略：
 * - 标题使用 line-clamp-2 + min-h 保证2行空间
 * - 按钮使用 min-w + whitespace-nowrap 防止换行
 * - 奖励数字使用 tabular-nums 保证对齐
 * - 进度条使用弹性宽度
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getLocalizedText } from '../../../lib/utils';
import type { GiftTreeTask, TodayTaskLog } from '../types';
import { TASK_ICONS } from '../constants';

interface TaskItemProps {
  task: GiftTreeTask;
  todayLog?: TodayTaskLog;
  onAction?: (taskCode: string) => void;
  isLoading?: boolean;
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
      className={`relative bg-white rounded-2xl p-3.5 shadow-sm transition-all ${
        isRecommended && !isDone
          ? 'border-2 border-amber-300/50 bg-gradient-to-r from-amber-50/40 to-white shadow-amber-100/30'
          : isDone
          ? 'border border-gray-100/60 opacity-70'
          : 'border border-gray-100/60 hover:shadow-md'
      }`}
    >
      {/* Recommended badge */}
      {isRecommended && !isDone && (
        <div className="absolute -top-2.5 right-3 bg-gradient-to-r from-amber-400 to-orange-400 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm">
          <span>⭐</span>
          <span>{t('giftTree.recommended', 'Recommended')}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Left: icon with warm gradient background */}
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#FFF8F0] to-[#FFE0B2] flex items-center justify-center text-xl flex-shrink-0 shadow-sm border border-amber-100/30">
          {icon}
        </div>

        {/* Middle: title + progress */}
        <div className="flex-1 min-w-0 py-0.5">
          <div className="font-semibold text-foreground text-[13px] leading-tight line-clamp-2">
            {title}
          </div>
          {hasProgress && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                {completedCount}/{task.daily_limit}
              </span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[100px]">
                <div
                  className="h-full bg-gradient-to-r from-accent to-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
          {isOnetime && isDone && (
            <span className="text-[10px] text-muted-foreground mt-0.5 block">
              {t('giftTree.oneTimeCompleted', 'One-time completed')}
            </span>
          )}
        </div>

        {/* Right: reward + action */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0 ml-1">
          <span className="text-accent font-bold text-[13px] tabular-nums whitespace-nowrap">
            +{task.reward_water} {t('giftTree.drops', 'drops')}
          </span>
          {isDone ? (
            <div className="flex items-center gap-1 bg-green-50 text-green-600 px-2.5 py-1.5 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-[11px] font-semibold">
                {t('giftTree.taskDone', 'Done')}
              </span>
            </div>
          ) : (
            <button
              onClick={handleClick}
              disabled={isLoading}
              className="min-w-[52px] bg-gradient-to-r from-accent to-teal-600 text-white text-[11px] font-semibold px-3.5 py-1.5 rounded-full active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap shadow-sm shadow-accent/15 hover:shadow-md"
            >
              {isLoading ? (
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  {actionLabel || t('giftTree.taskGo', 'Go')}
                  {task.action_route ? ' →' : ''}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskItem;
