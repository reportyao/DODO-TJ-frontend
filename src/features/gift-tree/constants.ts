/**
 * 希望之树 - 常量配置
 */
/** 阶段奖励阈值 */
export const MILESTONES = [
  { water: 200, reward: '1 bonus coin', icon: '🪙' },
  { water: 500, reward: '2 bonus coins', icon: '🎁' },
  { water: 800, reward: '1 TJS coupon', icon: '🎟️' },
  { water: 1000, reward: 'Free Gift', icon: '🎉' },
] as const;
/** 每日水滴上限 */
export const DAILY_WATER_LIMIT = 180;
/** 默认目标水滴 */
export const DEFAULT_TARGET_WATER = 1000;
/** 任务图标映射 - 使用更精美的 emoji */
export const TASK_ICONS: Record<string, string> = {
  FIRST_WATER: '💧',
  FIRST_LOTTERY: '🎰',
  DAILY_CHECKIN: '📋',
  BROWSE_PRODUCTS: '👀',
  PLAY_LOTTERY: '🎲',
  WALLET_DEPOSIT: '👛',
  COMPLETE_ORDER: '🛒',
  STORE_PICKUP: '📍',
  FRIEND_HELP: '🤝',
  SHARE_APP: '📤',
  RANDOM_TASK: '🎁',
};
/** 树阶段对应的颜色 */
export const TREE_STAGE_COLORS = {
  seed: '#A0AEC0',
  sprout: '#68D391',
  young: '#48BB78',
  mature: '#38A169',
  complete: '#B8860B',
} as const;
/** 树阶段对应的描述 key */
export const TREE_STAGE_LABELS: Record<string, string> = {
  seed: 'giftTree.stageSeed',
  sprout: 'giftTree.stageSprout',
  young: 'giftTree.stageYoung',
  mature: 'giftTree.stageMature',
  complete: 'giftTree.stageComplete',
};
