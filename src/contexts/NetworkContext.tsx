import React, { createContext, useContext, ReactNode } from 'react';
import { useNetworkStatus } from '../hooks/usePerformance';

/**
 * 网络状态上下文
 * 
 * 【弱网优化】提供全局网络状态感知能力
 * - isOnline: 是否在线
 * - effectiveType: 网络类型（4g/3g/2g/slow-2g）
 * - isSlow: 是否为慢速网络（2g/3g/slow-2g）
 * - requestTimeout: 根据网络状态推荐的请求超时时间
 */
interface NetworkContextType {
  isOnline: boolean;
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';
  /** 是否为慢速网络（2g/3g/slow-2g） */
  isSlow: boolean;
  /** 推荐的请求超时时间（毫秒） */
  requestTimeout: number;
}

const NetworkContext = createContext<NetworkContextType>({
  isOnline: true,
  effectiveType: '4g',
  isSlow: false,
  requestTimeout: 15000,
});

export const useNetwork = () => useContext(NetworkContext);

export const NetworkProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isOnline, effectiveType } = useNetworkStatus();
  
  // 判断是否为慢速网络
  const isSlow = effectiveType === '2g' || effectiveType === 'slow-2g' || effectiveType === '3g';
  
  // 根据网络状态设置推荐超时时间
  const requestTimeout = isSlow ? 30000 : 15000; // 慢网30秒，快网15秒

  const value: NetworkContextType = {
    isOnline,
    effectiveType,
    isSlow,
    requestTimeout,
  };

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};
