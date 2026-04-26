/**
 * 希望之树 (Gift Tree) - TypeScript 类型定义
 */

export interface GiftItem {
  id: string;
  name: string;
  name_i18n: Record<string, string>;
  description?: string;
  description_i18n?: Record<string, string>;
  image_url: string;
  image_urls?: string[];
  target_water: number;
  stock: number;
  reserved_stock: number;
  is_active: boolean;
}

export interface GiftTree {
  id: string;
  current_water: number;
  target_water: number;
  status: 'GROWING' | 'COMPLETED' | 'CLAIMED' | 'EXPIRED';
  milestone_200_claimed: boolean;
  milestone_500_claimed: boolean;
  milestone_800_claimed: boolean;
  pickup_code: string | null;
  pickup_code_expires_at: string | null;
  created_at: string;
  gift_item: GiftItem | null;
}

export interface GiftTreeTask {
  task_code: string;
  category: 'ONETIME' | 'DAILY' | 'SOCIAL' | 'RANDOM';
  title_i18n: Record<string, string>;
  description_i18n: Record<string, string>;
  reward_water: number;
  daily_limit: number;
  action_route: string | null;
  action_label_i18n: Record<string, string>;
  sort_order: number;
}

export interface TodayTaskLog {
  task_code: string;
  count: number;
  total_water: number;
}

export interface GiftTreeStatus {
  has_tree: boolean;
  cooldown_active: boolean;
  tree: GiftTree | null;
  tasks: GiftTreeTask[];
  today_logs: TodayTaskLog[];
  today_total_water: number;
  daily_limit: number;
}

export interface WaterResult {
  success: boolean;
  duplicate: boolean;
  water_earned: number;
  old_water: number;
  new_water: number;
  target_water: number;
  milestone_rewards: MilestoneReward[];
  completed: boolean;
  pickup_code: string | null;
}

export interface MilestoneReward {
  milestone: number;
  reward_type: 'bonus_balance' | 'coupon';
  amount: number;
}

/** 树的视觉阶段 */
export type TreeStage = 'seed' | 'sprout' | 'young' | 'mature' | 'complete';

/** 根据水滴进度计算树的阶段 */
export function getTreeStage(water: number, target: number): TreeStage {
  const pct = water / target;
  if (pct >= 1) return 'complete';
  if (pct >= 0.8) return 'mature';
  if (pct >= 0.5) return 'young';
  if (pct >= 0.2) return 'sprout';
  return 'seed';
}
