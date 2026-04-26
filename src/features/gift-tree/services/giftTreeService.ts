/**
 * 希望之树 - Supabase API 服务层
 *
 * 所有后端交互通过 RPC 函数执行，前端不直接操作数据库。
 * session_token 从 localStorage 获取，与现有认证体系一致。
 *
 * RPC 函数清单（数据库已创建）：
 * - rpc_get_gift_tree_status(p_session_token) → jsonb
 * - rpc_start_gift_tree(p_session_token, p_gift_item_id) → jsonb
 * - rpc_water_tree(p_session_token, p_task_code, p_device_id?, p_reference_id?, p_metadata?) → jsonb
 * - rpc_gift_tree_friend_help(p_session_token, p_tree_owner_id, p_device_id?) → jsonb
 * - rpc_claim_gift_tree(p_session_token, p_pickup_code, p_pickup_point_id?) → jsonb
 */
import { supabase } from '../../../lib/supabase';
import { extractEdgeFunctionError } from '../../../utils/edgeFunctionHelper';
import type { GiftTreeStatus, WaterResult, GiftItem } from '../types';

const getSessionToken = () => localStorage.getItem('custom_session_token') || '';

/** 安全解析 RPC 返回值（可能是 string 或 object） */
function parseRpcResult<T>(data: unknown): T {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as T;
    } catch {
      throw new Error('Invalid response format');
    }
  }
  return data as T;
}

/** 统一错误处理 */
async function handleRpcError(error: any, fallbackMsg: string): never {
  const msg = await extractEdgeFunctionError(error);
  throw new Error(typeof msg === 'string' ? msg : fallbackMsg);
}

export const giftTreeService = {
  /** 获取树状态和任务列表 */
  async getStatus(): Promise<GiftTreeStatus> {
    const { data, error } = await supabase.rpc('rpc_get_gift_tree_status' as any, {
      p_session_token: getSessionToken(),
    });
    if (error) await handleRpcError(error, 'Failed to get tree status');
    return parseRpcResult<GiftTreeStatus>(data);
  },

  /** 获取可选礼物列表（直接查表，只返回有库存且上架的） */
  async getGiftItems(): Promise<GiftItem[]> {
    const { data, error } = await supabase
      .from('gift_items')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;
    return (data || []).filter(
      (item: any) => (item.stock - item.reserved_stock) > 0
    );
  },

  /** 开始种树（选择礼物） */
  async startTree(giftItemId: string): Promise<{ success: boolean; tree_id: string; initial_water: number }> {
    const { data, error } = await supabase.rpc('rpc_start_gift_tree' as any, {
      p_session_token: getSessionToken(),
      p_gift_item_id: giftItemId,
    });
    if (error) await handleRpcError(error, 'Failed to start tree');
    return parseRpcResult(data);
  },

  /** 浇水（完成任务） */
  async waterTree(
    taskCode: string,
    deviceId?: string,
    referenceId?: string,
    metadata?: Record<string, any>
  ): Promise<WaterResult> {
    const { data, error } = await supabase.rpc('rpc_water_tree' as any, {
      p_session_token: getSessionToken(),
      p_task_code: taskCode,
      p_device_id: deviceId || null,
      p_reference_id: referenceId || null,
      p_metadata: metadata || {},  // jsonb type, pass object directly
    });
    if (error) await handleRpcError(error, 'Failed to water tree');
    return parseRpcResult<WaterResult>(data);
  },

  /** 好友助力浇水（p_tree_owner_id 是树主人的 user_id） */
  async friendHelpWater(
    treeOwnerId: string,
    deviceId?: string
  ): Promise<{ success: boolean; water_added: number; error?: string }> {
    const { data, error } = await supabase.rpc('rpc_gift_tree_friend_help' as any, {
      p_session_token: getSessionToken(),
      p_tree_owner_id: treeOwnerId,
      p_device_id: deviceId || null,
    });
    if (error) await handleRpcError(error, 'Failed to help friend');
    return parseRpcResult(data);
  },

  /** 好友助力（useHelpFriend hook 使用的别名） */
  async helpFriend(
    treeOwnerId: string,
    deviceId?: string
  ): Promise<WaterResult> {
    const { data, error } = await supabase.rpc('rpc_gift_tree_friend_help' as any, {
      p_session_token: getSessionToken(),
      p_tree_owner_id: treeOwnerId,
      p_device_id: deviceId || null,
    });
    if (error) await handleRpcError(error, 'Failed to help friend');
    return parseRpcResult<WaterResult>(data);
  },

  /** 核销礼物（管理员/门店使用） */
  async claimTree(
    pickupCode: string,
    pickupPointId?: string
  ): Promise<{ success: boolean; tree_id: string; gift_name: string }> {
    const { data, error } = await supabase.rpc('rpc_claim_gift_tree' as any, {
      p_session_token: getSessionToken(),
      p_pickup_code: pickupCode,
      p_pickup_point_id: pickupPointId || null,
    });
    if (error) await handleRpcError(error, 'Failed to claim gift');
    return parseRpcResult(data);
  },
};
