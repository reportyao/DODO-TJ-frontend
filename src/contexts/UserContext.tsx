import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSupabase } from './SupabaseContext';
import { UserProfile, Wallet, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';

// 扩展 Window 接口以支持 Telegram WebApp（向后兼容）
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
    console.warn('[Platform] Not in Telegram WebApp environment');
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
 * 检测当前运行环境
 */
const detectPlatform = (): 'telegram' | 'pwa' => {
  try {
    const WebApp = getWebApp();
    if (WebApp.initData && WebApp.initData.length > 0) {
      return 'telegram';
    }
  } catch (e) {
    // ignore
  }
  return 'pwa';
};

/**
 * 【安全修复】获取当前 Telegram 用户的 ID
 * 仅在 Telegram 环境中使用，用于验证 localStorage 缓存的用户身份
 */
const getCurrentTelegramUserId = (): string | null => {
  try {
    const WebApp = getWebApp();
    if (WebApp.initDataUnsafe?.user?.id) {
      return WebApp.initDataUnsafe.user.id.toString();
    }
  } catch (e) {
    // Not in Telegram environment
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
  platform: 'telegram' | 'pwa';
  authenticate: () => Promise<void>;
  loginWithPhone: (phone: string, password: string) => Promise<void>;
  registerWithPhone: (phone: string, password: string, firstName?: string, referralCode?: string) => Promise<void>;
  refreshWallets: () => Promise<void>;
  logout: () => Promise<void>;
  setAuthResult: (result: { user: any; session: any; wallets?: any[] }) => Promise<void>;
}

const defaultContextValue: UserContextType = {
  user: null,
  profile: null,
  wallets: [],
  isLoading: true,
  isAuthenticated: false,
  telegramUser: null,
  sessionToken: null,
  platform: 'pwa',
  authenticate: async () => {
    throw new Error('UserProvider not initialized');
  },
  loginWithPhone: async () => {
    throw new Error('UserProvider not initialized');
  },
  registerWithPhone: async () => {
    throw new Error('UserProvider not initialized');
  },
  refreshWallets: async () => {
    throw new Error('UserProvider not initialized');
  },
  logout: async () => {
    throw new Error('UserProvider not initialized');
  },
  setAuthResult: async () => {
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
  const [platform] = useState<'telegram' | 'pwa'>(detectPlatform);

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
      }, 15000);

      const storedToken = localStorage.getItem('custom_session_token');
      const storedUser = localStorage.getItem('custom_user');
      
      if (storedToken && storedUser) {
        console.log('[Session] Found stored session, validating...');
        const parsedUser = JSON.parse(storedUser);
        
        // 【安全检查】如果在 Telegram 环境中，验证身份一致性（向后兼容）
        if (platform === 'telegram') {
          const currentTelegramId = getCurrentTelegramUserId();
          const cachedTelegramId = parsedUser.telegram_id?.toString();
          if (currentTelegramId && cachedTelegramId && currentTelegramId !== cachedTelegramId) {
            console.log('[Security] Telegram identity mismatch detected, clearing cache');
            localStorage.removeItem('custom_session_token');
            localStorage.removeItem('custom_user');
            setSessionToken(null);
            setUser(null);
            setProfile(null);
            setWallets([]);
            setIsLoading(false);
            clearTimeout(timeoutId);
            return;
          }
        }
        
        try {
          const supabaseUrl = SUPABASE_URL;
          const supabaseKey = SUPABASE_ANON_KEY;
          
          // 先恢复本地状态，不阻塞 UI
          console.log('[Session] Identity verified, restoring user from localStorage...');
          setUser(parsedUser as User);
          setSessionToken(storedToken);

          // 异步验证 session 有效性
          fetch(
            `${supabaseUrl}/rest/v1/user_sessions?session_token=eq.${storedToken}&user_id=eq.${parsedUser.id}&is_active=eq.true&select=*`,
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
                logout(false);
              } else {
                const sessionData = sessions[0];
                const expiresAt = new Date(sessionData.expires_at);
                if (expiresAt < new Date()) {
                  console.log('[Session] Session expired on server, clearing...');
                  logout(false);
                }
              }
            }
          }).catch(err => {
            console.warn('[Session] Network validation failed, keeping local session:', err);
          });
          
          // 获取最新的用户 profile
          const { data: profileData, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('id', parsedUser.id)
            .maybeSingle();

          if (profileError) {
            console.error('Failed to fetch profile:', profileError);
          } else if (profileData) {
            setProfile(profileData as UserProfile);
            // 更新本地缓存的用户数据
            const updatedUser = { ...parsedUser, ...profileData };
            setUser(updatedUser as User);
            localStorage.setItem('custom_user', JSON.stringify(updatedUser));
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
      
      clearTimeout(timeoutId);
    } catch (error) {
      console.error('Failed to check session:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWallets, supabase, platform]);

  /**
   * 通用方法：处理认证结果并更新状态
   */
  const setAuthResult = useCallback(async (result: { user: any; session: any; wallets?: any[] }) => {
    const { user: authUser, session } = result;
    
    setUser(authUser as User);
    
    if (session && session.token) {
      setSessionToken(session.token);
      localStorage.setItem('custom_session_token', session.token);
      localStorage.setItem('custom_user', JSON.stringify(authUser));
    }
    
    if (authUser) {
      await fetchWallets(authUser.id);
    }
  }, [fetchWallets]);

  /**
   * Telegram 自动认证（向后兼容）
   * 仅在 Telegram Mini App 环境中使用
   */
  const authenticate = useCallback(async () => {
    const WebApp = getWebApp();
    
    console.log('[Auth] Starting Telegram authentication...');
    
    if (!WebApp.initData) {
      console.log('[Auth] Not in Telegram environment, skipping Telegram auth');
      return;
    }
    
    try {
      setIsLoading(true);
      
      const authTimeout = setTimeout(() => {
        console.warn('[Auth] Authentication timeout');
        setIsLoading(false);
        toast.error(t('error.networkError'));
      }, 15000);
      
      const startParam = WebApp.initDataUnsafe?.start_param;
      console.log('[Auth] Calling authenticateWithTelegram...');
      const result = await authService.authenticateWithTelegram(WebApp.initData, startParam);
      
      clearTimeout(authTimeout);
      
      await setAuthResult(result);
      toast.success(t('auth.loginSuccess'));
    } catch (error: any) {
      console.error('Telegram authentication failed:', error);
      toast.error(error.message || t('auth.loginFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [authService, setAuthResult, t]);

  /**
   * 手机号+密码登录（PWA 模式）
   */
  const loginWithPhone = useCallback(async (phone: string, password: string) => {
    try {
      setIsLoading(true);
      
      const result = await authService.loginWithPhone(phone, password);
      await setAuthResult(result);
      toast.success(t('auth.loginSuccess'));
    } catch (error: any) {
      console.error('Phone login failed:', error);
      throw error; // 向上抛出让页面处理具体错误消息
    } finally {
      setIsLoading(false);
    }
  }, [authService, setAuthResult, t]);

  /**
   * 手机号+密码注册（PWA 模式）
   */
  const registerWithPhone = useCallback(async (phone: string, password: string, firstName?: string, referralCode?: string) => {
    try {
      setIsLoading(true);
      
      const result = await authService.registerWithPhone(phone, password, firstName, undefined, referralCode);
      await setAuthResult(result);
      toast.success(t('auth.registerSuccess', '注册成功！'));
    } catch (error: any) {
      console.error('Phone registration failed:', error);
      throw error; // 向上抛出让页面处理具体错误消息
    } finally {
      setIsLoading(false);
    }
  }, [authService, setAuthResult, t]);

  useEffect(() => {
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, _session) => {
      checkSession();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [checkSession, supabase]);

  // 自动认证：仅在 Telegram 环境中，如果有 initData 但没有用户，尝试自动登录
  useEffect(() => {
    const autoAuthenticate = async () => {
      if (isLoading) return;
      
      if (platform === 'telegram') {
        const WebApp = getWebApp();
        if (WebApp.initData && !user && !sessionToken && !hasAttemptedAuth) {
          console.log('[Auto Auth] Telegram environment detected, attempting auto authentication...');
          setHasAttemptedAuth(true);
          await authenticate();
        }
      }
      // PWA 模式下不自动认证，用户需要手动登录或注册
    };

    autoAuthenticate();
  }, [user, sessionToken, isLoading, hasAttemptedAuth, authenticate, platform]);

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
    platform,
    authenticate,
    loginWithPhone,
    registerWithPhone,
    refreshWallets,
    logout,
    setAuthResult,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};
