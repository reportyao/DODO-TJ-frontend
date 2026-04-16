import React, { useState, useEffect, useCallback } from 'react';
import { referralService, InviteStats, InvitedUser, supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useUser } from '../contexts/UserContext';
import {
  UserPlusIcon,
  GiftIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  UsersIcon,
  BanknotesIcon,
  ChartBarIcon,
  ShareIcon
} from '@heroicons/react/24/outline';
import { formatCurrency, formatDateTime, copyToClipboard } from '../lib/utils';
import toast from 'react-hot-toast';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

// 接口已在 src/lib/supabase.ts 中定义
const InvitePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useUser();
  const [stats, setStats] = useState<InviteStats | null>(null);
  const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [commissionRates, setCommissionRates] = useState<Record<number, number>>({ 1: 0.10, 2: 0.04, 3: 0.01 });

  const inviteCode = user?.referral_code || user?.invite_code || 'LOADING...'; // 优先使用 referral_code，兼容旧的 invite_code
  // 使用 PWA 域名生成分享链接
  const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin;
  // 分享链接直接指向注册页面，邀请码自动填入
  const inviteLink = `${appDomain}/register?ref=${inviteCode}`;

  // 加载佣金配置 - 独立于用户登录状态
  const loadCommissionConfig = useCallback(async () => {
    try {
      const supabaseUrl = SUPABASE_URL;
      const supabaseKey = SUPABASE_ANON_KEY;
      const configResponse = await fetch(
        `${supabaseUrl}/rest/v1/commission_settings?is_active=eq.true&order=level.asc`,
        {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
        }
      );
      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData && configData.length > 0) {
          const rates: Record<number, number> = {};
          configData.forEach((config: any) => {
            rates[config.level] = config.rate;
          });
          setCommissionRates(rates);
        }
      }
    } catch (configError) {
      console.warn('加载佣金配置失败:', configError);
    }
  }, []);

  // 页面加载时立即加载佣金配置
  useEffect(() => {
    loadCommissionConfig();
  }, [loadCommissionConfig]);

  const fetchInviteData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!user) {
        setStats(null);
        setInvitedUsers([]);
        setIsLoading(false);
        return;
      }

      // 使用Edge Function获取邀请数据（传递 session_token 进行身份验证）
      const sessionToken = localStorage.getItem('custom_session_token');
      const { data, error } = await supabase.functions.invoke('get-invite-data', {
        body: { user_id: user.id, session_token: sessionToken }
      });

      if (error) {throw new Error(await extractEdgeFunctionError(error));}

      if (data) {
        setStats(data.stats || {
          total_invites: 0,
          total_referrals: 0,
          level1_referrals: 0,
          level2_referrals: 0,
          level3_referrals: 0,
          total_commission: 0,
          pending_commission: 0,
          paid_commission: 0,
          bonus_balance: 0,
        });
        setInvitedUsers(data.invited_users || []);
      }
    } catch (error) {
      console.error('Failed to fetch invite data:', error);
      toast.error(t('error.networkError'));
      setStats(null);
      setInvitedUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, t]);

  useEffect(() => {
    if (user) {
      fetchInviteData();
    }
  }, [user, fetchInviteData]);

  const copyInviteLink = async () => {
    const success = await copyToClipboard(inviteLink);
    if (success) {
      setCopied(true);
      toast.success(t('invite.linkCopied'));
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t('common.copyFailed'));
    }
  };

  const copyInviteCode = async () => {
    const success = await copyToClipboard(inviteCode);
    if (success) {
      toast.success(t('invite.codeCopied'));
    } else {
      toast.error(t('common.copyFailed'));
    }
  };

  const shareInvite = () => {
    const text = t('invite.shareText', { inviteCode, inviteLink });
    
    if (navigator.share) {
      navigator.share({
        title: t('invite.shareTitle'),
        text: text,
        url: inviteLink
      }).then(() => {
        toast.success(t('invite.shareSuccess'));
      }).catch(() => { /* ignored */ });
    } else {
      // 回退到 WhatsApp 分享
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text + '\n' + inviteLink)}`;
      window.open(whatsappUrl, '_blank');
    }
  };

  const getLevelBadge = (level: number) => {
    const colors = {
      1: 'bg-amber-100 text-primary-dark',
      2: 'bg-amber-100 text-primary-dark',
      3: 'bg-orange-100 text-orange-700'
    };
    return colors[level as keyof typeof colors] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary-dark text-white px-4 py-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-3">
            <GiftIcon className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{t('invite.inviteFriends')}</h1>
          <p className="text-white/90">{t("invite.subtitle")}</p>
        </div>

        {/* Invite Code Card */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
          <p className="text-white/80 text-sm mb-2 text-center">{t("invite.myInviteCode")}</p>
          <div className="flex items-center justify-center space-x-3 mb-4">
            <span className="text-3xl font-bold tracking-wider">{inviteCode}</span>
            <button
              onClick={copyInviteCode}
              className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              <ClipboardDocumentIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={copyInviteLink}
              className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-white text-primary rounded-xl font-medium hover:bg-white/90 transition-colors"
            >
              {copied ? (
                <>
                  <CheckIcon className="w-5 h-5" />
                  <span>{t("invite.copied")}</span>
                </>
              ) : (
                <>
                  <ClipboardDocumentIcon className="w-5 h-5" />
                  <span>{t("invite.copyLink")}</span>
                </>
              )}
            </button>
            <button
              onClick={shareInvite}
              className="px-4 py-3 bg-white/20 hover:bg-white/30 rounded-xl transition-colors flex items-center justify-center"
              aria-label={t('invite.share')}
            >
              <ShareIcon className="w-5 h-5" style={{ color: 'white' }} />
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="px-4 -mt-6 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-center space-x-3 mb-2">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <UsersIcon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{stats.total_referrals}</p>
                  <p className="text-xs text-gray-500">{t('invite.totalInvited')}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-center space-x-3 mb-2">
                <div className="p-2 bg-green-100 rounded-lg">
                  <BanknotesIcon className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">
                    🍀 {(stats.total_commission || 0).toFixed(0)}
                  </p>
                  <p className="text-xs text-gray-500">{t('invite.totalCommission')}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-center space-x-3 mb-2">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <ChartBarIcon className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{stats.level1_referrals}</p>
                  <p className="text-xs text-gray-500">{t('invite.level1Users')}</p>
                </div>
              </div>
            </motion.div>

          </div>
        </div>
      )}

      {/* Commission Rules (New Rates) */}
      <div className="px-4 mb-4">
        <div className="bg-white rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3">{t('invite.commissionRules')}</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <span className="flex items-center justify-center w-8 h-8 bg-primary text-white rounded-full text-sm font-bold">
                  1
                </span>
                <div>
                  <p className="font-medium text-gray-900">{t('invite.level1')}</p>
                  <p className="text-xs text-gray-500">{t('invite.level1Desc')}</p>
                </div>
              </div>
              <span className="text-lg font-bold text-primary">{(commissionRates[1] * 100).toFixed(1)}%</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <span className="flex items-center justify-center w-8 h-8 bg-primary text-white rounded-full text-sm font-bold">
                  2
                </span>
                <div>
                  <p className="font-medium text-gray-900">{t('invite.level2')}</p>
                  <p className="text-xs text-gray-500">{t('invite.level2Desc')}</p>
                </div>
              </div>
              <span className="text-lg font-bold text-primary">{(commissionRates[2] * 100).toFixed(1)}%</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <span className="flex items-center justify-center w-8 h-8 bg-orange-600 text-white rounded-full text-sm font-bold">
                  3
                </span>
                <div>
                  <p className="font-medium text-gray-900">{t('invite.level3')}</p>
                  <p className="text-xs text-gray-500">{t('invite.level3Desc')}</p>
                </div>
              </div>
              <span className="text-lg font-bold text-orange-600">{(commissionRates[3] * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              💡 <strong>{t('invite.commissionNoteTitle')}:</strong> {t('invite.commissionNoteContent')}
            </p>
          </div>
        </div>
      </div>

      {/* Level Distribution */}
      {stats && stats.total_referrals > 0 && (
        <div className="px-4 mb-4">
          <div className="bg-white rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-3">{t('invite.levelDistribution')}</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{t('invite.level1')}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${(stats.level1_referrals / stats.total_referrals) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8">{stats.level1_referrals}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{t('invite.level2')}</span>
                <div className="flex items-center space-x-2">
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${(stats.level2_referrals / stats.total_referrals) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8">{stats.level2_referrals}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{t('invite.level3')}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-600 rounded-full"
                      style={{ width: `${(stats.level3_referrals / stats.total_referrals) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8">{stats.level3_referrals}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invited Users List */}
      <div className="px-4 mb-4">
        <h3 className="font-semibold text-gray-900 mb-3">{t('invite.myInvitations')}</h3>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : invitedUsers.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <picture>
              <source srcSet="/brand/empty_orders.webp" type="image/webp" />
              <img 
                src="/brand/empty_orders.png" 
                alt="No invitations"
                className="w-32 h-32 mx-auto mb-4 opacity-80"
                style={{ objectFit: 'contain' }}
              />
            </picture>
            <p className="text-gray-500">{t('invite.noInvitations')}</p>
            <p className="text-sm text-gray-400 mt-2">{t('invite.shareToEarn')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {invitedUsers.map((invitedUser, index) => (
              <motion.div
                key={invitedUser.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white rounded-xl p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white font-semibold">
                      {invitedUser.avatar_url ? (
                        <img
                          src={invitedUser.avatar_url}
                          alt="Avatar"
                          style={{ width: '40px', height: '40px', borderRadius: '9999px', objectFit: 'cover', maxWidth: 'none' }}
                          onError={(e) => {
                            // 如果图片加载失败，显示首字母
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                      {!invitedUser.avatar_url && (
                        <span className="text-lg">
                          {(invitedUser.first_name || 'U').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{invitedUser.first_name || (invitedUser.phone_number ? invitedUser.phone_number.slice(0, 3) + '****' : t('invite.anonymousUser'))}</p>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getLevelBadge(invitedUser.level)}`}>
                        {t('invite.levelXFriend', { level: invitedUser.level })}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">{t('invite.contributedCommission')}</p>
                    <p className="font-bold text-green-600">
                      🍀 {(invitedUser.commission_earned || 0).toFixed(0)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-500">
                  <span>{t('invite.registrationTime')}: {formatDateTime(invitedUser.created_at)}</span>
                  <span>{t('invite.totalConsumption')}: {formatCurrency('TJS', invitedUser.total_spent)}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvitePage;
