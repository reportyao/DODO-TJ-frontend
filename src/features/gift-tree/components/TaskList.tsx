/**
 * 希望之树 - 任务列表组件
 *
 * 展示每日任务列表，包含今日水滴统计和任务卡片。
 * 参考 UI 设计图中的 Daily Tasks 页面布局。
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

  const getTaskLog = (taskCode: string) =>
    todayLogs.find((log) => log.task_code === taskCode);

  // Sort: incomplete first, then by sort_order
  const sortedTasks = [...tasks].sort((a, b) => {
    const aLog = getTaskLog(a.task_code);
    const bLog = getTaskLog(b.task_code);
    const aDone = (aLog?.count || 0) >= a.daily_limit;
    const bDone = (bLog?.count || 0) >= b.daily_limit;
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.sort_order - b.sort_order;
  });

  return (
    <div className="px-4 pb-6">
      {/* Today's earned drops header */}
      <div className="bg-gradient-to-r from-primary to-primary-dark rounded-xl p-4 mb-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm opacity-90">
              {t('giftTree.todayEarned', "Today's earned drops")}
            </div>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-2xl font-bold">{todayTotalWater}</span>
              <span className="text-sm opacity-80">/{dailyLimit} {t('giftTree.dailyLimitLabel', 'daily limit')}</span>
            </div>
          </div>
          {/* Circular progress */}
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
              <circle
                cx="28" cy="28" r="24"
                fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4"
              />
              <circle
                cx="28" cy="28" r="24"
                fill="none" stroke="white" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${percent * 1.508} 150.8`}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold">{todayTotalWater}</span>
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
      <div className="text-center mt-4 text-xs text-primary">
        {t('giftTree.lotteryTip', 'Lucky Draw tasks give the most drops!')}
      </div>
    </div>
  );
};

export default TaskList;
