/**
 * AI 服务层
 * 与 Supabase Edge Functions 通信
 */

import { supabase } from './supabase';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

// AI 配额类型
export interface AIQuota {
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  base_quota: number;
  bonus_quota: number;
}

// AI 聊天响应类型
export interface AIChatResponse {
  message: string;
  remaining_quota: number;
}

// 错误类型
export type AIErrorCode = 'SENSITIVE_CONTENT' | 'QUOTA_EXCEEDED' | 'AI_ERROR' | 'UNAUTHORIZED';

export class AIServiceError extends Error {
  code: AIErrorCode;
  
  constructor(code: AIErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AIServiceError';
  }
}

/**
 * AI 服务
 */
export const aiService = {
  /**
   * 发送消息到 AI
   * @param message 用户消息
   * @returns AI 回复和剩余配额
   */
  async chat(message: string): Promise<AIChatResponse> {
    const sessionToken = localStorage.getItem('custom_session_token');
    
    if (!sessionToken) {
      throw new AIServiceError('UNAUTHORIZED', 'Лутфан аввал ворид шавед');
    }

    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { 
        session_token: sessionToken,
        message: message.trim()
      }
    });

    if (error) {
      console.error('[AIService] Chat error:', error);
      // 检查是否是 400 错误（配额不足）
      if (error.message && error.message.includes('400')) {
        // 译文：您今天的免费次数已用完。请邀请好友或参与活动以获取更多！
        throw new AIServiceError('QUOTA_EXCEEDED', 'Миқдори саволҳои ройгони Шумо барои имрӯз ба охир расид. Лутфан дӯстонро даъват кунед ё дар аксия иштирок намоед, то имконияти бештар гиред!');
      }
      // 译文：AI 服务暂时不可用
      throw new AIServiceError('AI_ERROR', error.message || 'Хизматрасонии AI муваққатан дастнорас аст');
    }

    if (!data.success) {
      const errorCode = data.error as AIErrorCode;
      const errorMessage = data.message || 'Дархост иҷро нашуд'; // 请求失败
      // 如果是配额不足，使用更友好的提示
      if (errorCode === 'QUOTA_EXCEEDED') {
        // 译文：您今天的免费次数已用完。请邀请好友或参与活动以获取更多！
        throw new AIServiceError(errorCode, 'Миқдори саволҳои ройгони Шумо барои имрӯз ба охир расид. Лутфан дӯстонро даъват кунед ё дар аксия иштирок намоед, то имконияти бештар гиред!');
      }
      throw new AIServiceError(errorCode, errorMessage);
    }

    return data.data as AIChatResponse;
  },

  /**
   * 获取用户 AI 配额
   * @returns 配额信息
   */
  async getQuota(): Promise<AIQuota> {
    const sessionToken = localStorage.getItem('custom_session_token');
    
    if (!sessionToken) {
      // 未登录时返回默认配额
      return {
        total_quota: 10,
        used_quota: 0,
        remaining_quota: 10,
        base_quota: 10,
        bonus_quota: 0
      };
    }

    try {
      const { data, error } = await supabase.functions.invoke('ai-get-quota', {
        body: { session_token: sessionToken }
      });

      if (error) {
        // Edge Function 不可用时静默降级，避免控制台报错
        console.debug('[AIService] GetQuota unavailable, using defaults');
        return {
          total_quota: 10,
          used_quota: 0,
          remaining_quota: 10,
          base_quota: 10,
          bonus_quota: 0
        };
      }

      if (!data.success) {
        return {
          total_quota: 10,
          used_quota: 0,
          remaining_quota: 10,
          base_quota: 10,
          bonus_quota: 0
        };
      }

      return data.data as AIQuota;
    } catch (e) {
      console.debug('[AIService] GetQuota exception, using defaults');
      return {
        total_quota: 10,
        used_quota: 0,
        remaining_quota: 10,
        base_quota: 10,
        bonus_quota: 0
      };
    }
  }
};
