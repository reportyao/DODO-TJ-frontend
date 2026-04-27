/**
 * 希望之树 - 任务列表组件
 *
 * 展示每日任务列表，包含今日水滴统计和任务卡片。
 * 对标设计图 Daily Tasks 页面布局。
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
  const circumference = 2 * Math.PI * 22; // r=22

  const getTaskLog = (taskCode: string) =>
    todayLogs.find((log) => log.task_code === taskCode);

  // Sort: active first, then incomplete first, then by sort_order
  // RPC 已只返回 is_active=true 的任务,但兜底过滤一次以防异常数据
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
      {/* Today's earned drops header card */}
      <div className="bg-gradient-to-r from-[#C5A55A] via-[#D4B76A] to-[#C5A55A] rounded-2xl p-4 mb-4 text-white shadow-md">
        <div className="flex items-center justify-between gap-3">
          {/* Left: text info (flexible, can wrap) */}
          <div className="flex-1 min-w-0">
            <div className="text-sm opacity-90 leading-snug">
              {t('giftTree.todayEarned', "Today's earned drops")}
            </div>
            <div className="flex items-baseline gap-1 mt-1 flex-wrap">
              <span className="text-2xl font-bold tabular-nums">{todayTotalWater}</span>
              <span className="text-sm opacity-80">/{dailyLimit} {t('giftTree.dailyLimitLabel', 'daily limit')}</span>
            </div>
          </div>

          {/* Right: circular progress (fixed size, never shrinks) */}
          <div className="relative w-14 h-14 flex-shrink-0">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 48 48">
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
              <span className="text-sm font-bold tabular-nums">{todayTotalWater}</span>
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
      <div className="text-center mt-4">
        <span className="text-xs text-amber-600/80 leading-snug">
          {t('giftTree.lotteryTip', 'Lucky Draw tasks give the most drops!')}
        </span>
      </div>
    </div>
  );
};

export default TaskList;
