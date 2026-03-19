import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSupabase } from './SupabaseContext';
import { UserProfile, Wallet, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';

// 扩展 Window 接口以支持 Telegram WebApp
declare global {
  interface Window {
    Telegram?: {
      WebApp: any;
    };
  }
}

// 安全地获取 Telegram WebApp，避免在非 Telegram 环境下报错
const getWebApp = () => {
  try {
    if (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) {
      return window.Telegram.WebApp;
    }
  } catch (e) {
    console.warn('[Telegram] Failed to access WebApp:', e);
  }
  // 返回一个安全的模拟对象
  return {
    initData: '',
    initDataUnsafe: {},
    ready: () => {},
    expand: () => {},
  };
};

/**
 * 【安全修复】获取当前 Telegram 用户的 ID
 * 用于验证 localStorage 缓存的用户身份是否与当前 Telegram 账号一致
 * 修复身份串号 Bug：防止切换 Telegram 账号后显示上一个账号的数据
 */
const getCurrentTelegramUserId = (): string | null => {
  try {
    const WebApp = getWebApp();
    if (WebApp.initDataUnsafe?.user?.id) {
      return WebApp.initDataUnsafe.user.id.toString();
    }
  } catch (e) {
    console.warn('[Telegram] Failed to get current user ID:', e);
  }
  return null;
};

// 合并 Supabase auth user 和 profile
export type User = UserProfile & { 
  email?: string;
  phone_number?: string;
  is_verified?: boolean;
  kyc_level?: string;
  invite_code?: string;  // 兼容旧字段
  referral_code?: string;  // 新字段（优先使用）
};

interface UserContextType {
  user: User | null;
  profile: UserProfile | null;
  wallets: Wallet[];
  isLoading: boolean;
  isAuthenticated: boolean;
  telegramUser: any; // 【迁移修复】保留字段以兼容已有组件，始终为 null
  sessionToken: string | null;
  authenticate: () => Promise<void>;
  refreshWallets: () => Promise<void>;
  logout: () => Promise<void>;
}

const defaultContextValue: UserContextType = {
  user: null,
  profile: null,
  wallets: [],
  isLoading: true,
  isAuthenticated: false,
  telegramUser: null,
  sessionToken: null,
  authenticate: async () => {
    throw new Error('UserProvider not initialized');
  },
  refreshWallets: async () => {
    throw new Error('UserProvider not initialized');
  },
  logout: async () => {
    throw new Error('UserProvider not initialized');
  },
};

const UserContext = createContext<UserContextType>(defaultContextValue);
UserContext.displayName = 'UserContext';

export const useUser = () => {
  const context = useContext(UserContext);
  return context;
};

interface UserProviderProps {
  children: ReactNode;
}

export const UserProvider: React.FC<UserProviderProps> = ({ children }) => {
  const { t } = useTranslation();
  const { authService, walletService, supabase } = useSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [telegramUser] = useState<any>(null);
  const [hasAttemptedAuth, setHasAttemptedAuth] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const fetchWallets = useCallback(async (userId: string) => {
    try {
      const fetchedWallets = await walletService.getWallets(userId);
      setWallets(fetchedWallets);
    } catch (error) {
      console.error('Failed to fetch wallets:', error);
    }
  }, [walletService]);

  const checkSession = useCallback(async () => {
    try {
      // 设置超时保护，确保即使请求失败也能结束加载状态
      const timeoutId = setTimeout(() => {
        console.warn('[Session] Check session timeout, forcing isLoading to false');
        setIsLoading(false);
      }, 15000); // 15秒超时（延长以适应网络较慢的情况）

      const storedToken = localStorage.getItem('custom_session_token');
      const storedUser = localStorage.getItem('custom_user');
      
      if (storedToken && storedUser) {
        console.log('[Session] Found stored session, validating...');
        const parsedUser = JSON.parse(storedUser);
        
        // 【迁移修复】验证缓存的用户身份一致性
        // PWA 模式下不再依赖 Telegram WebApp，通过 session token 验证即可
        const currentTelegramId = getCurrentTelegramUserId();
        const cachedUserId = parsedUser.id?.toString();
        
        if (currentTelegramId && cachedUserId) {
          // 如果在 Telegram 环境中，仍然检查身份一致性（向后兼容）
          const cachedTelegramId = parsedUser.telegram_id?.toString();
          if (cachedTelegramId && currentTelegramId !== cachedTelegramId) {
            console.log('[Security] Identity mismatch detected, clearing cache');
            localStorage.removeItem('custom_session_token');
            localStorage.removeItem('custom_user');
            setSessionToken(null);
            setUser(null);
            setProfile(null);
            setWallets([]);
            setIsLoading(false);
            return;
          }
        }
        
        try {
          // 使用导出的配置，而不是直接读取环境变量
          const supabaseUrl = SUPABASE_URL;
          const supabaseKey = SUPABASE_ANON_KEY;
          
          // 身份验证通过，继续恢复会话
          console.log('[Session] Identity verified, restoring user from localStorage...');
          setUser(parsedUser as User);
          setSessionToken(storedToken);

          // 异步验证，不阻塞 UI
          fetch(
            `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${storedToken}&user_id=eq.${parsedUser.id}&select=*`,
            {
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
              }
            }
          ).then(async (response) => {
            if (response.ok) {
              const sessions = await response.json();
              if (!sessions || sessions.length === 0) {
                console.log('[Session] Session token invalid on server, clearing...');
                logout(false); // 不显示提示，静默清理
              } else {
                const sessionData = sessions[0];
                const expiresAt = new Date(sessionData.expires_at);
                if (expiresAt < new Date()) {
                  console.log('[Session] Session expired on server, clearing...');
                  logout(false); // 不显示提示，静默清理
                }
              }
            }
          }).catch(err => {
            console.warn('[Session] Network validation failed, keeping local session:', err);
          });
          
          // 已在上方恢复，此处仅保留日志
          console.log('[Session] Session restoration initiated');
          
          const { data: profileData, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('id', parsedUser.id)
            .maybeSingle();

          if (profileError) {
            console.error('Failed to fetch profile:', profileError);
          } else if (profileData) {
            setProfile(profileData as UserProfile);
          } else {
            console.log('[Session] No profile found for user, will be created on first interaction');
          }

          await fetchWallets(parsedUser.id);
        } catch (error) {
          console.error('[Session] Error validating session:', error);
          localStorage.removeItem('custom_session_token');
          localStorage.removeItem('custom_user');
          setSessionToken(null);
          setUser(null);
          setProfile(null);
        }
      } else {
        console.log('[Session] No stored session found');
      }
      
      // 清除超时定时器
      clearTimeout(timeoutId);
    } catch (error) {
      console.error('Failed to check session:', error);
    } finally {
      // 确保无论如何都结束加载状态
      setIsLoading(false);
    }
  }, [fetchWallets, supabase]);

  const authenticate = useCallback(async () => {
    const WebApp = getWebApp();
    
    console.log('[Auth] Starting authentication...');
    console.log('[Auth] WebApp.initData:', WebApp.initData ? `${WebApp.initData.substring(0, 50)}...` : 'null');
    
    if (!WebApp.initData) {
      console.error('[Auth] Telegram initData is not available');
      return;
    }
    
    try {
      setIsLoading(true);
      
      // 设置认证超时保护
      const authTimeout = setTimeout(() => {
        console.warn('[Auth] Authentication timeout');
        setIsLoading(false);
        toast.error(t('error.networkError'));
      }, 15000); // 15秒超时（延长以适应网络较慢的情况）
      
      const startParam = WebApp.initDataUnsafe?.start_param;
      console.log('[Auth] Calling authenticateWithTelegram...');
      const result = await authService.authenticateWithTelegram(WebApp.initData, startParam);
      
      clearTimeout(authTimeout);
      console.log('[Auth] Authentication result:', result);
      
      const { user, session } = result;
      
      console.log('[Auth] User data from server:', user);
      console.log('[Auth] Avatar URL from server:', user?.avatar_url);
      
      setUser(user as User);
      
      if (session && session.token) {
        console.log('[Auth] Saving session token to localStorage');
        setSessionToken(session.token);
        localStorage.setItem('custom_session_token', session.token);
        localStorage.setItem('custom_user', JSON.stringify(user));
      }
      
      if (user) {
        await fetchWallets(user.id);
      }
      toast.success(t('auth.loginSuccess'));
    } catch (error: any) {
      console.error('Authentication failed:', error);
      toast.error(error.message || t('auth.loginFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [authService, fetchWallets, t]);

  useEffect(() => {
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, _session) => {
      checkSession();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [checkSession, supabase]);

  // 自动认证：如果有 initData 但没有用户，尝试自动登录
  useEffect(() => {
    const autoAuthenticate = async () => {
      const WebApp = getWebApp();
      
      if (isLoading) {
        return;
      }
      
      // 如果有 initData 但没有用户且没有 session token，尝试认证
      if (WebApp.initData && !user && !sessionToken && !hasAttemptedAuth) {
        console.log('[Auto Auth] No user or session, attempting authentication...');
        setHasAttemptedAuth(true);
        await authenticate();
      }
    };

    autoAuthenticate();
  }, [user, sessionToken, isLoading, hasAttemptedAuth, authenticate]);

  const refreshWallets = useCallback(async () => {
    if (user) {
      await fetchWallets(user.id);
    }
  }, [user, fetchWallets]);

  const logout = useCallback(async (showToast = true) => {
    await authService.signOut();
    setUser(null);
    setProfile(null);
    setWallets([]);
    setSessionToken(null);
    localStorage.removeItem('custom_session_token');
    localStorage.removeItem('custom_user');
    if (showToast) {
      toast.success(t('auth.loggedOut'));
    }
  }, [authService, t]);

  const value: UserContextType = {
    user,
    profile,
    wallets,
    isLoading,
    isAuthenticated: !!user,
    telegramUser,
    sessionToken,
    authenticate,
    refreshWallets,
    logout,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};
