/**
 * 希望之树 - 主页面（路由组件）
 *
 * 展示用户的种树进度、树的视觉、浇水按钮和每日任务列表。
 * 根据用户状态自动路由：无树 → 选礼物，已完成 → 完成页。
 * 对标设计图中的 "Hope Tree" 主页面（底部导航、进度条、树视觉、任务卡片）。
 * 精美暖色调设计，带有渐变进度条和卡片式任务。
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { getLocalizedText, shareContent } from '../../../lib/utils';
import { useGiftTreeStatus, useWaterTree } from '../hooks/useGiftTree';
import { useWaterAnimation } from '../hooks/useWaterAnimation';
import { TASK_ICONS } from '../constants';
import TreeCanvas from './TreeCanvas';
import TaskList from './TaskList';
import MilestoneModal from './MilestoneModal';
import WaterDropAnimation from './WaterDropAnimation';
import type { MilestoneReward } from '../types';

const GiftTreePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'zh';

  const { data: status, isLoading, error, refetch } = useGiftTreeStatus();
  const waterTree = useWaterTree();
  const { isAnimating, triggerAnimation } = useWaterAnimation();

  const [milestoneRewards, setMilestoneRewards] = useState<MilestoneReward[]>([]);
  const [showMilestone, setShowMilestone] = useState(false);
  const [loadingTask, setLoadingTask] = useState<string | null>(null);

  // Redirect logic
  useEffect(() => {
    if (!isLoading && status) {
      if (!status.has_tree && !status.cooldown_active) {
        navigate('/gift-tree/select', { replace: true });
      } else if (status.tree?.status === 'COMPLETED' || status.tree?.status === 'CLAIMED') {
        navigate('/gift-tree/complete', { replace: true });
      }
    }
  }, [status, isLoading, navigate]);

  // Handle task action
  const handleTaskAction = useCallback(
    async (taskCode: string) => {
      if (waterTree.isPending || loadingTask) return;
      setLoadingTask(taskCode);
      try {
        const result = await waterTree.mutateAsync({ taskCode });
        if (result.success) {
          triggerAnimation(result.water_earned);
          toast.success(
            `+${result.water_earned} 💧`,
            { duration: 1500, position: 'top-center' }
          );
          if (result.milestone_rewards && result.milestone_rewards.length > 0) {
            setTimeout(() => {
              setMilestoneRewards(result.milestone_rewards);
              setShowMilestone(true);
            }, 1200);
          }
          if (result.completed) {
            setTimeout(() => {
              navigate('/gift-tree/complete');
            }, 2500);
          }
        }
      } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('ERR_DAILY_TASK_LIMIT') || msg.includes('ERR_DAILY_TOTAL_LIMIT')) {
          toast(t('giftTree.taskLimitReached', 'Daily limit reached'), {
            icon: '⚠️',
            duration: 1500,
          });
        } else if (msg.includes('ERR_DUPLICATE')) {
          toast(t('giftTree.taskAlreadyDone', 'Task already completed'), {
            icon: '⚠️',
            duration: 1500,
          });
        } else {
          toast.error(msg || t('common.error', 'Error'));
        }
      } finally {
        setLoadingTask(null);
      }
    },
    [waterTree, loadingTask, triggerAnimation, navigate, t]
  );

  // Handle share
  const handleShare = useCallback(() => {
    if (!status?.tree?.user_id) return;
    const url = `${window.location.origin}/gift-tree/help/${status.tree.user_id}`;
    shareContent(
      t('giftTree.shareText', 'Help me water my Hope Tree on DODO!'),
      url,
      t('giftTree.shareTitle', 'DODO Hope Tree')
    );
  }, [status, t]);

  // Quick task cards data
  const quickTasks = useMemo(() => {
    if (!status?.tasks) return [];
    return status.tasks
      .filter((t) => t.category !== 'ONETIME')
      .slice(0, 5)
      .map((task) => {
        const log = status.today_logs?.find((l) => l.task_code === task.task_code);
        const isDone = (log?.count || 0) >= task.daily_limit;
        const title = getLocalizedText(task.title_i18n, lang) || task.task_code;
        const icon = TASK_ICONS[task.task_code] || '📋';
        return { ...task, isDone, title, icon, log };
      });
  }, [status, lang]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 border-[3px] border-accent/15 rounded-full" />
            <div className="absolute inset-0 border-[3px] border-accent border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-xl">🌳</div>
          </div>
          <span className="text-muted-foreground text-sm">{t('common.loading', 'Loading...')}</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center mb-4 shadow-sm">
          <span className="text-4xl">😔</span>
        </div>
        <p className="text-foreground font-semibold text-center mb-2">
          {t('common.loadFailed', 'Failed to load')}
        </p>
        <p className="text-muted-foreground text-xs text-center mb-5 max-w-xs leading-relaxed">
          {t('giftTree.checkNetwork', 'Please check your network and try again')}
        </p>
        <button
          onClick={() => refetch()}
          className="bg-gradient-to-r from-accent to-teal-600 text-white px-8 py-3 rounded-2xl font-semibold active:scale-95 transition-transform shadow-lg shadow-accent/20"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }

  // Cooldown state
  if (status?.cooldown_active && !status.has_tree) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center mb-4 shadow-sm">
          <span className="text-4xl">⏳</span>
        </div>
        <h2 className="text-lg font-bold text-foreground mb-2">
          {t('giftTree.cooldownTitle', 'Cooldown Period')}
        </h2>
        <p className="text-muted-foreground text-sm text-center max-w-xs leading-relaxed">
          {t('giftTree.cooldownDesc', 'Please wait before starting a new tree.')}
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 bg-gradient-to-r from-accent to-teal-600 text-white px-8 py-3 rounded-2xl font-semibold active:scale-95 transition-transform shadow-lg shadow-accent/20"
        >
          {t('common.backToHome', 'Back to Home')}
        </button>
      </div>
    );
  }

  const tree = status?.tree;
  if (!tree) return null;

  const progressPct = Math.min(Math.round((tree.current_water / tree.target_water) * 100), 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FDF6EC] via-[#FFF8F0] to-[#FFF3E0] pb-24 relative overflow-hidden">
      {/* Water drop animation overlay */}
      {isAnimating && <WaterDropAnimation />}

      {/* ===== Top Section: Progress Bar ===== */}
      <div className="sticky top-0 z-20 bg-gradient-to-b from-[#FDF6EC] to-[#FDF6EC]/95 backdrop-blur-sm">
        <div className="px-4 pt-3 pb-3">
          {/* Water count */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C12 2 5 10 5 15C5 18.866 8.134 22 12 22C15.866 22 19 18.866 19 15C19 10 12 2 12 2Z" fill="#006B6B" opacity="0.9"/>
                  <path d="M12 4C12 4 7 10.5 7 14.5C7 17.538 9.239 20 12 20" fill="#26A69A" opacity="0.4"/>
                </svg>
              </div>
              <span className="text-accent font-bold text-base tabular-nums">{tree.current_water}</span>
              <span className="text-muted-foreground text-xs">/{tree.target_water} {t('giftTree.drops', 'drops')}</span>
            </div>
            {/* Share button */}
            <button
              onClick={handleShare}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-white active:scale-90 transition-all shadow-sm"
              aria-label="Share"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          </div>

          {/* Teal gradient progress bar */}
          <div className="w-full h-8 bg-gray-100/80 rounded-full overflow-hidden relative shadow-inner">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out relative"
              style={{
                width: `${Math.max(progressPct, 6)}%`,
                background: 'linear-gradient(90deg, #006B6B, #00897B, #26A69A)',
              }}
            >
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent" style={{ animation: 'shimmer 2.5s ease-in-out infinite' }} />
              <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold drop-shadow-sm tabular-nums">
                {progressPct}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== User Info ===== */}
      <div className="px-4 pt-2 pb-1 flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FFF3E0] to-[#FFE0B2] flex items-center justify-center text-lg shadow-sm border border-amber-100/50">
          🌱
        </div>
        <span className="font-semibold text-foreground text-sm">
          {t('giftTree.title', 'Hope Tree')}
        </span>
      </div>

      {/* ===== Tree Visual ===== */}
      <TreeCanvas
        currentWater={tree.current_water}
        targetWater={tree.target_water}
        isWatering={isAnimating}
      />

      {/* ===== Water Button ===== */}
      <div className="px-5 mb-5">
        <button
          onClick={() => handleTaskAction('DAILY_CHECKIN')}
          disabled={waterTree.isPending || !!loadingTask}
          className={`w-full py-4 rounded-2xl font-bold text-white text-base flex items-center justify-center gap-2.5 transition-all duration-300 ${
            isAnimating
              ? 'bg-accent/80 scale-[0.97]'
              : 'bg-gradient-to-r from-[#006B6B] to-[#26A69A] shadow-lg shadow-accent/25 active:scale-[0.97] hover:shadow-xl hover:shadow-accent/30'
          } disabled:opacity-60`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C12 2 5 10 5 15C5 18.866 8.134 22 12 22C15.866 22 19 18.866 19 15C19 10 12 2 12 2Z" fill="white" opacity="0.9"/>
          </svg>
          {t('giftTree.waterTree', 'Water the Tree')}
          {isAnimating && (
            <span className="inline-block animate-bounce text-lg">💧</span>
          )}
        </button>
      </div>

      {/* ===== Daily Tasks Section ===== */}
      <div className="px-4 mb-2 flex items-center justify-between">
        <h2 className="font-bold text-foreground text-base">
          {t('giftTree.dailyTasks', 'Daily Tasks')}
        </h2>
        <button
          onClick={() => {/* scroll to full task list */}}
          className="text-xs text-accent font-medium"
        >
          {t('giftTree.viewAll', 'View All')} →
        </button>
      </div>

      {/* ===== Horizontal Quick Task Cards ===== */}
      {quickTasks.length > 0 && (
        <div className="px-4 mb-5 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2.5 pb-1">
            {quickTasks.map((task) => (
              <div
                key={task.task_code}
                className={`flex-shrink-0 w-[120px] bg-white rounded-2xl p-3 transition-all shadow-sm ${
                  task.isDone ? 'border border-gray-100/60 opacity-65' : 'border border-[#FFF3E0] hover:shadow-md'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FFF8F0] to-[#FFE0B2] flex items-center justify-center text-lg mb-2 shadow-sm">
                  {task.icon}
                </div>
                <div className="text-[11px] font-semibold text-foreground leading-tight mb-0.5 line-clamp-2 min-h-[2rem]">
                  {task.title}
                </div>
                <div className="text-[10px] text-accent font-bold mb-2 tabular-nums">
                  +{task.reward_water} {t('giftTree.drops', 'drops')}
                </div>
                {task.isDone ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 font-semibold bg-green-50 px-2.5 py-1 rounded-full">
                    ✓ {t('giftTree.taskDone', 'Done')}
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      if (task.action_route) {
                        navigate(task.action_route);
                      } else {
                        handleTaskAction(task.task_code);
                      }
                    }}
                    disabled={loadingTask === task.task_code}
                    className="bg-gradient-to-r from-accent to-teal-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full active:scale-95 transition-all disabled:opacity-50 shadow-sm shadow-accent/15"
                  >
                    {loadingTask === task.task_code ? '...' : `${t('giftTree.taskGo', 'Go')} ›`}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== Full Task List ===== */}
      {status && (
        <TaskList
          tasks={status.tasks}
          todayLogs={status.today_logs}
          todayTotalWater={status.today_total_water}
          dailyLimit={status.daily_limit}
          onTaskAction={handleTaskAction}
          loadingTask={loadingTask}
        />
      )}

      {/* ===== Milestone Reward Modal ===== */}
      <MilestoneModal
        isOpen={showMilestone}
        onClose={() => setShowMilestone(false)}
        rewards={milestoneRewards}
        currentWater={tree.current_water}
        targetWater={tree.target_water}
      />

      {/* Bottom navigation spacer */}
      <div className="h-20" />

      {/* Shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default GiftTreePage;
