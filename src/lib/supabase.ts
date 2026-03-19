import { createClient } from '@supabase/supabase-js';
import { Database, Tables } from '../types/supabase';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

// 导出常用的类型
export type Lottery = Tables<'lotteries'>;


// 检查环境变量，优先使用 NEXT_PUBLIC_ (Next.js 风格) 或 VITE_ (Vite 风格)
let supabaseUrl = import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
let supabaseAnonKey = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

// 兜底方案：如果环境变量加载失败，使用硬编码的生产环境配置
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Environment variables not found, using fallback production config');
  supabaseUrl = 'https://zvouvjkrexowtujnqtna.supabase.co';
  supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2b3V2amtyZXhvd3R1am5xdG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MjEzOTgsImV4cCI6MjA4MzQ5NzM5OH0.-fb0nWhyAMdmzKBIzNqV0gXoANT7rPMmwYCwiszd7jM';
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase URL or Anon Key. Please check your .env.local file.');
}

// 导出配置供其他模块使用
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

// 创建 Supabase 客户端实例
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Helper 函数：获取带有自定义 session token 的请求选项
function getAuthHeaders() {
  const sessionToken = localStorage.getItem('custom_session_token');
  if (sessionToken) {
    return {
      headers: {
        Authorization: `Bearer ${sessionToken}`
      }
    };
  }
  return {};
}

// 导出常用的类型

export type UserProfile = Tables<'users'>;
export type Wallet = Tables<'wallets'>;
export type Order = Tables<'orders'>;
export type Commission = Tables<'commissions'>;
// export type DepositRequest = Tables<'deposit_requests'>; // 暂时注释，避免类型错误

// export type WithdrawalRequest = Tables<'withdrawal_requests'>; // 暂时注释，避免类型错误
export type Showoff = Tables<'showoffs'>;
export type ShowoffWithDetails = Showoff & {
  user: UserProfile | null;
  lottery: Lottery | null;
  inventory_product: { id: string; name: string; name_i18n: Record<string, string> | null; image_url: string | null } | null; // 关联的库存商品（用于未上架到商城的商品）
  is_liked: boolean;
  likes_count: number;
  lottery_title?: string;
  reward_coins?: number;
  image_urls?: string[]; // 晒单图片数组
  title?: string; // 晒单标题
  title_i18n?: Record<string, string> | null; // 晒单多语言标题
  inventory_product_id?: string | null; // 关联的库存商品ID
  // 运营晒单字段
  display_username?: string; // 运营晒单的虚拟用户昵称
  display_avatar_url?: string; // 运营晒单的虚拟用户头像
  source?: 'USER' | 'ADMIN'; // 晒单来源
};



// 邀请/推荐相关类型
export interface InviteStats {
  total_invites: number;
  total_referrals: number;
  level1_referrals: number;
  level2_referrals: number;
  level3_referrals: number;
  total_commission: number;
  pending_commission: number;
  paid_commission: number;
  bonus_balance: number;
}
export interface InvitedUser {
  id: string;
  phone_number: string | null;
  avatar_url: string | null;
  created_at: string;
  level: number; // 1, 2, or 3
  commission_earned: number;
  total_spent: number;
}

export type Currency = Tables<'wallets'>['currency'];
export type LotteryStatus = Tables<'lotteries'>['status'];
export type ShowoffStatus = Tables<'showoffs'>['status'];
export type OrderStatus = Tables<'orders'>['status'];

// --- 数据服务层抽象 ---

/**
 * 点赞服务
 */
export const likeService = {
  /**
   * 检查用户是否点赞了某个晒单
   * @param showoffId 晒单 ID
   */
  async isLiked(showoffId: string): Promise<boolean> {
    const user = await authService.getCurrentUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from('likes')
      .select('id')
      .eq('user_id', user.id)
      .eq('post_id', showoffId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Failed to check like status:', error);
      throw new Error(`检查点赞状态失败: ${error.message}`);
    }

    return !!data;
  },

  /**
   * 点赞某个晒单
   * @param showoffId 晒单 ID
   */
  async likeShowoff(showoffId: string): Promise<void> {
    const user = await authService.getCurrentUser();
    if (!user) throw new Error('用户未登录');

    const { error } = await supabase
      .from('likes')
      .insert({ user_id: user.id, post_id: showoffId, target_type: 'showoff', target_id: showoffId });

    if (error) {
      console.error('Failed to like showoff:', error);
      throw new Error(`点赞失败: ${error.message}`);
    }
  },

  /**
   * 取消点赞某个晒单
   * @param showoffId 晒单 ID
   */
  async unlikeShowoff(showoffId: string): Promise<void> {
    const user = await authService.getCurrentUser();
    if (!user) throw new Error('用户未登录');

    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('user_id', user.id)
      .eq('post_id', showoffId);

    if (error) {
      console.error('Failed to unlike showoff:', error);
      throw new Error(`取消点赞失败: ${error.message}`);
    }
  }
};

