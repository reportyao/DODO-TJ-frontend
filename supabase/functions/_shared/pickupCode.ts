/**
 * 提货码生成共享模块
 * 用于在多个Edge Functions中统一生成提货码
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0'

/**
 * 生成唯一的6位提货码
 * 检查 prizes、full_purchase_orders、group_buy_results 三张表确保唯一性
 * 
 * @param supabase Supabase客户端实例
 * @param maxAttempts 最大重试次数，默认10次
 * @returns 6位数字提货码
 * @throws Error 如果无法生成唯一提货码
 */
export async function generatePickupCode(
  supabase: SupabaseClient,
  maxAttempts: number = 10
): Promise<string> {
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    // 生成6位随机数字 (100000-999999)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 并行检查三张表中是否存在该提货码
    const [prizesResult, fullPurchaseResult, groupBuyResult] = await Promise.all([
      // 检查prizes表
      supabase
        .from('prizes')
        .select('id')
        .eq('pickup_code', code)
        .maybeSingle(),
      
      // 检查full_purchase_orders表
      supabase
        .from('full_purchase_orders')
        .select('id')
        .eq('pickup_code', code)
        .maybeSingle(),
      
      // 检查group_buy_results表
      supabase
        .from('group_buy_results')
        .select('id')
        .eq('pickup_code', code)
        .maybeSingle(),
    ]);
    
    // 如果三张表都不存在该提货码，则返回
    if (!prizesResult.data && !fullPurchaseResult.data && !groupBuyResult.data) {
      return code;
    }
    
    attempts++;
  }
  
  throw new Error('生成提货码失败，请重试');
}

/**
 * 计算提货码过期时间
 * 默认从当前时间起30天后过期
 * 
 * @param daysValid 有效天数，默认30天
 * @returns ISO格式的过期时间字符串
 */
export function calculatePickupCodeExpiry(daysValid: number = 30): string {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysValid);
  return expiresAt.toISOString();
}

/**
 * 检查提货码是否有效（未过期）
 * 
 * @param expiresAt 过期时间字符串
 * @returns 是否有效
 */
export function isPickupCodeValid(expiresAt: string | null): boolean {
  if (!expiresAt) {return false;}
  return new Date() < new Date(expiresAt);
}

/**
 * 格式化提货码显示
 * 将6位数字格式化为 XXX-XXX 格式
 * 
 * @param code 6位提货码
 * @returns 格式化后的提货码
 */
export function formatPickupCode(code: string): string {
  if (code.length !== 6) {return code;}
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
