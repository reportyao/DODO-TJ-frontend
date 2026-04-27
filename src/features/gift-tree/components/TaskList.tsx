/**
 * 希望之树 - 任务列表组件
 *
 * 展示每日任务列表，包含今日水滴统计和任务卡片。
 * 对标设计图 Daily Tasks 页面布局。
 * 精美金色渐变统计卡片 + 圆形进度。
 *
 * 多语言适配：
 * - 统计区使用弹性布局，文字可换行
 * - 圆形进度固定尺寸不受文字影响
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { GiftTreeTask, TodayTaskLog } from '../types';
import TaskItem from './TaskItem';

interface TaskListProps {
  tasks: GiftTreeTask[];
  todayLogs: TodayTaskLog[];
  todayTotalWater: number;
  dailyLimit: number;
  onTaskAction?: (taskCode: string) => void;
  loadingTask?: string | null;
}

const TaskList: React.FC<TaskListProps> = ({
  tasks,
  todayLogs,
  todayTotalWater,
  dailyLimit,
  onTaskAction,
  loadingTask,
}) => {
  const { t } = useTranslation();
  const percent = Math.min((todayTotalWater / dailyLimit) * 100, 100);
  const circumference = 2 * Math.PI * 22;

  const getTaskLog = (taskCode: string) =>
    todayLogs.find((log) => log.task_code === taskCode);

  const sortedTasks = [...tasks]
    .filter((t) => t.is_active !== false)
    .sort((a, b) => {
      const aLog = getTaskLog(a.task_code);
      const bLog = getTaskLog(b.task_code);
      const aDone = (aLog?.count || 0) >= a.daily_limit;
      const bDone = (bLog?.count || 0) >= b.daily_limit;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.sort_order - b.sort_order;
    });

  return (
    <div className="px-4 pb-6">
      {/* Today's earned drops header card - warm gold gradient */}
      <div className="relative overflow-hidden rounded-2xl p-4 mb-4 shadow-md">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#C5A55A] via-[#D4B76A] to-[#C5A55A]" />
        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }} />

        <div className="relative flex items-center justify-between gap-3">
          {/* Left: text info */}
          <div className="flex-1 min-w-0">
            <div className="text-white/85 text-sm leading-snug">
              {t('giftTree.todayEarned', "Today's earned drops")}
            </div>
            <div className="flex items-baseline gap-1 mt-1.5 flex-wrap">
              <span className="text-white text-2xl font-bold tabular-nums">{todayTotalWater}</span>
              <span className="text-white/75 text-sm">/{dailyLimit} {t('giftTree.dailyLimitLabel', 'daily limit')}</span>
            </div>
          </div>

          {/* Right: circular progress */}
          <div className="relative w-16 h-16 flex-shrink-0">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 48 48">
              <circle
                cx="24" cy="24" r="22"
                fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3"
              />
              <circle
                cx="24" cy="24" r="22"
                fill="none" stroke="white" strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - (percent / 100) * circumference}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white text-sm font-bold tabular-nums">{todayTotalWater}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Task cards */}
      <div className="space-y-2.5">
        {sortedTasks.map((task) => (
          <TaskItem
            key={task.task_code}
            task={task}
            todayLog={getTaskLog(task.task_code)}
            onAction={onTaskAction}
            isLoading={loadingTask === task.task_code}
          />
        ))}
      </div>

      {/* Bottom tip */}
      <div className="text-center mt-5">
        <span className="text-xs text-amber-600/70 leading-snug">
          {t('giftTree.lotteryTip', 'Lucky Draw tasks give the most drops!')}
        </span>
      </div>
    </div>
  );
};

export default TaskList;