/**
 * 认证服务
 */
export const authService = {
  /**
   * 使用 Telegram Mini App 的 initData 进行认证
   * @param initData Telegram Mini App 启动参数
   * @param startParam 启动参数 (可选)
   */
  async authenticateWithTelegram(initData: string, startParam?: string) {
    const maxRetries = 3;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Auth] Attempt ${attempt}/${maxRetries}...`);
        
        // 调用 Supabase Edge Function 进行认证
        const { data, error } = await supabase.functions.invoke('auth-telegram', {
          body: { initData, startParam }
        });
        
        if (error) {
          console.error(`[Auth] Attempt ${attempt} failed:`, error);
          lastError = new Error(await extractEdgeFunctionError(error));
          
          // 如果不是最后一次尝试，等待后重试
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 指数退避，最多5秒
            console.log(`[Auth] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw lastError;
        }
        
        // Edge Function 返回的数据结构是 { data: { user, wallets, session, ... } }
        if (!data || !data.data) {
          lastError = new Error('Invalid response from auth function');
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            console.log(`[Auth] Invalid response, waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw lastError;
        }
      
      // 添加字段映射：referral_code -> invite_code
      const user = {
        ...data.data.user,
        invite_code: data.data.user.referral_code // 映射字段
      };
      
      // 【新增】如果是新用户且有礼物，存储到localStorage以便弹窗显示
      if (data.data.is_new_user && data.data.new_user_gift) {
        localStorage.setItem('new_user_gift_data', JSON.stringify(data.data.new_user_gift));
      }
      
      return {
        user,
        session: data.data.session,
        wallets: data.data.wallets,
        is_new_user: data.data.is_new_user,
        new_user_gift: data.data.new_user_gift
      };
      } catch (error) {
        console.error(`[Auth] Attempt ${attempt} error:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`[Auth] Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    
    // 所有重试都失败
    throw lastError || new Error('Authentication failed after all retries');
  },

  /**
   * 获取当前登录用户
   */
  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // 获取用户 Profile
    const { data: profile, error } = await supabase
	      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Failed to fetch user profile:', error);
      throw new Error(`获取用户资料失败: ${error.message}`);
    }

    // 添加字段映射：referral_code -> invite_code
    return { 
      ...user, 
      ...profile,
      invite_code: profile.referral_code // 映射字段
    };
  },

  /**
   * 使用手机号+密码登录（PWA 模式）
   */
  async loginWithPhone(phone_number: string, password: string) {
    const { data, error } = await supabase.functions.invoke('auth-login', {
      body: { phone_number, password }
    });

    if (error) {
      const errMsg = await extractEdgeFunctionError(error);
      throw new Error(errMsg);
    }

    if (!data || !data.data) {
      throw new Error('登录失败：服务器响应异常');
    }

    const user = {
      ...data.data.user,
      invite_code: data.data.user.referral_code
    };

    return {
      user,
      session: data.data.session,
      wallets: data.data.wallets,
      is_new_user: false
    };
  },

  /**
   * 使用手机号+密码注册（PWA 模式）
   */
  async registerWithPhone(phone_number: string, password: string, first_name?: string, last_name?: string, referral_code?: string) {
    const { data, error } = await supabase.functions.invoke('auth-register', {
      body: { phone_number, password, first_name, last_name, referral_code }
    });

    if (error) {
      const errMsg = await extractEdgeFunctionError(error);
      throw new Error(errMsg);
    }

    if (!data || !data.data) {
      throw new Error('注册失败：服务器响应异常');
    }

    const user = {
      ...data.data.user,
      invite_code: data.data.user.referral_code
    };

    // 如果是新用户且有礼物，存储到 localStorage 以便弹窗显示
    if (data.data.is_new_user && data.data.new_user_gift) {
      localStorage.setItem('new_user_gift_data', JSON.stringify(data.data.new_user_gift));
    }

    return {
      user,
      session: data.data.session,
      wallets: data.data.wallets || [],
      is_new_user: data.data.is_new_user,
      new_user_gift: data.data.new_user_gift
    };
  },

  /**
   * 请求密码重置
   */
  async requestPasswordReset(phone_number: string) {
    const { data, error } = await supabase.functions.invoke('auth-reset-password', {
      body: { phone_number }
    });

    if (error) {
      const errMsg = await extractEdgeFunctionError(error);
      throw new Error(errMsg);
    }

    return data;
  },

  /**
   * 验证重置 Token 并设置新密码
   */
  async resetPassword(token: string, new_password: string) {
    const { data, error } = await supabase.functions.invoke('auth-reset-password', {
      body: { action: 'verify', token, new_password }
    });

    if (error) {
      const errMsg = await extractEdgeFunctionError(error);
      throw new Error(errMsg);
    }

    return data;
  },

  /**
   * 登出（清除自定义 session）
   */
  async signOut() {
    // 清除自定义 session
    const sessionToken = localStorage.getItem('custom_session_token');
    if (sessionToken) {
      try {
        // 尝试在服务端失效 session
        await supabase
          .from('user_sessions')
          .update({ is_active: false })
          .eq('session_token', sessionToken);
      } catch (e) {
        console.warn('[Auth] Failed to invalidate session on server:', e);
      }
    }
    localStorage.removeItem('custom_session_token');
    localStorage.removeItem('custom_user');
    
    // 同时清除 Supabase auth session（向后兼容）
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // 忽略，可能没有 Supabase auth session
    }
  }
};

/**
 * 商城/产品服务
 */
export const lotteryService: any = {
  /**
   * 获取所有商城列表
   */
  async getAllLotteries(): Promise<Lottery[]> {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Failed to fetch all lotteries:', error);
      throw new Error(`获取所有商城列表失败: ${error.message}`);
    }
    return data;
  },

  /**
   * 根据状态获取商城列表
   * @param status 商城状态 (ACTIVE, DRAWN, CANCELLED)
   */
  async getLotteriesByStatus(status: string): Promise<Lottery[]> {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .eq('status', status as LotteryStatus)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error(`Failed to fetch lotteries with status ${status}:`, error);
      throw new Error(`获取商城列表失败: ${error.message}`);
    }
    return data;
  },

  /**
   * 获取所有活跃的商城列表
   */
  async getActiveLotteries(): Promise<Lottery[]> {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .in('status', ['ACTIVE' as LotteryStatus]) // 仅获取 ACTIVE 状态的
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Failed to fetch lotteries:', error);
      throw new Error(`获取商城列表失败: ${error.message}`);
    }
    return data;
  },

  /**
   * 获取单个商城详情
   * @param lotteryId 商城 ID
   */
  async getLotteryDetails(lotteryId: string): Promise<Lottery | null> {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .eq('id', lotteryId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116: No rows found
      console.error('Failed to fetch lottery details:', error);
      throw new Error(`获取商城详情失败: ${error.message}`);
    }
    return data;
  },

  /**
   * 购买商城门票
   * @param lotteryId 商城 ID
   * @param ticketCount 购买数量
   */
  async purchaseTickets(lotteryId: string, ticketCount: number, userId?: string, useCoupon?: boolean): Promise<Order> {
    // 从 localStorage 获取 session token
    const sessionToken = localStorage.getItem('custom_session_token');
    if (!sessionToken) {
      throw new Error('用户未登录');
    }

    // 生成幂等性 key 防止重复提交
    const idempotencyKey = `lottery_purchase_${lotteryId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 调用 lottery-purchase Edge Function
    const { data, error } = await supabase.functions.invoke('lottery-purchase', {
      body: {
        lotteryId,
        quantity: ticketCount,
        paymentMethod: 'LUCKY_COIN_WALLET', // 默认使用积分支付
        session_token: sessionToken,
        idempotency_key: idempotencyKey,
        useCoupon: useCoupon ?? false // 是否使用抵扣券混合支付
      }
    });

    if (error) {
      console.error('Lottery purchase failed:', error);
      throw new Error(await extractEdgeFunctionError(error));
    }

    if (data?.error) {
      throw new Error(`购买失败: ${data.error}`);
    }

    return data?.order || data;
  },

  /**
   * 获取用户的商城订单记录
   * @param userId 用户 ID
   */
    async getLotteryResult(lotteryId: string): Promise<any> {
    const { data, error } = await supabase
      .from('lottery_results')
      .select(
        `
          *,
          lottery:lotteries (
            title,
            image_url,
            ticket_price,
            currency,
            total_tickets,
            sold_tickets
          )
        `
      )
      .eq('lottery_id', lotteryId)
      .single()
    if (error) {
      throw new Error(error.message)
    }
    return data
  },

  /**
   * 执行开奖 - 统一使用 auto-lottery-draw Edge Function
   * @param lotteryId 商城 ID
   */
  async drawLottery(lotteryId: string): Promise<any> {
    const { data, error } = await supabase.functions.invoke('auto-lottery-draw', {
      body: { lotteryId }
    });

    if (error) {
      console.error('[lotteryService] Draw lottery failed:', error);
      throw new Error(await extractEdgeFunctionError(error));
    }

    if (!data?.success) {
      console.error('[lotteryService] Draw lottery returned error:', data?.error);
      throw new Error(`开奖失败: ${data?.error || 'Unknown error'}`);
    }

    return data;
  },

  async getUserOrders(userId: string): Promise<Order[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, lotteries(title, image_url)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch user orders:', error);
      throw new Error(`获取订单记录失败: ${error.message}`);
    }
    // 这里的类型需要手动处理一下，因为 select 包含了 join
    return data as any as Order[];
  }
};

