import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useUser } from '../contexts/UserContext';
import { useSupabase } from '../contexts/SupabaseContext';
import {
  BellIcon,
  CheckIcon,
  TrophyIcon,
  BanknotesIcon,
  ExclamationTriangleIcon,
  MegaphoneIcon,
  ShieldCheckIcon,
  TicketIcon,
  ShoppingBagIcon,
  ArrowPathIcon,
  UsersIcon
} from '@heroicons/react/24/outline';
import { formatDateTime } from '../lib/utils';
import toast from 'react-hot-toast';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';

interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  title_i18n?: Record<string, string>;
  message_i18n?: Record<string, string>;
  metadata?: any;
  related_id?: string;
  related_type?: string;
  is_read: boolean;
  created_at: string;
  updated_at?: string;
  source?: string;
}

const NotificationPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user } = useUser();
  const { supabase } = useSupabase();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filteredNotifications, setFilteredNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const allNotifications: Notification[] = [];

      // 1. 获取 notifications 表的数据
      const { data: notificationsData, error: notificationsError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!notificationsError && notificationsData) {
        allNotifications.push(...notificationsData.map(n => ({
          ...n,
          source: 'notifications'
        })));
      }

      // 2. 获取充值记录
      const { data: depositData, error: depositError } = await supabase
        .from('deposit_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!depositError && depositData) {
        depositData.forEach(d => {
          allNotifications.push({
            id: `deposit_${d.id}`,
            user_id: d.user_id,
            type: 'DEPOSIT',
            title: d.status === 'APPROVED' ? t('notifications.depositSuccess') : d.status === 'REJECTED' ? t('notifications.depositFailed') : t('notifications.depositPending'),
            content: t('notifications.depositAmount', { amount: d.amount }) + (d.status === 'PENDING' ? ` (${t('notifications.pendingReview')})` : ''),
            related_id: d.id,
            related_type: 'deposit',
            is_read: d.status !== 'PENDING',
            created_at: d.created_at,
            source: 'deposit_requests'
          });
        });
      }

      // 3. 获取提现记录
      const { data: withdrawData, error: withdrawError } = await supabase
        .from('withdrawal_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!withdrawError && withdrawData) {
        withdrawData.forEach(w => {
          allNotifications.push({
            id: `withdraw_${w.id}`,
            user_id: w.user_id,
            type: 'WITHDRAWAL',
            title: w.status === 'APPROVED' ? t('notifications.withdrawSuccess') : w.status === 'REJECTED' ? t('notifications.withdrawFailed') : t('notifications.withdrawPending'),
            content: t('notifications.withdrawAmount', { amount: w.amount }) + (w.status === 'PENDING' ? ` (${t('notifications.pendingReview')})` : ''),
            related_id: w.id,
            related_type: 'withdrawal',
            is_read: w.status !== 'PENDING',
            created_at: w.created_at,
            source: 'withdrawal_requests'
          });
        });
      }

      // 4. 获取兑换记录
      const { data: exchangeData, error: exchangeError } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('type', 'COIN_EXCHANGE')
        .order('created_at', { ascending: false })
        .limit(20);

      // 过滤当前用户的兑换记录
      if (!exchangeError && exchangeData) {
        // 需要通过 wallet_id 关联到用户
        const { data: userWallets } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', user.id);
        
        const walletIds = userWallets?.map(w => w.id) || [];
        
        exchangeData.forEach(e => {
          if (walletIds.includes(e.wallet_id)) {
            allNotifications.push({
              id: `exchange_${e.id}`,
              user_id: user.id,
              type: 'COIN_EXCHANGE',
              title: t('notifications.coinExchange'),
              content: e.description || t('notifications.exchangeAmount', { amount: Math.abs(e.amount) }),
              related_id: e.id,
              related_type: 'exchange',
              is_read: true,
              created_at: e.created_at,
              source: 'wallet_transactions'
            });
          }
        });
      }

      // 5. 获取拼团记录（包括成功、失败、超时）
      try {
        const supabaseUrl = SUPABASE_URL;
        const supabaseKey = SUPABASE_ANON_KEY;
        
        // 同时查询user.id和telegram_id
        const userTelegramId = (user as any).telegram_id;
        const groupBuyResponse = await fetch(
          `${supabaseUrl}/rest/v1/group_buy_orders?or=(user_id.eq.${user.id},user_id.eq.${userTelegramId || user.id})&select=*,session:group_buy_sessions(id,status,winner_id,session_code,product:group_buy_products(name_i18n))&order=created_at.desc&limit=20`,
          {
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
          }
        );

        if (groupBuyResponse.ok) {
          const groupBuyResults = await groupBuyResponse.json();
          groupBuyResults.forEach((order: any) => {
            const sessionStatus = order.session?.status;
            const isWinner = order.session?.winner_id === user.id || order.session?.winner_id === userTelegramId;
            const productTitle = order.session?.product?.name_i18n?.[i18n.language] || order.session?.product?.name_i18n?.tg || t('notifications.groupBuyProduct');
            
            if (sessionStatus === 'SUCCESS' || sessionStatus === 'COMPLETED') {
              allNotifications.push({
                id: `groupbuy_${order.id}`,
                user_id: user.id,
                type: isWinner ? 'GROUP_BUY_WIN' : 'GROUP_BUY_LOSE',
                title: isWinner ? t('notifications.groupBuyWin') : t('notifications.groupBuyLose'),
                content: isWinner 
                  ? t('notifications.groupBuyWinContent', { product: productTitle })
                  : t('notifications.groupBuyLoseContent'),
                related_id: order.session_id,
                related_type: 'group_buy',
                is_read: true,
                created_at: order.updated_at || order.created_at,
                source: 'group_buy_orders'
              });
            } else if (sessionStatus === 'TIMEOUT') {
              allNotifications.push({
                id: `groupbuy_timeout_${order.id}`,
                user_id: user.id,
                type: 'GROUP_BUY_TIMEOUT',
                title: t('notifications.groupBuyTimeout'),
                content: t('notifications.groupBuyTimeoutContent'),
                related_id: order.session_id,
                related_type: 'group_buy',
                is_read: true,
                created_at: order.updated_at || order.created_at,
                source: 'group_buy_orders'
              });
            }
          });
        }
      } catch (e) {
        console.error('Failed to fetch group buy results:', e);
      }

      // 6. 获取商城记录（购买、中奖、未中）
      try {
        const { data: ordersData, error: ordersError } = await supabase
          .from('orders')
          .select('*, lottery:lotteries(title_i18n)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);
        
        // 单独查询中奖记录
        const { data: prizesData } = await supabase
          .from('prizes')
          .select('id, status, lottery_id')
          .eq('user_id', user.id);

        if (!ordersError && ordersData) {
          // 创建中奖记录映射 (通过lottery_id)
          const prizeMap = new Map();
          if (prizesData) {
            prizesData.forEach(prize => {
              prizeMap.set(prize.lottery_id, prize);
            });
          }
          
          ordersData.forEach((order: any) => {
            const lotteryTitle = order.lottery?.title_i18n?.[i18n.language] || order.lottery?.title_i18n?.tg || t('notifications.lotteryProduct');
            const prize = prizeMap.get(order.lottery_id);
            
            // 购买记录
            allNotifications.push({
              id: `lottery_purchase_${order.id}`,
              user_id: user.id,
              type: 'LOTTERY_PURCHASE',
              title: t('notifications.lotteryPurchase'),
              content: t('notifications.lotteryPurchaseContent', { product: lotteryTitle, count: order.ticket_count || 1 }),
              related_id: order.id,
              related_type: 'lottery',
              is_read: true,
              created_at: order.created_at,
              source: 'orders'
            });

            // 中奖记录
            if (prize) {
              const isWon = prize.status === 'WON' || prize.status === 'CLAIMED' || prize.status === 'PENDING_PICKUP';
              if (isWon) {
                allNotifications.push({
                  id: `lottery_win_${order.id}`,
                  user_id: user.id,
                  type: 'LOTTERY_WIN',
                  title: t('notifications.lotteryWin'),
                  content: t('notifications.lotteryWinContent', { product: lotteryTitle }),
                  related_id: prize.id,
                  related_type: 'prize',
                  is_read: true,
                  created_at: order.updated_at || order.created_at,
                  source: 'prizes'
                });
              }
            }
          });
        }
      } catch (e) {
        console.error('Failed to fetch lottery orders:', e);
      }

      // 7. 获取邀请奖励记录
      try {
        const { data: referralData, error: referralError } = await supabase
          .from('wallet_transactions')
          .select('*')
          .in('type', ['REFERRAL_BONUS', 'FRIEND_CASHBACK', 'SPIN_REWARD'] as any)
          .order('created_at', { ascending: false })
          .limit(20);

        if (!referralError && referralData) {
          const { data: userWallets } = await supabase
            .from('wallets')
            .select('id')
            .eq('user_id', user.id);
          
          const walletIds = userWallets?.map(w => w.id) || [];
          
          referralData.forEach((tx: any) => {
            if (walletIds.includes(tx.wallet_id)) {
              let title = '';
              let content = '';
              let type = '';
              
              switch (tx.type) {
                case 'REFERRAL_BONUS':
                  type = 'REFERRAL_REWARD';
                  title = t('notifications.referralReward');
                  content = t('notifications.referralRewardContent', { amount: tx.amount });
                  break;
                case 'FRIEND_CASHBACK':
                  type = 'FRIEND_CASHBACK';
                  title = t('notifications.friendCashback');
                  content = t('notifications.friendCashbackContent', { amount: tx.amount });
                  break;
                case 'SPIN_REWARD':
                  type = 'SPIN_REWARD';
                  title = t('notifications.spinReward');
                  content = t('notifications.spinRewardContent', { amount: tx.amount });
                  break;
              }
              
              allNotifications.push({
                id: `reward_${tx.id}`,
                user_id: user.id,
                type,
                title,
                content,
                related_id: tx.id,
                related_type: 'reward',
                is_read: true,
                created_at: tx.created_at,
                source: 'wallet_transactions'
              });
            }
          });
        }
      } catch (e) {
        console.error('Failed to fetch referral rewards:', e);
      }

      // 8. 按时间排序
      allNotifications.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // 9. 去重（基于 id）
      const uniqueNotifications = allNotifications.filter((n, index, self) =>
        index === self.findIndex(t => t.id === n.id)
      );

      setNotifications(uniqueNotifications.slice(0, 50));
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      toast.error(t('error.networkError'));
    } finally {
      setIsLoading(false);
    }
  }, [user, supabase, t]);

  const filterNotifications = useCallback(() => {
    let filtered = [...notifications];

    if (filter === 'unread') {
      filtered = filtered.filter(n => !n.is_read);
    } else if (filter === 'read') {
      filtered = filtered.filter(n => n.is_read);
    }

    setFilteredNotifications(filtered);
  }, [notifications, filter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    filterNotifications();
  }, [filterNotifications]);

  const markAsRead = async (notificationId: string) => {
    try {
      // 只有 notifications 表的数据才能标记为已读
      if (!notificationId.includes('_')) {
        await supabase
          .from('notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('id', notificationId);
      }
      
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      toast.success(t('notifications.markedAsRead'));
    } catch (error) {
      console.error('Failed to mark as read:', error);
      toast.error(t('error.networkError'));
    }
  };

  const markAllAsRead = async () => {
    try {
      // 标记 notifications 表中所有未读为已读
      await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user?.id)
        .eq('is_read', false);
      
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      toast.success(t('notifications.allMarkedAsRead'));
    } catch (error) {
      console.error('Failed to mark all as read:', error);
      toast.error(t('error.networkError'));
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      // 只有 notifications 表的数据才能删除
      if (!notificationId.includes('_')) {
        await supabase
          .from('notifications')
          .delete()
          .eq('id', notificationId);
      }
      
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      toast.success(t('notifications.deleted'));
    } catch (error) {
      console.error('Failed to delete notification:', error);
      toast.error(t('error.networkError'));
    }
  };

  const getNotificationIcon = (type: string) => {
    const iconClass = "w-6 h-6";
    switch (type) {
      case 'LOTTERY_RESULT':
      case 'GROUP_BUY_WIN':
        return <TrophyIcon className={`${iconClass} text-yellow-600`} />;
      case 'LOTTERY_REMINDER':
        return <TicketIcon className={`${iconClass} text-blue-600`} />;
      case 'DEPOSIT':
      case 'PAYMENT_SUCCESS':
        return <BanknotesIcon className={`${iconClass} text-green-600`} />;
      case 'WITHDRAWAL':
        return <BanknotesIcon className={`${iconClass} text-red-600`} />;
      case 'PAYMENT_FAILED':
        return <ExclamationTriangleIcon className={`${iconClass} text-red-600`} />;
      case 'MARKET_SOLD':
      case 'MARKET_PURCHASED':
        return <ShoppingBagIcon className={`${iconClass} text-purple-600`} />;
      case 'REFERRAL_REWARD':
        return <BanknotesIcon className={`${iconClass} text-green-600`} />;
      case 'INVITE_SUCCESS':
        return <UsersIcon className={`${iconClass} text-green-600`} />;
      case 'SYSTEM_ANNOUNCEMENT':
        return <MegaphoneIcon className={`${iconClass} text-blue-600`} />;
      case 'ACCOUNT_SECURITY':
        return <ShieldCheckIcon className={`${iconClass} text-orange-600`} />;
      case 'COIN_EXCHANGE':
        return <ArrowPathIcon className={`${iconClass} text-blue-600`} />;
      case 'GROUP_BUY_LOSE':
        return <UsersIcon className={`${iconClass} text-gray-600`} />;
      case 'GROUP_BUY_TIMEOUT':
        return <UsersIcon className={`${iconClass} text-orange-600`} />;
      case 'LOTTERY_PURCHASE':
        return <TicketIcon className={`${iconClass} text-purple-600`} />;
      case 'LOTTERY_WIN':
        return <TrophyIcon className={`${iconClass} text-yellow-600`} />;
      case 'FRIEND_CASHBACK':
        return <BanknotesIcon className={`${iconClass} text-green-600`} />;
      case 'SPIN_REWARD':
        return <TrophyIcon className={`${iconClass} text-purple-600`} />;
      default:
        return <BellIcon className={`${iconClass} text-gray-600`} />;
    }
  };

  const getNotificationBgColor = (type: string): string => {
    switch (type) {
      case 'LOTTERY_RESULT':
      case 'GROUP_BUY_WIN':
        return 'bg-yellow-50';
      case 'LOTTERY_REMINDER':
        return 'bg-blue-50';
      case 'DEPOSIT':
      case 'PAYMENT_SUCCESS':
        return 'bg-green-50';
      case 'WITHDRAWAL':
        return 'bg-red-50';
      case 'PAYMENT_FAILED':
        return 'bg-red-50';
      case 'MARKET_SOLD':
      case 'MARKET_PURCHASED':
        return 'bg-purple-50';
      case 'REFERRAL_REWARD':
        return 'bg-green-50';
      case 'INVITE_SUCCESS':
        return 'bg-green-50';
      case 'SYSTEM_ANNOUNCEMENT':
        return 'bg-blue-50';
      case 'ACCOUNT_SECURITY':
        return 'bg-orange-50';
      case 'COIN_EXCHANGE':
        return 'bg-blue-50';
      case 'GROUP_BUY_LOSE':
        return 'bg-gray-50';
      case 'GROUP_BUY_TIMEOUT':
        return 'bg-orange-50';
      case 'LOTTERY_PURCHASE':
        return 'bg-purple-50';
      case 'LOTTERY_WIN':
        return 'bg-yellow-50';
      case 'FRIEND_CASHBACK':
        return 'bg-green-50';
      case 'SPIN_REWARD':
        return 'bg-purple-50';
      default:
        return 'bg-gray-50';
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-6 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-gray-900">{t('notification.notifications')}</h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchNotifications}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <ArrowPathIcon className={`w-5 h-5 text-gray-600 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t('notification.markAllRead')}
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-2">
          {(['all', 'unread', 'read'] as const).map((filterType) => (
            <button
              key={filterType}
              onClick={() => setFilter(filterType)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === filterType
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {filterType === 'all' && t('common.all')}
              {filterType === 'unread' && t('notification.unread')}
              {filterType === 'read' && t('notification.read')}
              {filterType === 'unread' && unreadCount > 0 && ` (${unreadCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications List */}
      <div className="px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <BellIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('notification.noNotifications')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredNotifications.map((notification) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all ${
                  !notification.is_read ? 'border-l-4 border-blue-500' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  {/* Icon */}
                  <div className={`p-3 rounded-lg ${getNotificationBgColor(notification.type)}`}>
                    {getNotificationIcon(notification.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className={`font-semibold ${!notification.is_read ? 'text-gray-900' : 'text-gray-700'}`}>
                        {notification.title_i18n?.[i18n.language] || notification.title}
                      </h3>
                      {!notification.is_read && (
                        <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full ml-2 mt-2"></span>
                      )}
                    </div>
                    <p className={`text-sm mb-2 ${!notification.is_read ? 'text-gray-700' : 'text-gray-500'}`}>
                      {notification.message_i18n?.[i18n.language] || notification.content}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatDateTime(notification.created_at)}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center space-x-3 mt-3">
                      {!notification.is_read && (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="flex items-center space-x-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          <CheckIcon className="w-4 h-4" />
                          <span>{t('notification.markRead')}</span>
                        </button>
                      )}
                      {!notification.id.includes('_') && (
                        <button
                          onClick={() => deleteNotification(notification.id)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationPage;
