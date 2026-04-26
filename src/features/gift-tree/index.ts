/**
 * 希望之树 (Gift Tree) - 模块导出入口
 *
 * 所有外部引用通过此文件导入，保持模块边界清晰。
 */

// Components
export { default as GiftTreeFloatingEntry } from './components/GiftTreeFloatingEntry';

// Hooks
export { useGiftTreeStatus, useGiftItems, useWaterTree, useStartTree, useHelpFriend, giftTreeKeys } from './hooks/useGiftTree';
export { useBrowseTracker } from './hooks/useBrowseTracker';

// Types
export type { GiftItem, GiftTree, GiftTreeTask, GiftTreeStatus, WaterResult, MilestoneReward, TreeStage, TodayTaskLog } from './types';
export { getTreeStage } from './types';

// Constants
export { MILESTONES, DAILY_WATER_LIMIT, DEFAULT_TARGET_WATER, TASK_ICONS } from './constants';