/**
 * 钱包服务
 */
export const walletService = {
  /**
   * 获取用户所有钱包余额
   * @param userId 用户 ID
   */
  async getWallets(userId: string): Promise<Wallet[]> {
    const { data, error } = await supabase
      .from('wallets')
      .select('*')
       .eq('user_id', userId);
    
    if (error) {
      console.error('Failed to fetch wallets:', error);
      throw new Error(`获取钱包失败: ${error.message}`);
    }
    return data;
  },

  /**
   * 获取特定货币的钱包余额
   * @param currency 货币类型
   */
  async getBalance(currency: Currency): Promise<number> {
    const user = await authService.getCurrentUser();
    if (!user) throw new Error('用户未登录');

    // 调用 Supabase 存储过程 get_user_wallet_balance
               const { data, error } = await supabase.rpc("get_user_wallet_balance" as any, {
      p_user_id: user.id,
      p_currency: currency
    });

    if (error) {
      console.error('Failed to fetch balance:', error);
      throw new Error(`获取余额失败: ${error.message}`);
    }
    // 存储过程返回的是数字
                return parseFloat(data as any) || 0;
  },

  /**
   * 余额兑换（例如：佣金兑换为余额）
   * 余额兑换（单向：余额 -> 商城币）
   * @param amount 兑换金额
   */
  async exchangeRealToBonus(amount: number): Promise<{ success: boolean; new_balance?: number }> {
    // 从 localStorage 获取 session token
    const sessionToken = localStorage.getItem('custom_session_token');
    
    if (!sessionToken) {
      throw new Error('用户未登录');
    }

    const requestBody = { 
      session_token: sessionToken,
      amount 
    };

    const { data, error } = await supabase.functions.invoke('exchange-balance', {
      body: requestBody
    });
    

    if (error) {
      console.error('Failed to exchange balance:', error);
      throw new Error(await extractEdgeFunctionError(error));
    }
    
    // 检查返回的数据中是否有错误
    if (data && !data.success) {
      throw new Error(data.error || '兑换失败，请稍后重试');
    }
    
    return data as { success: boolean; new_balance?: number };
  }
};

