import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNetwork } from '../contexts/NetworkContext';

/**
 * 离线/弱网状态提示横幅
 * 
 * 【弱网优化】
 * - 离线时显示红色横幅提示
 * - 弱网时显示黄色横幅提示
 * - 正常网络时不显示任何内容
 */
const OfflineBanner: React.FC = () => {
  const { isOnline, isSlow } = useNetwork();
  const { t } = useTranslation();

  if (isOnline && !isSlow) {return null;}

  if (!isOnline) {
    return (
      <div className="bg-red-500 text-white text-center py-1.5 px-4 text-xs font-medium z-50">
        {t('network.offline', '当前无网络连接，显示的是缓存数据')}
      </div>
    );
  }

  if (isSlow) {
    return (
      <div className="bg-yellow-500 text-white text-center py-1.5 px-4 text-xs font-medium z-50">
        {t('network.slow', '当前网络较慢，加载可能需要更长时间')}
      </div>
    );
  }

  return null;
};

export default OfflineBanner;
