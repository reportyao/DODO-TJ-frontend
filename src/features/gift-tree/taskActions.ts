import type { GiftTreeTask } from './types';

/**
 * 希望之树任务动作策略。
 *
 * 重要原则：任务卡片上的按钮只能“引导用户去完成真实业务动作”，不能直接给水滴。
 * 只有 DAILY_CHECKIN 这种无外部业务边界的签到/浇水动作可以在礼树页直接完成。
 */
export type GiftTreeTaskAction = 'direct_water' | 'route' | 'share' | 'locked' | 'none';

export const DIRECT_WATER_TASK_CODES = new Set(['DAILY_CHECKIN']);
export const SHARE_TASK_CODES = new Set(['FRIEND_HELP']);

export const TASK_ROUTE_FALLBACKS: Record<string, string> = {
  STORE_PICKUP: '/pending-pickup',
};

export const TASK_INFO_I18N_KEYS: Record<string, string> = {
  STORE_PICKUP: 'giftTree.storePickupTaskHint',
  RANDOM_TASK: 'giftTree.randomTaskHint',
  FRIEND_HELP: 'giftTree.friendHelpHint',
  FIRST_WATER: 'giftTree.firstWaterAutoHint',
};

export function isDirectWaterTask(taskCode: string): boolean {
  return DIRECT_WATER_TASK_CODES.has(taskCode);
}

export function getTaskAction(task: Pick<GiftTreeTask, 'task_code' | 'action_route'>): GiftTreeTaskAction {
  if (isDirectWaterTask(task.task_code)) {
    return 'direct_water';
  }
  if (SHARE_TASK_CODES.has(task.task_code)) {
    return 'share';
  }
  if (task.action_route || TASK_ROUTE_FALLBACKS[task.task_code]) {
    return 'route';
  }
  if (TASK_INFO_I18N_KEYS[task.task_code]) {
    return 'locked';
  }
  return 'none';
}

export function getTaskRoute(task: Pick<GiftTreeTask, 'task_code' | 'action_route'>): string | null {
  return task.action_route || TASK_ROUTE_FALLBACKS[task.task_code] || null;
}