/**
 * 佣金服务
 */
export const commissionService = {
  /**
   * 获取用户的佣金记录
   * @param userId 用户 ID
   */
  async getCommissions(userId: string): Promise<Commission[]> {
    const { data, error } = await supabase
      .from('commissions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch commissions:', error);
      throw new Error(`获取佣金记录失败: ${error.message}`);
    }
    return data;
  }
};

/**
 * 邀请/推荐服务
 */
export const referralService = {
  /**
   * 获取用户的推荐统计数据
   * @param userId 用户 ID
   */
    async getInviteStats(): Promise<InviteStats | null> {
    const user = await authService.getCurrentUser();
    if (!user) throw new Error('用户未登录');

    const sessionToken = localStorage.getItem('custom_session_token');
    if (!sessionToken) throw new Error('未授权：缺少 session_token');

    const { data, error } = await supabase.functions.invoke('get-user-referral-stats', {
      body: { session_token: sessionToken }
    });

    if (error) {
      console.error('Failed to fetch referral stats:', error);
      throw new Error(await extractEdgeFunctionError(error));
    }
    
    return data.data as InviteStats;
  },

  /**
   * 获取用户邀请的用户列表
   */
  async getInvitedUsers(): Promise<InvitedUser[]> {
    const user = await authService.getCurrentUser();
    if (!user) throw new Error('用户未登录');

    const sessionToken = localStorage.getItem('custom_session_token');
    if (!sessionToken) throw new Error('未授权：缺少 session_token');

    const { data, error } = await supabase.functions.invoke('get-invited-users', {
      body: { session_token: sessionToken }
    });

    if (error) {
      console.error('Failed to fetch invited users:', error);
      throw new Error(await extractEdgeFunctionError(error));
    }
    
    return data.data as InvitedUser[];
  },

};

