import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSupabase } from './SupabaseContext';
import { UserProfile, Wallet, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';

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
  sessionToken: string | null;
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
  sessionToken: null,
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
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const fetchWallets = useCallback(async (userId: string) => {
    try {
      const fetchedWallets = await walletService.getWallets(userId);
      setWallets(fetchedWallets);
    } catch (error) {
      console.error('Failed to fetch wallets:', error);
    }
  }, [walletService]);

  /**
   * 检查本地存储的 session 是否仍然有效
   * 启动时调用，用于恢复登录状态
   */
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
        
        // 先恢复本地状态，不阻塞 UI
        console.log('[Session] Restoring user from localStorage...');
        setUser(parsedUser as User);
        setSessionToken(storedToken);

        // 异步验证 session 有效性（不阻塞首屏渲染）
        fetch(
          `${SUPABASE_URL}/rest/v1/user_sessions?session_token=eq.${storedToken}&user_id=eq.${parsedUser.id}&is_active=eq.true&select=id,expires_at`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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
        
        // 获取最新的用户 profile（确保数据同步）
        try {
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
        } catch (profileFetchError) {
          console.warn('[Session] Profile fetch failed, using cached data:', profileFetchError);
        }

        await fetchWallets(parsedUser.id);
      } else {
        console.log('[Session] No stored session found');
      }
      
      clearTimeout(timeoutId);
    } catch (error) {
      console.error('Failed to check session:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWallets, supabase]);

  /**
   * 通用方法：处理认证结果并更新状态
   * 由 loginWithPhone / registerWithPhone 调用
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

  // 启动时检查 session
  useEffect(() => {
    checkSession();
  }, [checkSession]);

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
    sessionToken,
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
