/**
 * 希望之树 - 主页面（路由组件）
 *
 * 展示用户的种树进度、树的视觉、浇水按钮和每日任务列表。
 * 根据用户状态自动路由：无树 → 选礼物，已完成 → 完成页。
 * 参考 UI 设计图中的 "Hope Tree" 主页面。
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useGiftTreeStatus, useWaterTree } from '../hooks/useGiftTree';
import { useWaterAnimation } from '../hooks/useWaterAnimation';
import TreeCanvas from './TreeCanvas';
import WaterProgressBar from './WaterProgressBar';
import TaskList from './TaskList';
import MilestoneModal from './MilestoneModal';
import { shareContent } from '../../../utils/shareContent';
import type { MilestoneReward } from '../types';

function getLocalizedText(
  i18n: Record<string, string> | undefined | null,
  lang: string
): string {
  if (!i18n) return '';
  return i18n[lang] || i18n['zh'] || i18n['en'] || Object.values(i18n)[0] || '';
}

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

  // Handle task action (for tasks without action_route, like DAILY_CHECKIN)
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
          // Check for milestone rewards
          if (result.milestone_rewards && result.milestone_rewards.length > 0) {
            setTimeout(() => {
              setMilestoneRewards(result.milestone_rewards);
              setShowMilestone(true);
            }, 1000);
          }
          // If tree completed
          if (result.completed) {
            setTimeout(() => {
              navigate('/gift-tree/complete');
            }, 2000);
          }
        } else if (result.duplicate) {
          toast(t('giftTree.taskLimitReached', 'Daily limit reached'), {
            icon: '⚠️',
            duration: 1500,
          });
        }
      } catch (err: any) {
        toast.error(err?.message || t('common.error', 'Error'));
      } finally {
        setLoadingTask(null);
      }
    },
    [waterTree, loadingTask, triggerAnimation, navigate, t]
  );

  // Handle share for friend help
  const handleShare = useCallback(() => {
    if (!status?.tree) return;
    const userId = status.tree.id; // Use tree id for sharing
    const url = `${window.location.origin}/gift-tree/help/${userId}`;
    shareContent(
      t('giftTree.shareText', 'Help me water my Hope Tree on DODO!'),
      url,
      t('giftTree.shareTitle', 'DODO Hope Tree')
    );
  }, [status, t]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-8 h-8 border-3 border-accent border-t-transparent rounded-full" />
          <span className="text-muted-foreground text-sm">{t('common.loading', 'Loading...')}</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex flex-col items-center justify-center p-6">
        <span className="text-4xl mb-3">😔</span>
        <p className="text-muted-foreground text-center mb-4">
          {t('common.loadFailed', 'Failed to load')}
        </p>
        <button
          onClick={() => refetch()}
          className="bg-accent text-white px-6 py-2.5 rounded-xl font-medium"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }

  // Cooldown state
  if (status?.cooldown_active && !status.has_tree) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex flex-col items-center justify-center p-6">
        <span className="text-5xl mb-4">⏳</span>
        <h2 className="text-lg font-bold text-foreground mb-2">
          {t('giftTree.cooldownTitle', 'Cooldown Period')}
        </h2>
        <p className="text-muted-foreground text-sm text-center">
          {t('giftTree.cooldownDesc', 'Please wait before starting a new tree.')}
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 bg-accent text-white px-6 py-2.5 rounded-xl font-medium"
        >
          {t('common.backToHome', 'Back to Home')}
        </button>
      </div>
    );
  }

  const tree = status?.tree;
  if (!tree) return null;

  const giftName = tree.gift_item
    ? getLocalizedText(tree.gift_item.name_i18n, lang) || tree.gift_item.name
    : '';

  return (
    <div className="min-h-screen bg-[#FFF8F0] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FFF8F0]/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5"
        >
          <span className="text-lg">←</span>
        </button>
        <h1 className="font-bold text-foreground">
          {t('giftTree.title', 'Hope Tree')}
        </h1>
        <div className="flex items-center gap-1">
          <span className="text-sm">🪙</span>
          <button
            onClick={handleShare}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5"
          >
            <span className="text-lg">↗</span>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <WaterProgressBar
        currentWater={tree.current_water}
        targetWater={tree.target_water}
        milestone200Claimed={tree.milestone_200_claimed}
        milestone500Claimed={tree.milestone_500_claimed}
        milestone800Claimed={tree.milestone_800_claimed}
      />

      {/* Tree visual */}
      <TreeCanvas
        currentWater={tree.current_water}
        targetWater={tree.target_water}
        isWatering={isAnimating}
      />

      {/* Water button */}
      <div className="px-6 mb-6">
        <button
          onClick={() => handleTaskAction('DAILY_CHECKIN')}
          disabled={waterTree.isPending || loadingTask === 'DAILY_CHECKIN'}
          className={`w-full py-3.5 rounded-2xl font-bold text-white text-base flex items-center justify-center gap-2 transition-all active:scale-[0.97] ${
            isAnimating
              ? 'bg-accent/70 scale-[0.97]'
              : 'bg-gradient-to-r from-accent to-teal-600 shadow-lg shadow-accent/20'
          }`}
        >
          <span className="text-xl">💧</span>
          {t('giftTree.waterButton', 'Water the Tree')}
          {isAnimating && <span className="animate-ping text-xs">💧</span>}
        </button>
      </div>

      {/* Daily Tasks section */}
      <div className="px-4 mb-3">
        <h2 className="font-bold text-foreground text-base">
          {t('giftTree.dailyTasks', 'Daily Tasks')}
        </h2>
      </div>

      {/* Horizontal task cards (quick access) */}
      {status?.tasks && (
        <div className="px-4 mb-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2.5 pb-2">
            {status.tasks
              .filter((t) => t.category !== 'ONETIME')
              .slice(0, 4)
              .map((task) => {
                const log = status.today_logs?.find(
                  (l) => l.task_code === task.task_code
                );
                const isDone = (log?.count || 0) >= task.daily_limit;
                const title = getLocalizedText(task.title_i18n, lang);
                const icon =
                  {
                    DAILY_CHECKIN: '📅',
                    BROWSE_PRODUCTS: '🛒',
                    PLAY_LOTTERY: '🎲',
                    WALLET_DEPOSIT: '💰',
                    COMPLETE_ORDER: '🛍️',
                    FRIEND_HELP: '🤝',
                  }[task.task_code] || '📋';

                return (
                  <div
                    key={task.task_code}
                    className="flex-shrink-0 w-28 bg-white rounded-xl p-3 border border-gray-100 shadow-sm"
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary-light/30 flex items-center justify-center text-lg mb-2">
                      {icon}
                    </div>
                    <div className="text-xs font-semibold text-foreground truncate mb-0.5">
                      {title}
                    </div>
                    <div className="text-[10px] text-accent font-medium mb-2">
                      +{task.reward_water} {t('giftTree.drops', 'drops')}
                    </div>
                    {isDone ? (
                      <span className="text-[10px] text-success font-medium">
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
                        className="bg-accent text-white text-[10px] font-medium px-2.5 py-1 rounded-full"
                      >
                        {t('giftTree.taskGo', 'Go')} →
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Full task list (expandable) */}
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

      {/* Milestone reward modal */}
      <MilestoneModal
        isOpen={showMilestone}
        onClose={() => setShowMilestone(false)}
        rewards={milestoneRewards}
        currentWater={tree.current_water}
        targetWater={tree.target_water}
      />

      {/* Bottom navigation spacer */}
      <div className="h-16" />
    </div>
  );
};

export default GiftTreePage;