/**
	 * 晒单服务 (Showoffs)
 */
	export const showoffService = {
  /**
	   * 获取已审核的晒单列表
   */
  async getApprovedShowoffs(_filter: 'all' | 'following' | 'popular', userId?: string): Promise<Showoff[]> {
    // 暂时忽略 filter 逻辑，直接获取所有已审核晒单
    // TODO: 实现 filter 逻辑
    
    // 1. 查询晒单列表
    const { data: showoffs, error } = await supabase
      .from('showoffs')
      .select('*')
      .eq('status', 'APPROVED')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch showoffs:', error);
      throw new Error(`获取晒单列表失败: ${error.message}`);
    }

    if (!showoffs || showoffs.length === 0) {
      return [];
    }

    // 2. 批量查询用户信息
    const userIds = [...new Set(showoffs.map(s => s.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('id, phone_number, first_name, avatar_url')
      .in('id', userIds);
    const userMap = new Map(users?.map(u => [u.id, u]) || []);

    // 3. 处理 prize_id，查询对应的 lottery_id
    const prizeIds = [...new Set(showoffs.map(s => s.prize_id).filter(Boolean))];
    const prizeToLotteryMap = new Map<string, string>();
    if (prizeIds.length > 0) {
      const { data: prizes } = await supabase
        .from('prizes')
        .select('id, lottery_id')
        .in('id', prizeIds);
      prizes?.forEach(p => {
        if (p.lottery_id) {
          prizeToLotteryMap.set(p.id, p.lottery_id);
        }
      });
    }

    // 4. 批量查询商城信息（包括直接的 lottery_id 和通过 prize 查询到的）
    const directLotteryIds = showoffs.map(s => s.lottery_id).filter(Boolean);
    const prizeLotteryIds = Array.from(prizeToLotteryMap.values());
    const allLotteryIds = [...new Set([...directLotteryIds, ...prizeLotteryIds])];
    
    const { data: lotteries } = await supabase
      .from('lotteries')
      .select('id, title, title_i18n')
      .in('id', allLotteryIds);
    const lotteryMap = new Map(lotteries?.map(l => [l.id, l]) || []);

    // 5. 如果有 userId，查询用户的点赞状态
    let likedIds = new Set<string>();
    if (userId) {
      const showoffIds = showoffs.map(s => s.id);
      const { data: likes } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', userId)
        .in('post_id', showoffIds);
      likedIds = new Set(likes?.map(l => l.post_id) || []);
    }

    // 6. 组装数据
    return showoffs.map(showoff => {
      const user = userMap.get(showoff.user_id);
      
      // 获取 lottery_id：优先使用直接的 lottery_id，其次通过 prize_id 查询
      const lotteryId = showoff.lottery_id || (showoff.prize_id ? prizeToLotteryMap.get(showoff.prize_id) : null);
      const lottery = lotteryId ? lotteryMap.get(lotteryId) : null;
      
      // 获取商品名：优先使用已保存的 title，其次使用查询到的 lottery.title
      const lotteryTitle = (showoff as any).title || lottery?.title || '未知商品';
      
      return {
        ...showoff,
        // 兼容数据库字段名差异：数据库可能使用 images 或 image_urls
        image_urls: (showoff as any).image_urls || (showoff as any).images || [],
        user: user || null,
        lottery: lottery || null,
        is_liked: likedIds.has(showoff.id),
        lottery_title: lotteryTitle
      };
    }) as any as Showoff[];
  },

  /**
   * 点赞/取消点赞
	   * @param showoffId 晒单 ID
   * @param userId 用户 ID
   */
  async likeShowoff(showoffId: string, userId?: string): Promise<number> {
    let uid = userId;
    if (!uid) {
      const user = await authService.getCurrentUser();
      if (!user) throw new Error('用户未登录');
      uid = user.id;
    }

    const { error } = await supabase
      .from('likes')
      .insert({ post_id: showoffId, user_id: uid, target_type: 'showoff', target_id: showoffId });

    // 如果是重复点赞错误，忽略它（用户已经点赞过）
    if (error && error.code !== '23505') {
      console.error('Failed to like showoff:', error);
      throw new Error(`点赞失败: ${error.message}`);
    }

    // 如果不是重复点赞，更新 likes_count
    if (!error) {
      const { error: updateError } = await (supabase.rpc as any)('increment_likes_count', { p_post_id: showoffId });
      if (updateError) {
        console.error('Failed to update likes_count:', updateError);
      }
    }

    // 获取并返回最新的 likes_count
    const { data, error: fetchError } = await supabase
      .from('showoffs')
      .select('likes_count')
      .eq('id', showoffId)
      .single();
    
    if (fetchError || !data) {
      console.error('Failed to fetch updated likes_count:', fetchError);
      return 0;
    }
    
    return data.likes_count;
  },
	
  async unlikeShowoff(showoffId: string, userId?: string): Promise<number> {
    let uid = userId;
    if (!uid) {
      const user = await authService.getCurrentUser();
      if (!user) throw new Error('用户未登录');
      uid = user.id;
    }

    const { error } = (await supabase
      .from('likes')
      .delete()
      .eq('post_id', showoffId)
      .eq('user_id', uid)) as any;
	
	    if (error) {
	      console.error('Failed to unlike showoff:', error);
	      throw new Error(`取消点赞失败: ${error.message}`);
	    }

      // 更新 likes_count
      const { error: updateError } = await (supabase.rpc as any)('decrement_likes_count', { p_post_id: showoffId });
      if (updateError) {
        console.error('Failed to update likes_count:', updateError);
      }

    // 获取并返回最新的 likes_count
    const { data, error: fetchError } = await supabase
      .from('showoffs')
      .select('likes_count')
      .eq('id', showoffId)
      .single();
    
    if (fetchError || !data) {
      console.error('Failed to fetch updated likes_count:', fetchError);
      return 0;
    }
    
    return data.likes_count;
	  },
	
	  // 原始的 toggleLike 逻辑被拆分为 likeShowoff 和 unlikeShowoff
		  async toggleLike(showoffId: string): Promise<void> {
		    const user = await authService.getCurrentUser();
		    if (!user) throw new Error('用户未登录');

    const { data: existingLike, error: selectError } = await supabase
      .from('likes')
      .select('id')
      .eq('post_id', showoffId)
      .eq('user_id', user.id)
      .single();
		
			    if (selectError && selectError.code !== 'PGRST116') {
			      console.error('Failed to check like status:', selectError);
			      throw new Error(`检查点赞状态失败: ${selectError.message}`);
		    }
				    if (existingLike) {
			      // 取消点赞
      const { error } = await supabase
        .from('likes')
        .delete()
        .eq('post_id', showoffId)
        .eq('user_id', user.id);
			
			      if (error) {
			        console.error('Failed to unlike showoff:', error);
			        throw new Error(`取消点赞失败: ${error.message}`);
			      }
			    } else {
			      // 点赞
      const { error } = await supabase
        .from('likes')
        .insert({ post_id: showoffId, user_id: user.id });
			
			      if (error) {
			        console.error('Failed to like showoff:', error);
				        throw new Error(`点赞失败: ${error.message}`);
				      }
				    }
			  },

  /**
   * 创建晒单
   */
  async createShowoff(params: {
    prize_id?: string;
    lottery_id: string | null; // 拼团时为null
    title?: string; // 商品名称（可能是 JSON 字符串或普通字符串）
    content: string;
    images: string[];
    user_id?: string;
  }): Promise<Showoff> {
    let userId = params.user_id;
    if (!userId) {
      const user = await authService.getCurrentUser();
      if (!user) throw new Error('用户未登录');
      userId = user.id;
    }

    const { data, error } = await supabase
      .from('showoffs')
      .insert({
        user_id: userId,
        prize_id: params.prize_id,
        lottery_id: params.lottery_id || null, // 拼团商品时lottery_id为空,设置为null
        title: params.title || null, // 保存商品名称
        content: params.content,
        images: params.images, // 数据库字段名可能是 images 或 image_urls
        image_urls: params.images, // 同时写入两个字段以兼容不同的数据库 schema
        status: 'PENDING',
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create showoff:', error);
      throw new Error(`创建晒单失败: ${error.message}`);
    }

    return data as Showoff;
  }
		};
