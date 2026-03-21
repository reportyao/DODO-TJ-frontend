import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUser } from '../contexts/UserContext';
import { supabase } from '../lib/supabase';
import { copyToClipboard } from '../lib/utils';
import { SafeMotion } from '../components/SafeMotion';
import { 
  GiftIcon, 
  UserPlusIcon, 
  ClipboardDocumentIcon,
  CheckIcon,
  ShareIcon,
  SparklesIcon,
  TrophyIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

// 奖项接口
interface SpinReward {
  id: string;
  reward_name: string;
  reward_name_i18n: Record<string, string>;
  reward_type: string;
  reward_amount: number;
  display_order: number;
  is_jackpot: boolean;
}

// 邀请记录接口
interface InviteRecord {
  id: string;
  username: string;
  created_at: string;
  status: string;
}

// 抽奖数据接口
interface SpinData {
  spin_balance: {
    spin_count: number;
    total_earned: number;
    total_used: number;
  };
  rewards: SpinReward[];
  referral_code: string;
  invite_stats: {
    total_invited: number;
    total_spins_from_invites: number;
    total_spins_from_group_buy: number;
  };
  invite_records: InviteRecord[];
}

// 6格转盘组件
const SpinWheel: React.FC<{
  rewards: SpinReward[];
  isSpinning: boolean;
  targetIndex: number | null;
  onSpinEnd: () => void;
  language: string;
}> = ({ rewards, isSpinning, targetIndex, onSpinEnd, language }) => {
  const { t } = useTranslation();
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 获取本地化奖项名称
  const getRewardName = (reward: SpinReward) => {
    if (reward.reward_name_i18n && reward.reward_name_i18n[language]) {
      return reward.reward_name_i18n[language];
    }
    return reward.reward_name;
  };

  // 获取奖项颜色
  const getRewardColor = (reward: SpinReward, index: number) => {
    if (reward.is_jackpot) {
      return 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white';
    }
    if (reward.reward_type === 'NONE') {
      return 'bg-gray-100 text-gray-600';
    }
    const colors = [
      'bg-gradient-to-br from-purple-500 to-purple-600 text-white',
      'bg-gradient-to-br from-blue-500 to-blue-600 text-white',
      'bg-gradient-to-br from-green-500 to-green-600 text-white',
      'bg-gradient-to-br from-pink-500 to-pink-600 text-white',
      'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white',
    ];
    return colors[index % colors.length];
  };

  // 抽奖动画
  useEffect(() => {
    if (isSpinning && targetIndex !== null) {
      let currentIndex = 0;
      let speed = 50;
      let rounds = 0;
      const totalRounds = 3; // 转3圈
      const totalSteps = totalRounds * 6 + targetIndex;
      let step = 0;

      const animate = () => {
        setHighlightIndex(currentIndex);
        currentIndex = (currentIndex + 1) % 6;
        step++;

        // 逐渐减速
        if (step > totalSteps - 10) {
          speed = 100 + (step - (totalSteps - 10)) * 30;
        } else if (step > totalSteps - 20) {
          speed = 80;
        }

        if (step < totalSteps) {
          timeoutRef.current = setTimeout(animate, speed);
        } else {
          setHighlightIndex(targetIndex);
          setTimeout(onSpinEnd, 500);
        }
      };

      animate();

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }
  }, [isSpinning, targetIndex, onSpinEnd]);

  // 清理
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // 确保有6个奖项
  const displayRewards = [...rewards];
  while (displayRewards.length < 6) {
    displayRewards.push({
      id: `placeholder-${displayRewards.length}`,
      reward_name: t('spinLottery.thankYou'),
      reward_name_i18n: { zh: t('spin.thankYou'), ru: 'Спасибо!', tg: 'Ташаккур!' },
      reward_type: 'NONE',
      reward_amount: 0,
      display_order: displayRewards.length,
      is_jackpot: false
    });
  }

  return (
    <div className="relative">
      {/* 6格转盘 - 2行3列布局 */}
      <div className="grid grid-cols-3 gap-2 p-4">
        {displayRewards.slice(0, 6).map((reward, index) => {
          const isHighlighted = highlightIndex === index;
          const isJackpot = reward.is_jackpot;
          
          return (
            <div
              key={reward.id}
              className={`
                relative rounded-xl p-4 transition-all duration-150
                ${getRewardColor(reward, index)}
                ${isHighlighted ? 'ring-4 ring-yellow-400 ring-offset-2 scale-105 shadow-lg' : ''}
                ${isJackpot ? 'row-span-1 col-span-1' : ''}
              `}
              style={{
                minHeight: isJackpot ? '100px' : '80px'
              }}
            >
              <div className="flex flex-col items-center justify-center h-full">
                {isJackpot && (
                  <SparklesIcon className="w-6 h-6 mb-1 animate-pulse" />
                )}
                <span className={`font-bold text-center ${isJackpot ? 'text-lg' : 'text-sm'}`}>
                  {getRewardName(reward)}
                </span>
                {reward.reward_amount > 0 && (
                  <span className="text-xs opacity-80 mt-1">
                    +{reward.reward_amount}
                  </span>
                )}
              </div>
              {isHighlighted && (
                <div className="absolute inset-0 bg-white/20 rounded-xl animate-pulse" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SpinLotteryPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, sessionToken, refreshWallets } = useUser();
  
  const [spinData, setSpinData] = useState<SpinData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSpinning, setIsSpinning] = useState(false);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [lastReward, setLastReward] = useState<SpinReward | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [copied, setCopied] = useState(false);

  // 加载抽奖数据
  const loadSpinData = useCallback(async () => {
    if (!user) return;
    
    try {
      setIsLoading(true);
      const { data, error } = await supabase.functions.invoke('get-spin-data', {
        body: { user_id: user.id, session_token: sessionToken }
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (data?.success) {
        setSpinData(data.data);
      }
    } catch (error) {
      console.error('Failed to load spin data:', error);
      toast.error(t('error.networkError'));
    } finally {
      setIsLoading(false);
    }
  }, [user, t]);

  useEffect(() => {
    loadSpinData();
  }, [loadSpinData]);

  // 执行抽奖
  const handleSpin = async () => {
    if (!user || !spinData || spinData.spin_balance.spin_count <= 0 || isSpinning) {
      if (spinData?.spin_balance.spin_count <= 0) {
        toast.error(t('spin.noSpins'));
      }
      return;
    }

    try {
      setIsSpinning(true);
      setShowResult(false);
      setLastReward(null);

      const { data, error } = await supabase.functions.invoke('spin-lottery', {
        body: { user_id: user.id, session_token: sessionToken }
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));

      if (data?.success) {
        // 找到中奖奖项的索引
        const rewardIndex = spinData.rewards.findIndex(r => r.id === data.reward.id);
        setTargetIndex(rewardIndex >= 0 ? rewardIndex : data.reward.display_order);
        
        // 保存中奖结果
        setLastReward({
          id: data.reward.id,
          reward_name: data.reward.name,
          reward_name_i18n: data.reward.name_i18n,
          reward_type: data.reward.type,
          reward_amount: data.reward.amount,
          display_order: data.reward.display_order,
          is_jackpot: data.reward.is_jackpot
        });

        // 更新抽奖次数
        setSpinData(prev => prev ? {
          ...prev,
          spin_balance: {
            ...prev.spin_balance,
            spin_count: data.remaining_spins
          }
        } : null);
      } else {
        throw new Error(data?.error || 'Spin failed');
      }
    } catch (error: any) {
      console.error('Spin error:', error);
      setIsSpinning(false);
      if (error.message?.includes('NO_SPINS')) {
        toast.error(t('spin.noSpins'));
      } else {
        toast.error(t('error.networkError'));
      }
    }
  };

  // 抽奖动画结束
  const handleSpinEnd = () => {
    setIsSpinning(false);
    setShowResult(true);
    refreshWallets();

    if (lastReward) {
      if (lastReward.reward_type === 'LUCKY_COIN' && lastReward.reward_amount > 0) {
        toast.success(t('spin.wonPrize', { amount: lastReward.reward_amount }));
      } else {
        toast(t('spin.thankYou'), { icon: '🎁' });
      }
    }
  };

  // 【迁移修复】复制邀请链接
  const copyInviteLink = async () => {
    if (!spinData?.referral_code) return;
    
    const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin;
    const inviteLink = `${appDomain}?ref=${spinData.referral_code}`;
    const success = await copyToClipboard(inviteLink);
    if (success) {
      setCopied(true);
      toast.success(t('spin.linkCopied'));
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t('common.copyFailed'));
    }
  };

  // 【迁移修复】分享邀请 - 使用 Web Share API 或 WhatsApp
  const shareInvite = () => {
    if (!spinData?.referral_code) return;
    
    const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin;
    const inviteLink = `${appDomain}?ref=${spinData.referral_code}`;
    const shareText = `🎁 Барои Шумо 10 сомонӣ тӯҳфа!\nБо истиноди ман ворид шавед ва бонус гиред. Дар DODO арзон харед ва бурд кунед!`;
    
    if (navigator.share) {
      navigator.share({
        title: t('spin.shareTitle'),
        text: shareText,
        url: inviteLink
      }).catch(console.error);
    } else {
      // 回退到 WhatsApp 分享
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText + '\n' + inviteLink)}`;
      window.open(whatsappUrl, '_blank');
    }
  };

  // 获取本地化奖项名称
  const getRewardName = (reward: SpinReward | null) => {
    if (!reward) return '';
    if (reward.reward_name_i18n && reward.reward_name_i18n[i18n.language]) {
      return reward.reward_name_i18n[i18n.language];
    }
    return reward.reward_name;
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : i18n.language === 'ru' ? 'ru-RU' : 'tg-TJ', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="text-center">
          <GiftIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">{t('auth.pleaseLogin')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* 顶部标题区域 */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white/20 rounded-full mb-3">
            <TrophyIcon className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold mb-1">{t('spin.title')}</h1>
          <p className="text-white/80 text-sm">{t('spin.subtitle')}</p>
        </div>
        
        {/* 剩余次数显示 */}
        <div className="mt-4 bg-white/10 backdrop-blur-sm rounded-xl p-4 text-center">
          <p className="text-white/80 text-sm mb-1">{t('spin.remainingSpins')}</p>
          <p className="text-4xl font-bold">{spinData?.spin_balance.spin_count || 0}</p>
        </div>
      </div>

      {/* 转盘区域 */}
      <div className="px-4 -mt-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <SpinWheel
            rewards={spinData?.rewards || []}
            isSpinning={isSpinning}
            targetIndex={targetIndex}
            onSpinEnd={handleSpinEnd}
            language={i18n.language}
          />
          
          {/* 抽奖按钮 */}
          <div className="px-4 pb-4">
            <button
              onClick={handleSpin}
              disabled={isSpinning || (spinData?.spin_balance.spin_count || 0) <= 0}
              className={`
                w-full py-4 rounded-xl font-bold text-lg transition-all
                ${isSpinning || (spinData?.spin_balance.spin_count || 0) <= 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:shadow-lg active:scale-98'
                }
              `}
            >
              {isSpinning ? t('spin.spinning') : t('spin.spinButton')}
            </button>
          </div>

          {/* 中奖结果展示 */}
          {showResult && lastReward && (
            <SafeMotion
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-4 pb-4"
            >
              <div className={`
                p-4 rounded-xl text-center
                ${lastReward.reward_type === 'LUCKY_COIN' && lastReward.reward_amount > 0
                  ? 'bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200'
                  : 'bg-gray-50 border border-gray-200'
                }
              `}>
                <p className="text-lg font-bold">
                  {lastReward.reward_type === 'LUCKY_COIN' && lastReward.reward_amount > 0
                    ? `🎉 ${t('spin.congratulations')}`
                    : `🎁 ${t('spin.thankYou')}`
                  }
                </p>
                <p className="text-gray-600 mt-1">
                  {getRewardName(lastReward)}
                  {lastReward.reward_amount > 0 && ` (+${lastReward.reward_amount})`}
                </p>
              </div>
            </SafeMotion>
          )}
        </div>
      </div>

      {/* 邀请好友区域 */}
      <div className="px-4 mt-4">
        <div className="bg-white rounded-2xl shadow-lg p-4">
          <h3 className="font-bold text-lg mb-3 flex items-center">
            <UserPlusIcon className="w-5 h-5 mr-2 text-purple-600" />
            {t('spin.inviteFriends')}
          </h3>
          
          <p className="text-gray-600 text-sm mb-4">{t('spin.inviteDesc')}</p>
          
          <div className="flex space-x-2">
            <button
              onClick={shareInvite}
              className="flex-1 flex items-center justify-center space-x-2 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-medium hover:shadow-lg transition-all"
            >
              <ShareIcon className="w-5 h-5" />
              <span>{t('spin.inviteButton')}</span>
            </button>
            <button
              onClick={copyInviteLink}
              className="px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              {copied ? (
                <CheckIcon className="w-5 h-5 text-green-600" />
              ) : (
                <ClipboardDocumentIcon className="w-5 h-5 text-gray-600" />
              )}
            </button>
          </div>
          
          {/* 邀请统计 */}
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">
                {spinData?.invite_stats.total_invited || 0}
              </p>
              <p className="text-xs text-gray-500">{t('spin.totalInvited')}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-pink-600">
                {spinData?.invite_stats.total_spins_from_invites || 0}
              </p>
              <p className="text-xs text-gray-500">{t('spin.spinsFromInvites')}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600">
                {spinData?.invite_stats.total_spins_from_group_buy || 0}
              </p>
              <p className="text-xs text-gray-500">{t('spin.spinsFromGroupBuy')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 邀请记录 */}
      {spinData?.invite_records && spinData.invite_records.length > 0 && (
        <div className="px-4 mt-4">
          <div className="bg-white rounded-2xl shadow-lg p-4">
            <h3 className="font-bold text-lg mb-3">{t('spin.inviteRecords')}</h3>
            <div className="space-y-3">
              {spinData.invite_records.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                      <UserPlusIcon className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {record.username.length > 10 
                          ? `${record.username.substring(0, 3)}***${record.username.slice(-3)}`
                          : record.username
                        }
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(record.created_at)}</p>
                    </div>
                  </div>
                  <span className="text-sm text-green-600 font-medium">
                    +1 {t('spin.spinChance')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 规则说明 */}
      <div className="px-4 mt-4 mb-4">
        <div className="bg-white rounded-2xl shadow-lg p-4">
          <h3 className="font-bold text-lg mb-3">{t('spin.rules')}</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start">
              <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold mr-2 flex-shrink-0">1</span>
              <span>{t('spin.rule1')}</span>
            </li>
            <li className="flex items-start">
              <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold mr-2 flex-shrink-0">2</span>
              <span>{t('spin.rule2')}</span>
            </li>
            <li className="flex items-start">
              <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold mr-2 flex-shrink-0">3</span>
              <span>{t('spin.rule3')}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SpinLotteryPage;
